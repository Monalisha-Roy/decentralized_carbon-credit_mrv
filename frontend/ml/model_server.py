"""
Carbon Stock Model Server
Provides ML model predictions for AGB (Above Ground Biomass) and SOC (Soil Organic Carbon)
using satellite and terrain data from Google Earth Engine.

Models:
- AGB: Random Forest model with uncertainty estimation (agb_satellite_rf_uncertainty.pkl)
- SOC: Soil Organic Carbon model (SOC_model.pkl)
"""

import os
import sys
import json
import pickle
import logging
import numpy as np
from pathlib import Path
from typing import Dict, Any, Tuple

from flask import Flask, request, jsonify
from flask_cors import CORS

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Initialize Flask app
app = Flask(__name__)
CORS(app)

# Get the directory where this script is located
SCRIPT_DIR = Path(__file__).parent.absolute()
MODELS_DIR = SCRIPT_DIR / "models"

# Global variables for models
agb_model = None
soc_model = None
models_loaded = False


def load_models() -> Tuple[bool, str]:
    """
    Load ML models from pickle files.
    
    Returns:
        Tuple[bool, str]: (success, message)
    """
    global agb_model, soc_model, models_loaded
    
    try:
        agb_path = MODELS_DIR / "agb_satellite_rf_uncertainty.pkl"
        soc_path = MODELS_DIR / "SOC_model.pkl"
        
        # Check if model files exist
        if not agb_path.exists():
            raise FileNotFoundError(f"AGB model not found at {agb_path}")
        if not soc_path.exists():
            raise FileNotFoundError(f"SOC model not found at {soc_path}")
        
        logger.info(f"Loading AGB model from {agb_path}")
        with open(agb_path, 'rb') as f:
            agb_model = pickle.load(f)
        logger.info("✅ AGB model loaded successfully")
        
        logger.info(f"Loading SOC model from {soc_path}")
        with open(soc_path, 'rb') as f:
            soc_model = pickle.load(f)
        logger.info("✅ SOC model loaded successfully")
        
        models_loaded = True
        return True, "Models loaded successfully"
        
    except Exception as e:
        error_msg = f"Failed to load models: {str(e)}"
        logger.error(error_msg)
        return False, error_msg


def validate_agb_features(features: Dict[str, float]) -> Tuple[bool, str]:
    """
    Validate AGB model input features.
    
    Expected features:
    - Optical bands: B2, B3, B4, B5, B6, B7, B8, B11, B12
    - Vegetation indices: NDVI
    - SAR bands: VV, VH
    - Terrain: elevation, slope
    - Location: latitude, longitude
    
    Total: 19 features
    """
    required_features = [
        'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B11', 'B12',
        'NDVI', 'VV', 'VH', 'elevation', 'slope'
    ]
    
    missing = [f for f in required_features if f not in features]
    if missing:
        return False, f"Missing features: {', '.join(missing)}"
    
    return True, "Valid features"


def validate_soc_features(features: Dict[str, float]) -> Tuple[bool, str]:
    """
    Validate SOC model input features.
    
    Expected features (16 features):
    - Optical bands: B2, B3, B4, B8, B11
    - Vegetation indices: NDVI
    - SAR bands: VV, VH
    - Terrain: elevation, slope, aspect
    - Climate: precip_annual, temp_mean
    - Soil: soil_texture, bulk_density
    - Location: latitude, longitude
    """
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
    """
    Prepare and order features for AGB model prediction.
    
    Args:
        features: Dictionary with feature names and values
        
    Returns:
        np.ndarray: Ordered feature array for model
    """
    # Expected feature order for AGB model (19 features)
    feature_order = [
        'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B11', 'B12',
        'NDVI', 'VV', 'VH', 'elevation', 'slope',
        'latitude', 'longitude'  # Add location features if available
    ]
    
    # Extract features in order, use 0 as default for missing values
    feature_array = []
    for feat in feature_order[:14]:  # Use only the main 14 features
        feature_array.append(features.get(feat, 0.0))
    
    return np.array(feature_array, dtype=np.float32).reshape(1, -1)


def prepare_soc_features(features: Dict[str, float]) -> np.ndarray:
    """
    Prepare and order features for SOC model prediction.
    
    Args:
        features: Dictionary with feature names and values
        
    Returns:
        np.ndarray: Ordered feature array for model
    """
    # Expected feature order for SOC model (16 features)
    feature_order = [
        'B2', 'B3', 'B4', 'B8', 'B11', 'NDVI', 'VV', 'VH',
        'elevation', 'slope', 'aspect', 'precip_annual', 'temp_mean',
        'soil_texture', 'latitude', 'longitude'
    ]
    
    # Extract features in order, use 0 as default for missing values
    feature_array = [features.get(feat, 0.0) for feat in feature_order]
    
    return np.array(feature_array, dtype=np.float32).reshape(1, -1)


