# Carbon Stock Calculation Pipeline - Implementation Guide

## Overview

This pipeline calculates carbon stock (AGB, SOC, and BGB) for verified land plots using:
1. **Satellite Data** - Sentinel-1, Sentinel-2, terrain, climate, soil data from Google Earth Engine
2. **ML Models** - Python-based Random Forest models for AGB and SOC prediction
3. **Web API** - FastAPI/Flask backend for model serving
4. **NextJS Frontend** - React components for user interaction

## Architecture

```
Frontend (NextJS)
    ↓
/api/carbon-monitoring (Node.js API Route)
    ↓ (fetches satellite data)
Google Earth Engine
    ↓ (sends features)
Model Server (Python, Flask)
    ↓
ML Models (SKLearn/XGBoost)
    ↓
Results (AGB, SOC, Uncertainty)
    ↓
Frontend Dashboard (Display Results)
```

## Files Structure

```
frontend/
├── ml/
│   ├── models/
│   │   ├── agb_satellite_rf_uncertainty.pkl    # AGB model
│   │   └── SOC_model.pkl                        # SOC model
│   └── model_server.py                          # Flask server [NEW]
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   └── carbon-monitoring/
│   │   │       └── route.ts                    # API endpoint for fetching satellite data
│   │   └── dashboard/
│   │       └── page.tsx                        # User dashboard [UPDATED]
│   └── lib/
│       ├── earthEngine.ts                      # Earth Engine utilities
│       └── carbonCalculation.ts                 # Carbon calculation helpers [NEW]
```

## Setup Instructions

### 1. Install Python Dependencies

```bash
cd frontend/ml
pip install flask flask-cors scikit-learn numpy pickle

# Optional for advanced ML models
pip install xgboost lightgbm
```

### 2. Start the Model Server

```bash
# From frontend/ml directory
python model_server.py

# Output should show:
# 🚀 Starting Carbon Stock Model Server...
# ✅ Models loaded successfully
# 🌐 Server running at http://localhost:5000
```

### 3. Environment Variables

Make sure these are set in `.env.local`:

```env
# Google Earth Engine credentials
GEE_PRIVATE_KEY="your-private-key"
GEE_SERVICE_ACCOUNT_EMAIL="your-service-account@..."
GEE_PROJECT_ID="your-project-id"

# Model server location (default is localhost:5000)
MODEL_SERVER_URL="http://localhost:5000"
```

## API Endpoints

### Model Server Endpoints (Python Flask)

#### 1. Health Check
```
GET /health

Response:
{
  "status": "ok",
  "models_loaded": true,
  "message": "Model server is running"
}
```

#### 2. AGB Prediction
```
POST /predict/agb

Request:
{
  "features": {
    "B2": 0.15, "B3": 0.18, "B4": 0.10,
    "B5": 0.25, "B6": 0.35, "B7": 0.30,
    "B8": 0.50, "B11": 0.25, "B12": 0.20,
    "NDVI": 0.65, "VV": -13.5, "VH": -20.2,
    "elevation": 1250, "slope": 15
  }
}

Response:
{
  "success": true,
  "agb": 125.45,                    # tonnes per hectare
  "agb_uncertainty": 12.54,         # uncertainty (std dev)
  "bgb": 25.09                      # Below Ground Biomass
}
```

#### 3. SOC Prediction
```
POST /predict/soc

Request:
{
  "features": {
    "B2": 0.15, "B3": 0.18, "B4": 0.10, "B8": 0.50, "B11": 0.25,
    "NDVI": 0.65, "VV": -13.5, "VH": -20.2,
    "elevation": 1250, "slope": 15, "aspect": 180,
    "precip_annual": 2500, "temp_mean": 22.5,
    "soil_texture": 2, "latitude": 26.5, "longitude": 90.5
  }
}

Response:
{
  "success": true,
  "soc": 45.32                      # tonnes per hectare
}
```

#### 4. Full Carbon Prediction
```
POST /predict/carbon

Request:
{
  "agb_features": {...},
  "soc_features": {...}
}

Response:
{
  "success": true,
  "agb": 125.45,
  "agb_uncertainty": 12.54,
  "bgb": 25.09,
  "soc": 45.32,
  "total_carbon": 195.86,           # AGB + BGB + SOC
  "co2_equivalent": 718.51          # total_carbon * 3.67
}
```

#### 5. Model Information
```
GET /models/info

Response:
{
  "models_loaded": true,
  "models": {
    "agb": {
      "type": "RandomForestRegressor",
      "features_expected": 14,
      "description": "Above Ground Biomass with uncertainty"
    },
    "soc": {
      "type": "RandomForestRegressor",
      "features_expected": 16,
      "description": "Soil Organic Carbon"
    }
  }
}
```

### Frontend API (NextJS)

