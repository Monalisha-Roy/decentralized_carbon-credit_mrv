"""
Drone Pipeline
Handles the full drone image processing pipeline:
1. Fetch orthomosaic + CHM from Pinata IPFS by CID
2. Read GSD from GeoTIFF metadata
3. Run Detectron2 crown detection using crown_detector_model.pkl + model_final.pth
4. For each detected crown, sample CHM for real tree height
5. Run agb_drone_regressor_model.pkl with [crown_ft, height_m]
6. Aggregate per-tree results → final AGB density + uncertainty
"""

import io
import math
import os
import logging
from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "../.env.local"))

import pickle
import joblib
import tempfile
from pathlib import Path
from typing import Dict, List, Tuple

import cv2
import numpy as np
import requests
import rasterio
from rasterio.transform import rowcol
from detectron2.config import get_cfg
from detectron2.engine import DefaultPredictor

logger = logging.getLogger(__name__)

# ── Constants ────────────────────────────────────────────────────────────────
IPFS_GATEWAYS = [
    "https://gateway.pinata.cloud/ipfs",
    "https://ipfs.io/ipfs",
    "https://cloudflare-ipfs.com/ipfs",
    "https://dweb.link/ipfs",
]
METRES_PER_FOOT = 0.3048

# ── Local cache for large GeoTIFF files ──────────────────────────────────────
CACHE_DIR = os.path.join(os.path.dirname(__file__), "cached_data")

KNOWN_FILES = {
    "bafybeid6cz6oblwon5ou7jhyrw4obcvhrcwnchjueed6omq736ohk4ve34": "000242_ortho-dsm-ptcloud.tif",
    "bafybeiblcfcahcqtz4vavuc2bvsh5rqrhqnkpy4yalgag7fkrz2hmymxc4": "000242_chm-mesh.tif",
}

# ── Module-level model holders (set by model_server.py on startup) ────────────
crown_predictor: DefaultPredictor = None   # Detectron2 predictor
drone_rf_model = None                      # sklearn RandomForestRegressor


# ─────────────────────────────────────────────────────────────────────────────
# 1.  MODEL LOADING  (called once from model_server.py → load_models())
# ─────────────────────────────────────────────────────────────────────────────

def load_drone_models(models_dir: Path) -> Tuple[bool, str]:
    """
    Load crown detector (Detectron2) and drone RF regressor.
    Called once at server startup.

    Args:
        models_dir: Path to the ml/models/ directory

    Returns:
        (success, message)
    """
    global crown_predictor, drone_rf_model

    try:
        weights_path = models_dir / "crown_detection_model.pth"

        if not weights_path.exists():
            raise FileNotFoundError(f"crown_detection_model.pth not found at {weights_path}")

        from detectron2 import model_zoo
        cfg = get_cfg()
        cfg.merge_from_file(model_zoo.get_config_file(
            "COCO-InstanceSegmentation/mask_rcnn_R_50_FPN_3x.yaml"
        ))
        cfg.MODEL.WEIGHTS                     = str(weights_path)
        cfg.MODEL.DEVICE                      = "cpu"
        cfg.MODEL.ROI_HEADS.SCORE_THRESH_TEST = 0.50
        cfg.MODEL.ROI_HEADS.NUM_CLASSES       = 1

        crown_predictor = DefaultPredictor(cfg)
        logger.info("✅ Crown detector (Detectron2) loaded successfully")

        # ── Drone RF regressor ────────────────────────────────────────────────
        drone_rf_path = models_dir / "drone_agb_model.pkl"
        if not drone_rf_path.exists():
            raise FileNotFoundError(f"drone_agb_model.pkl not found at {drone_rf_path}")

        drone_rf_model = joblib.load(drone_rf_path)

        logger.info("✅ Drone RF regressor loaded successfully")
        return True, "Drone models loaded successfully"

    except Exception as e:
        logger.error(f"Failed to load drone models: {e}")
        return False, str(e)


