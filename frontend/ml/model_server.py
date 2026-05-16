"""
Carbon Stock Model Server
Provides ML model predictions for AGB (Above Ground Biomass) and SOC (Soil Organic Carbon)
using satellite and terrain data from Google Earth Engine.

Models:
- AGB Satellite: Random Forest model with uncertainty estimation (agb_satellite_rf_uncertainty.pkl)
- SOC:           Soil Organic Carbon model (SOC_model.pkl)
- Crown Detector: Detectron2 instance segmentation (crown_detector_model.pkl + model_final.pth)
- AGB Drone:     Random Forest regressor (agb_drone_regressor_model.pkl)
"""

import os
import sys
import json
import math
import pickle
import logging
import numpy as np
from pathlib import Path
from typing import Dict, Any, Tuple

from flask import Flask, request, jsonify
from flask_cors import CORS

import drone_pipeline  
from agb_fusion import AGBEstimate, fuse_agb

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# ── Flask app ─────────────────────────────────────────────────────────────────
app = Flask(__name__)
CORS(app)

# ── Paths ─────────────────────────────────────────────────────────────────────
SCRIPT_DIR = Path(__file__).parent.absolute()
MODELS_DIR = SCRIPT_DIR / "models"

# ── Satellite model globals ───────────────────────────────────────────────────
agb_model    = None
soc_model    = None
models_loaded = False


# ─────────────────────────────────────────────────────────────────────────────
# MODEL LOADING
# ─────────────────────────────────────────────────────────────────────────────

def load_models() -> Tuple[bool, str]:
    """
    Load all ML models from pickle files.
    Satellite models are loaded here; drone models are delegated to drone_pipeline.

    Returns:
        Tuple[bool, str]: (success, message)
    """
    global agb_model, soc_model, models_loaded

    try:
        # ── Satellite AGB model ───────────────────────────────────────────────
        agb_path = MODELS_DIR / "agb_satellite_rf_uncertainty.pkl"
        if not agb_path.exists():
            raise FileNotFoundError(f"AGB model not found at {agb_path}")

        logger.info(f"Loading AGB satellite model from {agb_path}")
        with open(agb_path, 'rb') as f:
            agb_model = pickle.load(f)
        logger.info("✅ AGB satellite model loaded successfully")

        # ── SOC model ─────────────────────────────────────────────────────────
        soc_path = MODELS_DIR / "SOC_model.pkl"
        if not soc_path.exists():
            raise FileNotFoundError(f"SOC model not found at {soc_path}")

        logger.info(f"Loading SOC model from {soc_path}")
        with open(soc_path, 'rb') as f:
            soc_model = pickle.load(f)
        logger.info("✅ SOC model loaded successfully")

        # ── Drone models (crown detector + drone RF) ──────────────────────────
        logger.info("Loading drone models...")
        success, message = drone_pipeline.load_drone_models(MODELS_DIR)
        if not success:
            raise RuntimeError(f"Drone model loading failed: {message}")

        models_loaded = True
        return True, "All models loaded successfully"

    except Exception as e:
        error_msg = f"Failed to load models: {str(e)}"
        logger.error(error_msg)
        return False, error_msg


# ─────────────────────────────────────────────────────────────────────────────
# SATELLITE FEATURE VALIDATION & PREPARATION  (unchanged from original)
# ─────────────────────────────────────────────────────────────────────────────

def validate_agb_features(features: Dict[str, float]) -> Tuple[bool, str]:
    required_features = [
        'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B11', 'B12',
        'NDVI', 'VV', 'VH', 'elevation', 'slope'
    ]
    missing = [f for f in required_features if f not in features]
    if missing:
        return False, f"Missing features: {', '.join(missing)}"
    return True, "Valid features"


def validate_soc_features(features: Dict[str, float]) -> Tuple[bool, str]:
    required_features = [
        'B2', 'B3', 'B4', 'B8', 'B11', 'NDVI', 'VV', 'VH',
        'elevation', 'slope', 'aspect', 'precip_annual', 'temp_mean',
        'soil_texture', 'latitude', 'longitude'
    ]
    missing = [f for f in required_features if f not in features]
    if missing:
        return False, f"Missing features: {', '.join(missing)}"
    return True, "Valid features"


def prepare_agb_features(features: Dict[str, float]) -> np.ndarray:
    feature_order = [
        'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B11', 'B12',
        'NDVI', 'VV', 'VH', 'elevation', 'slope'
    ]
    feature_array = [features.get(feat, 0.0) for feat in feature_order]
    return np.array(feature_array, dtype=np.float32).reshape(1, -1)