def predict_agb(features: np.ndarray) -> Tuple[float, float]:
    """
    Predict AGB and uncertainty using the trained Random Forest model.
    
    Args:
        features: np.ndarray of shape (1, n_features)
        
    Returns:
        Tuple[agb, uncertainty]: Predicted AGB and its uncertainty
    """
    if not models_loaded or agb_model is None:
        raise RuntimeError("AGB model not loaded")
    
    # Get prediction from the ensemble
    # The model should support predict and predict_uncertainty methods
    try:
        # Try to get predictions from all trees in the ensemble
        if hasattr(agb_model, 'estimators_'):
            # RandomForest has estimators_
            predictions = np.array([tree.predict(features)[0] for tree in agb_model.estimators_])
            agb = np.mean(predictions)
            uncertainty = np.std(predictions)
        else:
            # Fallback to single prediction
            agb = agb_model.predict(features)[0]
            # Calculate uncertainty as a percentage (10% default for RF models)
            uncertainty = agb * 0.1
        
        return float(agb), float(uncertainty)
        
    except Exception as e:
        logger.error(f"Error in AGB prediction: {str(e)}")
        raise


def predict_soc(features: np.ndarray) -> float:
    """
    Predict SOC using the trained model.
    
    Args:
        features: np.ndarray of shape (1, n_features)
        
    Returns:
        float: Predicted SOC value (t/ha)
    """
    if not models_loaded or soc_model is None:
        raise RuntimeError("SOC model not loaded")
    
    try:
        soc = soc_model.predict(features)[0]
        return float(soc)
    except Exception as e:
        logger.error(f"Error in SOC prediction: {str(e)}")
        raise