# ─────────────────────────────────────────────────────────────────────────────
# 2.  IPFS FETCH HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def _fetch_cid_to_tempfile(cid: str, suffix: str = ".tif") -> str:
    # ── Check local cache first ───────────────────────────────────────────────
    if cid in KNOWN_FILES:
        cached_path = os.path.join(CACHE_DIR, KNOWN_FILES[cid])
        if os.path.exists(cached_path):
            logger.info(f"✅ Using cached file: {cached_path} ({os.path.getsize(cached_path):,} bytes)")
            return cached_path
        else:
            logger.warning(f"Cache entry defined but file missing: {cached_path}")

    # ── Fall back to IPFS gateways ────────────────────────────────────────────
    pinata_jwt = os.environ.get("NEXT_PUBLIC_PINATA_JWT", "")
    last_error = None

    for gateway in IPFS_GATEWAYS:
        url = f"{gateway}/{cid}"
        logger.info(f"Trying gateway: {url}")
        try:
            headers = {}
            if "pinata" in gateway and pinata_jwt:
                headers["Authorization"] = f"Bearer {pinata_jwt}"

            response = requests.get(url, headers=headers, timeout=300, stream=True)
            response.raise_for_status()

            tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
            for chunk in response.iter_content(chunk_size=1024 * 1024):
                tmp.write(chunk)
            tmp.flush()
            tmp.close()

            logger.info(f"✅ Downloaded {cid} → {tmp.name} ({os.path.getsize(tmp.name):,} bytes)")
            return tmp.name

        except Exception as e:
            logger.warning(f"❌ Gateway {gateway} failed: {e}")
            last_error = e
            continue

    raise RuntimeError(f"All IPFS gateways failed for CID {cid}. Last error: {last_error}")
# ─────────────────────────────────────────────────────────────────────────────
# 3.  GSD EXTRACTION FROM GEOTIFF
# ─────────────────────────────────────────────────────────────────────────────

def _read_gsd_metres(geotiff_path: str) -> float:
    """
    Read ground sampling distance (metres/pixel) from GeoTIFF metadata.
    Uses the x-resolution from the affine transform.
    Falls back to 0.082 * METRES_PER_FOOT if CRS is missing.
    """
    with rasterio.open(geotiff_path) as src:
        # res() returns (pixel_width, pixel_height) in CRS units
        x_res = abs(src.res[0])

        if src.crs is None:
            logger.warning("GeoTIFF has no CRS — falling back to default GSD 0.082 ft")
            return 0.082 * METRES_PER_FOOT   # ~0.025 m

        # If CRS is geographic (degrees), convert roughly to metres
        if src.crs.is_geographic:
            # 1 degree latitude ≈ 111_320 m
            x_res = x_res * 111_320

        logger.info(f"GSD from GeoTIFF: {x_res:.5f} m/pixel")
        return x_res


# ─────────────────────────────────────────────────────────────────────────────
# 4.  CROWN DETECTION
# ─────────────────────────────────────────────────────────────────────────────

def _detect_crowns(ortho_path: str) -> List[np.ndarray]:
    """
    Run Detectron2 crown detector on the orthomosaic.

    Large GeoTIFFs are tiled (512×512 with 64px overlap) so the entire
    image does not need to fit in GPU memory.

    Returns:
        List of bounding boxes in pixel coords: [[x1, y1, x2, y2], ...]
        relative to the full image origin.
    """
    if crown_predictor is None:
        raise RuntimeError("Crown predictor not loaded")

    TILE_SIZE   = 512
    OVERLAP     = 64
    MIN_AREA_PX = 50   # ignore tiny detections

    with rasterio.open(ortho_path) as src:
        full_h, full_w = src.height, src.width
        # Read RGB bands (bands 1,2,3) — GeoTIFF may have more bands
        n_bands = min(src.count, 3)
        image_data = src.read(list(range(1, n_bands + 1)))  # (C, H, W)

    # Convert to HWC uint8 BGR (OpenCV / Detectron2 format)
    image_data = np.transpose(image_data, (1, 2, 0))  # HWC
    if image_data.dtype != np.uint8:
        # Normalise to 0-255
        mn, mx = image_data.min(), image_data.max()
        if mx > mn:
            image_data = ((image_data - mn) / (mx - mn) * 255).astype(np.uint8)
        else:
            image_data = np.zeros_like(image_data, dtype=np.uint8)

    if image_data.shape[2] == 1:
        image_data = cv2.cvtColor(image_data, cv2.COLOR_GRAY2BGR)
    elif image_data.shape[2] >= 3:
        image_data = image_data[:, :, :3][:, :, ::-1]  # RGB → BGR

    all_boxes: List[np.ndarray] = []

    for y0 in range(0, full_h, TILE_SIZE - OVERLAP):
        for x0 in range(0, full_w, TILE_SIZE - OVERLAP):
            y1 = min(y0 + TILE_SIZE, full_h)
            x1 = min(x0 + TILE_SIZE, full_w)
            tile = image_data[y0:y1, x0:x1]

            outputs   = crown_predictor(tile)
            instances = outputs["instances"].to("cpu")

            for box in instances.pred_boxes.tensor.numpy():
                bx1, by1, bx2, by2 = box
                # Skip tiny detections
                if (bx2 - bx1) * (by2 - by1) < MIN_AREA_PX:
                    continue
                # Translate tile-local coords back to full-image coords
                all_boxes.append(np.array([
                    bx1 + x0, by1 + y0,
                    bx2 + x0, by2 + y0
                ]))

    logger.info(f"Crown detection complete — {len(all_boxes)} crowns detected")
    return all_boxes


