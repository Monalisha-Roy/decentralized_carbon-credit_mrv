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
        # ── Crown detector ────────────────────────────────────────────────────
        crown_pkl_path  = models_dir / "crown_detector_model.pkl"
        weights_path    = models_dir / "model_final.pth"

        if not crown_pkl_path.exists():
            raise FileNotFoundError(f"crown_detector_model.pkl not found at {crown_pkl_path}")
        if not weights_path.exists():
            raise FileNotFoundError(f"model_final.pth not found at {weights_path}")

        with open(crown_pkl_path, "rb") as f:
            crown_meta = pickle.load(f)

        # crown_meta keys: config (YAML str), model_weights_path, gsd_ft
        cfg = get_cfg()
        cfg.merge_from_other_cfg(cfg.load_cfg(crown_meta["config"]))
        cfg.MODEL.WEIGHTS        = str(weights_path)   # override stored path
        cfg.MODEL.DEVICE         = "cpu"               # safe default; GPU if available
        cfg.MODEL.ROI_HEADS.SCORE_THRESH_TEST = 0.5

        crown_predictor = DefaultPredictor(cfg)
        logger.info("✅ Crown detector (Detectron2) loaded successfully")

        # ── Drone RF regressor ────────────────────────────────────────────────
        drone_rf_path = models_dir / "agb_drone_regressor_model.pkl"
        if not drone_rf_path.exists():
            raise FileNotFoundError(f"agb_drone_regressor_model.pkl not found at {drone_rf_path}")

        with open(drone_rf_path, "rb") as f:
            drone_rf_model = pickle.load(f)

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

def _sample_chm_at_centroid(
    chm_dataset: rasterio.DatasetReader,
    cx_px: float,
    cy_px: float
) -> float:
    """
    Sample the CHM raster at the centroid pixel (cx_px, cy_px) of a crown.
    Returns height in metres.  Falls back to 10.0 m if out-of-bounds or nodata.
    """
    DEFAULT_HEIGHT_M = 10.0

    try:
        row = int(round(cy_px))
        col = int(round(cx_px))

        if not (0 <= row < chm_dataset.height and 0 <= col < chm_dataset.width):
            return DEFAULT_HEIGHT_M

        window = rasterio.windows.Window(col, row, 1, 1)
        data   = chm_dataset.read(1, window=window)
        value  = float(data[0, 0])

        # Handle nodata / negative values
        nodata = chm_dataset.nodata
        if (nodata is not None and math.isclose(value, nodata)) or value < 0:
            return DEFAULT_HEIGHT_M

        return max(value, 0.5)   # guard against near-zero heights

    except Exception:
        return DEFAULT_HEIGHT_M


# ─────────────────────────────────────────────────────────────────────────────
# 6.  PER-TREE RF PREDICTION
# ─────────────────────────────────────────────────────────────────────────────

def _predict_tree_agb(crown_ft: float, height_m: float) -> Tuple[float, float]:
    """
    Run the drone RF regressor on a single tree.
    Input features: [crown_ft, height_m]  (order matters — no feature names stored)

    Returns:
        (mean_log_agb, uncertainty_sd)  — model outputs log-space AGB
    """
    features = np.array([[crown_ft, height_m]], dtype=np.float32)

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

    Args:
        orthomosaic_cid: Pinata IPFS CID of the orthomosaic GeoTIFF
        chm_cid:         Pinata IPFS CID of the CHM GeoTIFF

    Returns:
        {
            "agb":             float  (t/ha)
            "bgb":             float  (t/ha)
            "agb_uncertainty": float  (t/ha, combined SD)
            "tree_count":      int
            "mean_crown_ft":   float
            "mean_height_m":   float
            "per_tree":        [ { id, crown_ft, height_m, agb_kg } ]
        }
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
        gsd_m = _read_gsd_metres(ortho_path)
        gsd_ft = gsd_m / METRES_PER_FOOT
        logger.info(f"GSD: {gsd_m:.5f} m/px  ({gsd_ft:.5f} ft/px)")

        # ── Step 3: Detect crowns ─────────────────────────────────────────────
        boxes = _detect_crowns(ortho_path)

        if not boxes:
            raise ValueError("No tree crowns detected in the orthomosaic")

        # ── Step 4 & 5: For each crown sample CHM + run RF ───────────────────
        per_tree      = []
        agb_values    = []
        agb_sds       = []
        crown_widths  = []
        heights       = []

        with rasterio.open(chm_path) as chm_ds:
            for i, box in enumerate(boxes):
                x1, y1, x2, y2 = box

                # Crown width in feet (average of width and height of bbox)
                crown_px = ((x2 - x1) + (y2 - y1)) / 2.0
                crown_ft = float(crown_px * gsd_ft)

                # Centroid pixel for CHM sampling
                cx_px = (x1 + x2) / 2.0
                cy_px = (y1 + y2) / 2.0
                height_m = _sample_chm_at_centroid(chm_ds, cx_px, cy_px)

                # RF prediction → log-space AGB
                mean_log_agb, sd_log_agb = _predict_tree_agb(crown_ft, height_m)

                # Back-transform from log space
                agb_kg = float(np.exp(mean_log_agb))

                agb_values.append(agb_kg)
                agb_sds.append(sd_log_agb)
                crown_widths.append(crown_ft)
                heights.append(height_m)

                per_tree.append({
                    "id":        i,
                    "crown_ft":  round(crown_ft, 2),
                    "height_m":  round(height_m, 2),
                    "agb_kg":    round(agb_kg, 2),
                })

        # ── Step 6: Aggregate to per-hectare density ──────────────────────────
        # Estimate area covered by the orthomosaic in hectares
        with rasterio.open(ortho_path) as src:
            area_m2  = src.width * src.height * (gsd_m ** 2)
            area_ha  = area_m2 / 10_000.0

        tree_count       = len(agb_values)
        total_agb_kg     = sum(agb_values)
        agb_per_ha_t     = (total_agb_kg / 1000.0) / max(area_ha, 0.001)
        bgb_per_ha_t     = agb_per_ha_t * 0.2

        # Combined uncertainty: propagate per-tree SDs in quadrature → t/ha
        combined_sd_log  = math.sqrt(sum(s ** 2 for s in agb_sds)) / tree_count
        uncertainty_t_ha = agb_per_ha_t * combined_sd_log   # approx delta method

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
            "mean_crown_ft":   round(float(np.mean(crown_widths)), 2),
            "mean_height_m":   round(float(np.mean(heights)), 2),
            "per_tree":        per_tree[:50],  # cap at 50 for response size
        }

    finally:
        # Only delete temp files, not cached files
        for path in [ortho_path, chm_path]:
            if path and os.path.exists(path) and CACHE_DIR not in str(path):
                try:
                    os.unlink(path)
                except Exception:
                    pass