def prepare_soc_features(features: Dict[str, float]) -> np.ndarray:
    feature_order = [
        'B2', 'B3', 'B4', 'B8', 'B11', 'NDVI', 'VV', 'VH',
        'elevation', 'slope', 'aspect', 'precip_annual', 'temp_mean',
        'soil_texture', 'latitude', 'longitude'
    ]
    feature_array = [features.get(feat, 0.0) for feat in feature_order]
    return np.array(feature_array, dtype=np.float32).reshape(1, -1)


# ─────────────────────────────────────────────────────────────────────────────
# SATELLITE PREDICTION HELPERS  (unchanged from original)
# ─────────────────────────────────────────────────────────────────────────────

def predict_agb(features: np.ndarray) -> Tuple[float, float]:
    if not models_loaded or agb_model is None:
        raise RuntimeError("AGB model not loaded")

    if hasattr(agb_model, 'estimators_'):
        predictions = np.array([tree.predict(features)[0] for tree in agb_model.estimators_])
        agb         = np.mean(predictions)
        uncertainty = np.std(predictions)
    else:
        agb         = agb_model.predict(features)[0]
        uncertainty = agb * 0.1

    return float(agb), float(uncertainty)


def predict_soc(features: np.ndarray) -> float:
    if not models_loaded or soc_model is None:
        raise RuntimeError("SOC model not loaded")
    return float(soc_model.predict(features)[0])


# ─────────────────────────────────────────────────────────────────────────────
# ROUTES — SATELLITE  (unchanged from original)
# ─────────────────────────────────────────────────────────────────────────────

@app.route('/health', methods=['GET'])
def health():
    return jsonify({
        'status': 'ok',
        'models_loaded': models_loaded,
        'message': 'Model server is running'
    })