# ─────────────────────────────────────────────────────────────────────────────
# 5.  CHM HEIGHT SAMPLING
# ─────────────────────────────────────────────────────────────────────────────

def _sample_chm_for_crown(
    chm_dataset: rasterio.DatasetReader,
    rgb_x1: float, rgb_y1: float,
    rgb_x2: float, rgb_y2: float,
    rgb_width: int, rgb_height: int,
) -> float:
    """
    Extract 95th percentile canopy height from CHM for a detected crown.
    Scales RGB bounding box into CHM space before sampling.
    """
    DEFAULT_HEIGHT_M = 10.0
    try:
        chm_w = chm_dataset.width
        chm_h = chm_dataset.height

        scale_x = chm_w / rgb_width
        scale_y = chm_h / rgb_height

        chm_x1 = max(0, int(rgb_x1 * scale_x))
        chm_y1 = max(0, int(rgb_y1 * scale_y))
        chm_x2 = max(chm_x1 + 1, min(int(rgb_x2 * scale_x), chm_w))
        chm_y2 = max(chm_y1 + 1, min(int(rgb_y2 * scale_y), chm_h))

        window = rasterio.windows.Window(
            chm_x1, chm_y1,
            chm_x2 - chm_x1,
            chm_y2 - chm_y1
        )
        data = chm_dataset.read(1, window=window).astype(float)

        nodata = chm_dataset.nodata
        if nodata is not None:
            data = data[data != nodata]
        data = data[data > 0]

        if data.size == 0:
            return DEFAULT_HEIGHT_M

        return float(np.percentile(data, 95))
    except Exception:
        return DEFAULT_HEIGHT_M

# ─────────────────────────────────────────────────────────────────────────────
# 6.  PER-TREE RF PREDICTION
# ─────────────────────────────────────────────────────────────────────────────

def _predict_tree_agb(height_m: float, crown_area_px: float) -> Tuple[float, float]:
    # Feature order must match training: ['height', 'crown_area']
    features = np.array([[height_m, crown_area_px]], dtype=np.float32)
    per_tree_preds = np.array([
        est.predict(features)[0] for est in drone_rf_model.estimators_
    ])

    return float(np.mean(per_tree_preds)), float(np.std(per_tree_preds))


# ─────────────────────────────────────────────────────────────────────────────
# 7.  MAIN PIPELINE ENTRY POINT
# ─────────────────────────────────────────────────────────────────────────────