#### Carbon Monitoring Endpoint
```
POST /api/carbon-monitoring

Request:
{
  "landId": "abcdef1234567890",
  "ipfsCid": "QmXxxx...",
  "areaHectares": 25.5,
  "publicKey": "wallet_address",
  "startYear": 2025,
  "endYear": 2026,
  "isVerified": true
}

Response:
{
  "success": true,
  "data": {
    "land": {
      "landId": "abcdef1234567890",
      "owner": "wallet_address",
      "areaHectares": 25.5,
      "isVerified": true
    },
    "startYear": {
      "year": 2025,
      "totalAreaHa": 25.5,
      "carbonPools": {
        "agb": 125.45,
        "bgb": 25.09,
        "soc": 45.32
      },
      "totalCarbonDensity": 195.86,
      "totalCarbonStock": 4994.43,
      "co2Equivalent": 18345.42
    },
    "endYear": {
      "year": 2026,
      "totalAreaHa": 25.5,
      "carbonPools": {
        "agb": 128.50,
        "bgb": 25.70,
        "soc": 46.15
      },
      "totalCarbonDensity": 200.35,
      "totalCarbonStock": 5108.93,
      "co2Equivalent": 18751.76
    },
    "carbonChange": {
      "agbChange": 3.05,
      "bgbChange": 0.61,
      "socChange": 0.83,
      "densityChange": 4.49,
      "totalChange": 114.50,
      "percentChange": 2.29,
      "annualChange": 114.50,
      "co2EquivalentChange": 420.24,
      "status": "Carbon Gain"
    },
    "period": {
      "startYear": 2025,
      "endYear": 2026,
      "durationYears": 1
    },
    "area": {
      "hectares": 25.5,
      "squareMeters": 255000
    },
    "metadata": {
      "analysisDate": "2026-04-16T10:30:00Z",
      "coordinateSystem": "EPSG:4326",
      "dataSource": {
        "coordinates": "Fetched from IPFS",
        "area": "From Solana blockchain",
        "satelliteImagery": "Sentinel-1, Sentinel-2, SRTM, CHIRPS, ERA5"
      },
      "formulas": {
        "bgb": "BGB = AGB × 0.2",
        "soc": "SOC = H × BD × OC × 0.01",
        "total": "Total = AGB + BGB + SOC",
        "co2": "CO₂ = Carbon × 3.67"
      },
      "models": {
        "agb": "Random Forest (19 features)",
        "soc": "Random Forest (16 features)"
      }
    }
  }
}
```

## Features Explanation

### AGB Model Input Features (14 primary)

| Feature | Source | Description |
|---------|--------|-------------|
| B2-B12 | Sentinel-2 | Optical bands (reflectance) |
| NDVI | Calculated | Normalized Difference Vegetation Index |
| VV, VH | Sentinel-1 | SAR polarization |
| Elevation | SRTM | Terrain elevation (meters) |
| Slope | Calculated | Terrain slope (degrees) |

### SOC Model Input Features (16 total)

| Feature | Source | Description |
|---------|--------|-------------|
| B2, B3, B4, B8, B11 | Sentinel-2 | Selected optical bands |
| NDVI | Calculated | Vegetation index |
| VV, VH | Sentinel-1 | SAR data |
| Elevation, Slope, Aspect | SRTM | Terrain features |
| Precip, Temp | ERA5-Land | Climate data |
| Soil Texture | OpenLandMap | Soil classification |
| Latitude, Longitude | Geometry | Location coordinates |

## Usage Flow

### 1. User Registers Land
- Draws polygon on map
- Uploads document
- Stores coordinates on blockchain

### 2. Authority Verifies Land
- Reviews documents
- Approves registration
- Updates blockchain

### 3. User Calculates Credits
- Clicks "Calculate Credits" button
- Frontend calls `/api/carbon-monitoring`
- API fetches satellite data from Earth Engine
- API sends features to Python model server
- Models predict AGB, SOC values
- Results displayed on dashboard

### 4. View Results
- Dashboard shows:
  - Carbon density (t/ha)
  - Total carbon stock (tonnes)
  - CO2 equivalent
  - Uncertainty estimates
  - Carbon change over period

## Error Handling

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| "Model server not running" | Flask server down | Run `python model_server.py` |
| "Missing features" | Incomplete satellite data | Wait a moment and retry |
| "No Sentinel data available" | Cloud cover or data gap | Choose different year |
| "Land must be verified" | Awaiting authority approval | Contact administrator |
| "Invalid geometry" | Polygon drawing issue | Re-register land with new polygon |

## Performance Considerations

1. **Satellite Data Fetching**: ~10-30 seconds per year
   - Depends on cloud cover and image availability
   - Multiple sources (Sentinel, ERA5, SRTM, etc.)

2. **Model Prediction**: <1 second
   - Local execution on Python server
   - Ensemble predictions for uncertainty

3. **Total Request**: ~30-60 seconds
   - Includes data fetching and model inference

## Troubleshooting

### Model Server Won't Start
```bash
# Check Python version
python --version  # Should be 3.8+

# Verify dependencies
pip list | grep flask

# Try verbose startup
python model_server.py -v
```

### Models Fail to Load
```bash
# Check model file paths
ls -la frontend/ml/models/

# Verify pickle compatibility
python -c "import pickle; pickle.load(open('frontend/ml/models/agb_satellite_rf_uncertainty.pkl', 'rb'))"
```

### Earth Engine Data Issues
```bash
# Test Earth Engine connection
curl http://localhost:5000/health

# Check Earth Engine credentials
echo $GEE_PRIVATE_KEY  # Should not be empty
```

## Next Steps

1. ✅ Create `model_server.py` - **DONE**
2. ✅ Create carbon calculation utilities - **DONE**
3. Integrate into dashboard (update `page.tsx`)
4. Test end-to-end workflow
5. Add error notifications
6. Deploy model server to production
7. Add carbon credit minting functionality

## Support

For issues or questions:
1. Check logs: `frontend/ml/model_server.py` output
2. Verify environment variables
3. Test model server health endpoint
4. Check satellite data availability for your location