@app.route('/predict/agb', methods=['POST'])
def predict_agb_endpoint():
    """
    Satellite AGB prediction.

    Body:  { "features": { "B2": ..., "slope": ... } }
    Returns: { "success": true, "agb": float, "agb_uncertainty": float, "bgb": float }
    """
    try:
        if not models_loaded:
            return jsonify({'success': False, 'error': 'Models not loaded'}), 500

        data = request.get_json()
        if not data or 'features' not in data:
            return jsonify({'success': False, 'error': 'Missing "features" in request body'}), 400

        features = data['features']
        valid, message = validate_agb_features(features)
        if not valid:
            return jsonify({'success': False, 'error': message}), 400

        feature_array   = prepare_agb_features(features)
        agb, uncertainty = predict_agb(feature_array)
        bgb              = agb * 0.2

        logger.info(f"Satellite AGB: {agb:.2f} t/ha ± {uncertainty:.2f}")
        return jsonify({
            'success': True,
            'agb':             round(agb, 2),
            'agb_uncertainty': round(uncertainty, 2),
            'bgb':             round(bgb, 2)
        }), 200

    except Exception as e:
        logger.error(f"Error in AGB endpoint: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/predict/soc', methods=['POST'])
def predict_soc_endpoint():
    """
    SOC prediction.

    Body:  { "features": { "B2": ..., "longitude": ... } }
    Returns: { "success": true, "soc": float }
    """
    try:
        if not models_loaded:
            return jsonify({'success': False, 'error': 'Models not loaded'}), 500

        data = request.get_json()
        if not data or 'features' not in data:
            return jsonify({'success': False, 'error': 'Missing "features" in request body'}), 400

        features = data['features']
        valid, message = validate_soc_features(features)
        if not valid:
            return jsonify({'success': False, 'error': message}), 400

        feature_array = prepare_soc_features(features)
        soc           = predict_soc(feature_array)

        logger.info(f"SOC: {soc:.2f} t/ha")
        return jsonify({'success': True, 'soc': round(soc, 2)}), 200

    except Exception as e:
        logger.error(f"Error in SOC endpoint: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


# ─────────────────────────────────────────────────────────────────────────────
# ROUTE — DRONE AGB  (replaces old hardcoded allometric endpoint)
# ─────────────────────────────────────────────────────────────────────────────

@app.route('/predict/drone_agb', methods=['POST'])
def predict_drone_agb_endpoint():
    """
    Drone-based AGB prediction using Detectron2 crown detection + RF regressor.

    Fetches orthomosaic and CHM from Pinata IPFS, runs the full drone pipeline,
    and returns per-hectare biomass estimates.

    Expected JSON body:
    {
        "orthomosaic_cid": "QmXxx...",   // Pinata CID of orthomosaic GeoTIFF
        "chm_cid":         "QmYyy..."    // Pinata CID of CHM GeoTIFF
    }

    Returns:
    {
        "success":         true,
        "agb":             45.23,        // tonnes  (Above Ground Biomass, total)
        "bgb":             9.05,         // tonnes  (Below Ground Biomass = AGB * 0.2)
        "agb_uncertainty": 6.78,         // tonnes  (combined RF ensemble SD)
        "tree_count":      312,
        "mean_crown_ft":   4.8,
        "mean_height_m":   12.3,
        "per_tree":        [ { "id": 0, "crown_ft": 4.2, "height_m": 11.5, "agb_kg": 98.3 }, ... ]
    }
    """
    try:
        if not models_loaded:
            return jsonify({'success': False, 'error': 'Models not loaded'}), 500

        data = request.get_json()
        if not data:
            return jsonify({'success': False, 'error': 'Empty request body'}), 400

        orthomosaic_cid = data.get('orthomosaic_cid', '').strip()
        chm_cid         = data.get('chm_cid', '').strip()

        if not orthomosaic_cid:
            return jsonify({'success': False, 'error': 'Missing orthomosaic_cid'}), 400
        if not chm_cid:
            return jsonify({'success': False, 'error': 'Missing chm_cid'}), 400

        logger.info(f"Drone pipeline — ortho={orthomosaic_cid} chm={chm_cid}")

        result = drone_pipeline.process_drone_images(
            orthomosaic_cid=orthomosaic_cid,
            chm_cid=chm_cid,
        )

        logger.info(
            f"Drone AGB={result['agb']} t  "
            f"BGB={result['bgb']} t  "
            f"Trees={result['tree_count']}"
        )

        return jsonify({'success': True, **result}), 200

    except Exception as e:
        logger.error(f"Error in drone AGB endpoint: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


# ─────────────────────────────────────────────────────────────────────────────
# ROUTE — FUSION  (combines satellite + drone → final carbon stock)
# ─────────────────────────────────────────────────────────────────────────────
@app.route('/predict/carbon', methods=['POST'])
def predict_carbon_endpoint():
    try:
        if not models_loaded:
            return jsonify({'success': False, 'error': 'Models not loaded'}), 500

        data = request.get_json()
        if not data:
            return jsonify({'success': False, 'error': 'Empty request body'}), 400

        area_ha = float(data.get('area_ha', 1.0))
        results = {}

        # Satellite AGB
        if 'agb_features' not in data:
            return jsonify({'success': False, 'error': 'Missing agb_features'}), 400
        agb_features = data['agb_features']
        valid, message = validate_agb_features(agb_features)
        if not valid:
            return jsonify({'success': False, 'error': f"AGB validation: {message}"}), 400
        sat_agb, sat_uncertainty = predict_agb(prepare_agb_features(agb_features))
        results['satellite_agb']             = round(sat_agb, 2)          # t/ha density
        results['satellite_agb_uncertainty'] = round(sat_uncertainty, 2)  # t/ha density

        # SOC
        if 'soc_features' not in data:
            return jsonify({'success': False, 'error': 'Missing soc_features'}), 400
        soc_features = data['soc_features']
        valid, message = validate_soc_features(soc_features)
        if not valid:
            return jsonify({'success': False, 'error': f"SOC validation: {message}"}), 400
        soc_density = predict_soc(prepare_soc_features(soc_features))  # t/ha
        results['soc_density'] = round(soc_density, 2)

        # Drone AGB — already in tonnes (drone pipeline outputs total, not density)
        drone_agb         = float(data.get('drone_agb', 0.0))
        drone_uncertainty = float(data.get('drone_agb_uncertainty', 0.0))
        results['drone_agb']             = round(drone_agb, 2)
        results['drone_agb_uncertainty'] = round(drone_uncertainty, 2)

        # Convert satellite density → tonnes before fusion
        sat_agb_tonnes         = sat_agb * area_ha
        sat_uncertainty_tonnes = sat_uncertainty * area_ha  # std scales linearly with area

        # ── Inverse Variance Weighting fusion via agb_fusion.py ──────────────
        if drone_agb > 0:
            sat_estimate   = AGBEstimate(agb=sat_agb_tonnes, std_dev=max(sat_uncertainty_tonnes, 0.01), source="satellite")
            drone_estimate = AGBEstimate(agb=drone_agb,      std_dev=max(drone_uncertainty, 0.01),      source="drone")
            fusion         = fuse_agb(sat_estimate, drone_estimate)
            fused_agb         = fusion.agb_fused  # tonnes
            fused_uncertainty = fusion.std_dev
            results['weight_satellite'] = round(fusion.weight_sat,   4)
            results['weight_drone']     = round(fusion.weight_drone, 4)
        else:
            # No drone data — fall back to satellite only, but still in tonnes
            fused_agb         = sat_agb_tonnes
            fused_uncertainty = sat_uncertainty_tonnes

        # BGB from fused AGB (both in tonnes)
        bgb = fused_agb * 0.2
        results['fused_agb']         = round(fused_agb, 2)
        results['fused_uncertainty'] = round(fused_uncertainty, 2)
        results['bgb']               = round(bgb, 2)

        # SOC: density → tonnes (separate from fusion, satellite-only)
        soc_tonnes = soc_density * area_ha
        results['soc_tonnes'] = round(soc_tonnes, 2)

        # Carbon stock — all values already in tonnes, no * area_ha
        carbon_stock_t = fused_agb + bgb + soc_tonnes
        co2_equivalent = carbon_stock_t * 3.67
        results['carbon_stock']   = round(carbon_stock_t, 2)
        results['co2_equivalent'] = round(co2_equivalent, 2)
        results['area_ha']        = round(area_ha, 4)

        logger.info(
            f"Fusion — sat={sat_agb:.2f} t/ha drone={drone_agb:.2f} t "
            f"fused={fused_agb:.2f} t SOC={soc_tonnes:.2f} t "
            f"stock={carbon_stock_t:.2f} t CO2e={co2_equivalent:.2f} t"
        )

        return jsonify({'success': True, **results}), 200

    except Exception as e:
        logger.error(f"Error in carbon endpoint: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

# ─────────────────────────────────────────────────────────────────────────────
# ROUTE — MODEL INFO
# ─────────────────────────────────────────────────────────────────────────────

@app.route('/models/info', methods=['GET'])
def models_info():
    info = {
        'models_loaded': models_loaded,
        'models': {}
    }

    if agb_model is not None:
        info['models']['agb_satellite'] = {
            'type':              type(agb_model).__name__,
            'features_expected': 14,
            'description':       'Satellite Above Ground Biomass (RF + uncertainty)'
        }

    if soc_model is not None:
        info['models']['soc'] = {
            'type':              type(soc_model).__name__,
            'features_expected': 16,
            'description':       'Soil Organic Carbon'
        }

    if drone_pipeline.crown_predictor is not None:
        info['models']['crown_detector'] = {
            'type':        'Detectron2 DefaultPredictor',
            'description': 'Tree crown instance segmentation'
        }

    if drone_pipeline.drone_rf_model is not None:
        info['models']['agb_drone'] = {
            'type':              type(drone_pipeline.drone_rf_model).__name__,
            'features_expected': 2,
            'feature_names':     ['crown_ft', 'height_m'],
            'description':       'Drone Above Ground Biomass (RF regressor)'
        }

    return jsonify(info), 200


@app.errorhandler(404)
def not_found(e):
    return jsonify({
        'success': False,
        'error': 'Endpoint not found',
        'available_endpoints': [
            'GET  /health',
            'GET  /models/info',
            'POST /predict/agb',
            'POST /predict/soc',
            'POST /predict/drone_agb',
            'POST /predict/carbon',
        ]
    }), 404


# ─────────────────────────────────────────────────────────────────────────────
# ENTRY POINT
# ─────────────────────────────────────────────────────────────────────────────

def main():
    success, message = load_models()
    if not success:
        logger.error(f"Failed to start server: {message}")
        sys.exit(1)

    logger.info("🚀 Starting Carbon Stock Model Server...")
    logger.info(f"📁 Models directory: {MODELS_DIR}")
    logger.info(f"✅ {message}")
    logger.info("🌐 Server running at http://localhost:5000")
    logger.info("📍 Available endpoints:")
    logger.info("   GET  /health")
    logger.info("   GET  /models/info")
    logger.info("   POST /predict/agb        — satellite AGB (14 features)")
    logger.info("   POST /predict/soc        — SOC (16 features)")
    logger.info("   POST /predict/drone_agb  — drone pipeline (ortho + CHM CIDs)")
    logger.info("   POST /predict/carbon     — full fusion + carbon stock")

    app.run(host='0.0.0.0', port=5000, debug=False, use_reloader=False)


if __name__ == '__main__':
    main()