def process_drone_images(orthomosaic_cid: str, chm_cid: str) -> Dict:
    """
    Full drone pipeline.
    """
    ortho_path = None
    chm_path   = None

    try:
        # ── Step 1: Fetch both GeoTIFFs from IPFS ────────────────────────────
        logger.info("Fetching orthomosaic from IPFS...")
        ortho_path = _fetch_cid_to_tempfile(orthomosaic_cid, suffix=".tif")

        logger.info("Fetching CHM from IPFS...")
        chm_path = _fetch_cid_to_tempfile(chm_cid, suffix=".tif")

        # ── Step 2: Read GSD from orthomosaic ────────────────────────────────
        gsd_m  = _read_gsd_metres(ortho_path)
        gsd_ft = gsd_m / METRES_PER_FOOT
        logger.info(f"GSD: {gsd_m:.5f} m/px  ({gsd_ft:.5f} ft/px)")

        # ── Step 3: Detect crowns ─────────────────────────────────────────────
        boxes = _detect_crowns(ortho_path)

        if not boxes:
            raise ValueError("No tree crowns detected in the orthomosaic")

        # ── Step 4 & 5: For each crown sample CHM + run RF ───────────────────
        per_tree    = []
        agb_values  = []
        agb_sds     = []
        crown_areas = []
        heights     = []

        # Get RGB dimensions for CHM scaling
        with rasterio.open(ortho_path) as ortho_src:
            rgb_w = ortho_src.width
            rgb_h = ortho_src.height

        with rasterio.open(chm_path) as chm_ds:
            for i, box in enumerate(boxes):
                x1, y1, x2, y2 = box

                # Crown area in pixels — matches training feature 'crown_area'
                crown_area_px = float((x2 - x1) * (y2 - y1))

                # 95th percentile height over scaled crown region
                height_m = _sample_chm_for_crown(
                    chm_ds,
                    x1, y1, x2, y2,
                    rgb_w, rgb_h
                )

                # RF prediction — features: [height, crown_area]
                mean_log_agb, sd_log_agb = _predict_tree_agb(height_m, crown_area_px)

                # Detect whether model outputs raw kg or log(kg)
                if mean_log_agb > 20:
                    agb_kg = float(mean_log_agb)   # raw kg
                else:
                    agb_kg = float(np.exp(mean_log_agb))   # log space → back-transform

                # Safety clamp — no single tree should exceed 50,000 kg
                agb_kg = min(agb_kg, 50_000.0)
                agb_values.append(agb_kg)
                agb_sds.append(sd_log_agb)
                crown_areas.append(crown_area_px)
                heights.append(height_m)

                per_tree.append({
                    "id":            i,
                    "crown_area_px": round(crown_area_px, 2),
                    "height_m":      round(height_m, 2),
                    "agb_kg":        round(agb_kg, 2),
                })

        # ── Step 6: Aggregate to per-hectare density ──────────────────────────
        with rasterio.open(ortho_path) as src:
            area_m2 = src.width * src.height * (gsd_m ** 2)
            area_ha = area_m2 / 10_000.0

        tree_count      = len(agb_values)
        total_agb_kg    = sum(agb_values)
        agb_per_ha_t = (total_agb_kg / 1000.0) / max(area_ha, 0.001)
        agb_per_ha_t = min(agb_per_ha_t, 1000.0)  # clamp — prevents Infinity reaching JSON
        bgb_per_ha_t    = agb_per_ha_t * 0.2

        combined_sd_log  = math.sqrt(sum(s ** 2 for s in agb_sds)) / tree_count
        uncertainty_t_ha = agb_per_ha_t * combined_sd_log

        logger.info(
            f"Drone pipeline complete — {tree_count} trees | "
            f"AGB={agb_per_ha_t:.2f} t/ha | "
            f"BGB={bgb_per_ha_t:.2f} t/ha | "
            f"Uncertainty={uncertainty_t_ha:.2f} t/ha"
        )

        return {
            "agb":             round(agb_per_ha_t, 2),
            "bgb":             round(bgb_per_ha_t, 2),
            "agb_uncertainty": round(uncertainty_t_ha, 2),
            "tree_count":      tree_count,
            "mean_crown_area": round(float(np.mean(crown_areas)), 2),
            "mean_height_m":   round(float(np.mean(heights)), 2),
            "per_tree":        per_tree[:50],
        }

    finally:
        # Only delete temp files, not cached files
        for path in [ortho_path, chm_path]:
            if path and os.path.exists(path) and CACHE_DIR not in str(path):
                try:
                    os.unlink(path)
                except Exception:
                    pass