@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint."""
    return jsonify({
        'status': 'ok',
        'models_loaded': models_loaded,
        'message': 'Model server is running'
    })


@app.route('/predict/agb', methods=['POST'])
def predict_agb_endpoint():
    """
    API endpoint for AGB prediction.
    
    Expected JSON body:
    {
        "features": {
            "B2": value, "B3": value, ..., "slope": value
        }
    }
    
    Returns:
    {
        "success": true/false,
        "agb": float (tonnes per hectare),
        "agb_uncertainty": float (standard deviation),
        "bgb": float (Below Ground Biomass, calculated as AGB * 0.2)
    }
    """
    try:
        if not models_loaded:
            return jsonify({
                'success': False,
                'error': 'Models not loaded'
            }), 500
        
        data = request.get_json()
        
        if not data or 'features' not in data:
            return jsonify({
                'success': False,
                'error': 'Missing "features" in request body'
            }), 400
        
        features = data['features']
        
        # Validate features
        valid, message = validate_agb_features(features)
        if not valid:
            return jsonify({
                'success': False,
                'error': message
            }), 400
        
        # Prepare features
        feature_array = prepare_agb_features(features)
        
        # Make prediction
        agb, uncertainty = predict_agb(feature_array)
        
        # Calculate BGB (Below Ground Biomass) as 20% of AGB
        bgb = agb * 0.2
        
        logger.info(f"AGB Prediction: {agb:.2f} t/ha ± {uncertainty:.2f}, BGB: {bgb:.2f} t/ha")
        
        return jsonify({
            'success': True,
            'agb': round(agb, 2),
            'agb_uncertainty': round(uncertainty, 2),
            'bgb': round(bgb, 2)
        }), 200
        
    except Exception as e:
        logger.error(f"Error in AGB prediction endpoint: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/predict/soc', methods=['POST'])
def predict_soc_endpoint():
    """
    API endpoint for SOC prediction.
    
    Expected JSON body:
    {
        "features": {
            "B2": value, "B3": value, ..., "longitude": value
        }
    }
    
    Returns:
    {
        "success": true/false,
        "soc": float (tonnes per hectare)
    }
    """
    try:
        if not models_loaded:
            return jsonify({
                'success': False,
                'error': 'Models not loaded'
            }), 500
        
        data = request.get_json()
        
        if not data or 'features' not in data:
            return jsonify({
                'success': False,
                'error': 'Missing "features" in request body'
            }), 400
        
        features = data['features']
        
        # Validate features
        valid, message = validate_soc_features(features)
        if not valid:
            return jsonify({
                'success': False,
                'error': message
            }), 400
        
        # Prepare features
        feature_array = prepare_soc_features(features)
        
        # Make prediction
        soc = predict_soc(feature_array)
        
        logger.info(f"SOC Prediction: {soc:.2f} t/ha")
        
        return jsonify({
            'success': True,
            'soc': round(soc, 2)
        }), 200
        
    except Exception as e:
        logger.error(f"Error in SOC prediction endpoint: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/predict/carbon', methods=['POST'])
def predict_carbon_endpoint():
    """
    Combined endpoint for full carbon stock prediction.
    
    Expected JSON body:
    {
        "agb_features": {...},
        "soc_features": {...}
    }
    
    Returns all carbon components in one response.
    """
    try:
        if not models_loaded:
            return jsonify({
                'success': False,
                'error': 'Models not loaded'
            }), 500
        
        data = request.get_json()
        
        if not data:
            return jsonify({
                'success': False,
                'error': 'Empty request body'
            }), 400
        
        results = {}
        
        # Predict AGB if features provided
        if 'agb_features' in data:
            agb_features = data['agb_features']
            valid, message = validate_agb_features(agb_features)
            if valid:
                feature_array = prepare_agb_features(agb_features)
                agb, uncertainty = predict_agb(feature_array)
                bgb = agb * 0.2
                results['agb'] = round(agb, 2)
                results['agb_uncertainty'] = round(uncertainty, 2)
                results['bgb'] = round(bgb, 2)
            else:
                return jsonify({'success': False, 'error': f"AGB validation failed: {message}"}), 400
        
        # Predict SOC if features provided
        if 'soc_features' in data:
            soc_features = data['soc_features']
            valid, message = validate_soc_features(soc_features)
            if valid:
                feature_array = prepare_soc_features(soc_features)
                soc = predict_soc(feature_array)
                results['soc'] = round(soc, 2)
            else:
                return jsonify({'success': False, 'error': f"SOC validation failed: {message}"}), 400
        
        if not results:
            return jsonify({
                'success': False,
                'error': 'No valid features provided'
            }), 400
        
        # Calculate total carbon
        total_carbon = results.get('agb', 0) + results.get('bgb', 0) + results.get('soc', 0)
        results['total_carbon'] = round(total_carbon, 2)
        results['co2_equivalent'] = round(total_carbon * 3.67, 2)
        
        logger.info(f"Carbon Prediction: AGB={results.get('agb')} "
                   f"BGB={results.get('bgb')} "
                   f"SOC={results.get('soc')} "
                   f"Total={total_carbon:.2f} t/ha")
        
        return jsonify({
            'success': True,
            **results
        }), 200
        
    except Exception as e:
        logger.error(f"Error in carbon prediction endpoint: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/models/info', methods=['GET'])
def models_info():
    """Get information about loaded models."""
    try:
        info = {
            'models_loaded': models_loaded,
            'models': {}
        }
        
        if agb_model is not None:
            info['models']['agb'] = {
                'type': type(agb_model).__name__,
                'features_expected': 14,
                'description': 'Above Ground Biomass (Random Forest with uncertainty estimation)'
            }
        
        if soc_model is not None:
            info['models']['soc'] = {
                'type': type(soc_model).__name__,
                'features_expected': 16,
                'description': 'Soil Organic Carbon'
            }
        
        return jsonify(info), 200
        
    except Exception as e:
        logger.error(f"Error getting models info: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.errorhandler(404)
def not_found(e):
    """Handle 404 errors."""
    return jsonify({
        'success': False,
        'error': 'Endpoint not found',
        'available_endpoints': [
            '/health',
            '/predict/agb',
            '/predict/soc',
            '/predict/carbon',
            '/models/info'
        ]
    }), 404


def main():
    """Main entry point for the model server."""
    # Load models on startup
    success, message = load_models()
    
    if not success:
        logger.error(f"Failed to start server: {message}")
        sys.exit(1)
    
    logger.info("🚀 Starting Carbon Stock Model Server...")
    logger.info(f"📁 Models directory: {MODELS_DIR}")
    logger.info(f"✅ {message}")
    logger.info("🌐 Server running at http://localhost:5000")
    logger.info("📍 Available endpoints:")
    logger.info("   - GET  /health - Health check")
    logger.info("   - POST /predict/agb - Predict AGB (14 features)")
    logger.info("   - POST /predict/soc - Predict SOC (16 features)")
    logger.info("   - POST /predict/carbon - Predict all carbon components")
    logger.info("   - GET  /models/info - Get models information")
    
    # Run the Flask app
    app.run(
        host='0.0.0.0',
        port=5000,
        debug=False,
        use_reloader=False
    )


if __name__ == '__main__':
    main()
