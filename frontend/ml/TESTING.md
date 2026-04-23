# Carbon Calculation Pipeline - Testing Guide

## End-to-End Testing Checklist

Use this guide to validate the complete carbon calculation pipeline before deploying to production.

---

## Phase 1: Environment Setup ✓

### 1.1 Verify Python Environment

```bash
# Check Python version (3.8+)
python --version
# Output: Python 3.10.x or higher

# Verify pip is available
pip --version

# Check virtual environment (if using one)
which python
```

### 1.2 Install Dependencies

```bash
cd frontend

# Install required packages
pip install flask flask-cors scikit-learn numpy pandas

# Verify installations
pip list | grep -E "Flask|scikit-learn|numpy|pandas"
```

### 1.3 Check Model Files

```bash
# Verify model files exist
ls -lh ml/models/

# Sample output:
# -rw-r--r--  1 user  staff   125M Jan  1  2024 agb_satellite_rf_uncertainty.pkl
# -rw-r--r--  1 user  staff    98M Jan  1  2024 SOC_model.pkl

# Quick validation - try loading models
python -c "
import pickle
agb = pickle.load(open('ml/models/agb_satellite_rf_uncertainty.pkl', 'rb'))
soc = pickle.load(open('ml/models/SOC_model.pkl', 'rb'))
print('✅ Both models loaded successfully')
print(f'AGB model: {type(agb)}')
print(f'SOC model: {type(soc)}')
"
```

---

## Phase 2: Model Server Testing

### 2.1 Start Model Server

```bash
# Start the server
python ml/model_server.py

# Expected output:
# 🚀 Starting Carbon Stock Model Server...
# ✅ Models loaded successfully
# 🌐 Server running at http://localhost:5000
# Available endpoints:
#   GET  /health
#   GET  /models/info
#   POST /predict/agb
#   POST /predict/soc
#   POST /predict/carbon

# KEEP THIS TERMINAL OPEN while running tests
```

### 2.2 Test Health Endpoint (in new terminal)

```bash
# Test if server is running
curl -X GET http://localhost:5000/health

# Expected response:
# {
#   "status": "ok",
#   "models_loaded": true,
#   "message": "Model server is running"
# }

echo "✅ Health check passed"
```

### 2.3 Test Model Information

```bash
curl -X GET http://localhost:5000/models/info

# Expected response includes:
# - Number of features required
# - Model types
# - Feature descriptions

echo "✅ Model info retrieved"
```

### 2.4 Test AGB Prediction

```bash
# Test with sample satellite features
curl -X POST http://localhost:5000/predict/agb \
  -H "Content-Type: application/json" \
  -d '{
    "features": {
      "B2": 0.15,
      "B3": 0.18,
      "B4": 0.10,
      "B5": 0.25,
      "B6": 0.35,
      "B7": 0.30,
      "B8": 0.50,
      "B11": 0.25,
      "B12": 0.20,
      "NDVI": 0.65,
      "VV": -13.5,
      "VH": -20.2,
      "elevation": 1250,
      "slope": 15
    }
  }' | python -m json.tool

# Expected response:
# {
#   "success": true,
#   "agb": 125.45,
#   "agb_uncertainty": 12.54,
#   "bgb": 25.09
# }

echo "✅ AGB prediction working"
```

### 2.5 Test SOC Prediction

```bash
# Test SOC model
curl -X POST http://localhost:5000/predict/soc \
  -H "Content-Type: application/json" \
  -d '{
    "features": {
      "B2": 0.15,
      "B3": 0.18,
      "B4": 0.10,
      "B8": 0.50,
      "B11": 0.25,
      "NDVI": 0.65,
      "VV": -13.5,
      "VH": -20.2,
      "elevation": 1250,
      "slope": 15,
      "aspect": 180,
      "precip_annual": 2500,
      "temp_mean": 22.5,
      "soil_texture": 2,
      "latitude": 26.5,
      "longitude": 90.5
    }
  }' | python -m json.tool

# Expected response:
# {
#   "success": true,
#   "soc": 45.32
# }

echo "✅ SOC prediction working"
```

### 2.6 Test Combined Prediction

```bash
# Test full carbon prediction endpoint
curl -X POST http://localhost:5000/predict/carbon \
  -H "Content-Type: application/json" \
  -d '{
    "agb_features": {
      "B2": 0.15, "B3": 0.18, "B4": 0.10, "B5": 0.25,
      "B6": 0.35, "B7": 0.30, "B8": 0.50, "B11": 0.25,
      "B12": 0.20, "NDVI": 0.65, "VV": -13.5, "VH": -20.2,
      "elevation": 1250, "slope": 15
    },
    "soc_features": {
      "B2": 0.15, "B3": 0.18, "B4": 0.10, "B8": 0.50,
      "B11": 0.25, "NDVI": 0.65, "VV": -13.5, "VH": -20.2,
      "elevation": 1250, "slope": 15, "aspect": 180,
      "precip_annual": 2500, "temp_mean": 22.5,
      "soil_texture": 2, "latitude": 26.5, "longitude": 90.5
    }
  }' | python -m json.tool

# Expected response:
# {
#   "success": true,
#   "agb": 125.45,
#   "agb_uncertainty": 12.54,
#   "bgb": 25.09,
#   "soc": 45.32,
#   "total_carbon": 195.86,
#   "co2_equivalent": 718.51
# }

echo "✅ Combined prediction working"
```

### 2.7 Test Error Handling

```bash
# Test with missing features
curl -X POST http://localhost:5000/predict/agb \
  -H "Content-Type: application/json" \
  -d '{
    "features": {
      "B2": 0.15
    }
  }'

# Expected response shows error with missing feature names
echo "✅ Error handling working"
```

---

## Phase 3: Frontend API Testing

### 3.1 Test Carbon Monitoring Route (with auth)

```bash
# Make authenticated request to /api/carbon-monitoring
# (You'll need a wallet connected in browser for this)

# Example - test from frontend by opening browser console:
const response = await fetch('/api/carbon-monitoring', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    landId: 'test-land-123',
    ipfsCid: 'QmXxxx...',
    areaHectares: 25.5,
    publicKey: 'your-wallet-address',
    startYear: 2025,
    endYear: 2026,
    isVerified: true
  })
});

const data = await response.json();
console.log(data);

// Expected: Full carbon monitoring response with AGB, SOC, CO2 equivalent
```

---

## Phase 4: Dashboard Integration Testing

### 4.1 Prepare Test Land Record

```bash
# You need a verified land for testing:
# 1. Connect wallet to app
# 2. Click "Register" → Draw polygon on map
# 3. Upload test document
# 4. Go to Authority page → Click "Verify Land"
# 5. Wait for transaction confirmation
```

### 4.2 Test Dashboard Button

```bash
# Once land is verified:
# 1. Go to Dashboard
# 2. Find your verified land in the list
# 3. Click "📊 Calculate Credits" button
# 4. Wait for calculation (30-60 seconds)
# 5. View results in expanded card
```

### 4.3 Verify Results Display

Results card should show:

```
✅ 2025 Starting Values
   - AGB: XX.XX t/ha
   - BGB: XX.XX t/ha
   - SOC: XX.XX t/ha
   - Total Stock: XXXX t

✅ 2026 Ending Values
   - AGB: XX.XX t/ha
   - BGB: XX.XX t/ha
   - SOC: XX.XX t/ha
   - Total Stock: XXXX t

✅ Carbon Impact (1 year)
   - AGB Change: +X.XX t/ha
   - SOC Change: +X.XX t/ha
   - Total Change: +XXX t
   - CO₂ Equivalent Change: +XXX t CO₂
   - Status: Carbon Gain
```

---

## Phase 5: Integration Testing

### 5.1 Complete Workflow Test

```bash
# Timeline: ~2 minutes + network latency

# T+0:00 - User clicks "Calculate Credits"
# T+0:01 - Frontend shows loading spinner
# T+0:05 - Earth Engine fetches satellite data (15-30 sec)
# T+0:35 - Model server receives features
# T+0:36 - AGB model predicts (< 1 sec)
# T+0:37 - SOC model predicts (< 1 sec)
# T+0:38 - Results displayed on dashboard
# T+0:38 - User can close or refresh results
```

### 5.2 Multiple Land Testing

```bash
# Test with multiple verified lands:
# 1. Register 2-3 different land plots
# 2. Verify each one
# 3. Calculate credits for each
# 4. Verify results are different based on location/satellite data
```

### 5.3 Edge Case Testing

```bash
# Test error scenarios:

# Case 1: Land not verified
# Expected: Error message "Land must be verified first"

# Case 2: Model server offline
# Expected: Error "Failed to calculate carbon credits"

# Case 3: No satellite data available
# Expected: Error "No satellite data available for this location"

# Case 4: Invalid coordinates
# Expected: Error "Invalid land geometry"
```

---

## Phase 6: Performance Testing

### 6.1 Response Time Benchmark

```bash
# Measure model server response time
time curl -X POST http://localhost:5000/predict/agb \
  -H "Content-Type: application/json" \
  -d '{...}'

# Expected: < 1 second
```

### 6.2 Concurrent Requests

```bash
# Test with multiple requests simultaneously
for i in {1..5}; do
  curl -X POST http://localhost:5000/predict/agb \
    -H "Content-Type: application/json" \
    -d '{...}' &
done
wait

# All should complete without errors
```

### 6.3 Memory Usage

```bash
# Monitor server memory
ps aux | grep model_server | grep -v grep

# Track over time with:
watch -n 1 'ps aux | grep model_server | grep -v grep'
```

---

## Phase 7: Production Readiness Checklist

- [ ] Model server runs without errors
- [ ] All endpoints respond correctly
- [ ] Health check returns `"models_loaded": true`
- [ ] AGB predictions have uncertainty values
- [ ] SOC predictions are reasonable
- [ ] Dashboard button shows loading state
- [ ] Results display correctly
- [ ] Error messages are user-friendly
- [ ] Model files are backed up
- [ ] CORS is enabled (headers show Access-Control-Allow-Origin)
- [ ] Response times < 60 seconds
- [ ] No console errors in browser

---

## Quick Validation Script

Save as `test_pipeline.sh`:

```bash
#!/bin/bash

set -e

echo "🧪 Testing Carbon Calculation Pipeline"
echo "========================================"

# Test 1: Model loading
echo -n "1. Checking models... "
python -c "
import pickle
pickle.load(open('frontend/ml/models/agb_satellite_rf_uncertainty.pkl', 'rb'))
pickle.load(open('frontend/ml/models/SOC_model.pkl', 'rb'))
print('✅')
"

# Test 2: Server health
echo -n "2. Server health check... "
HEALTH=$(curl -s http://localhost:5000/health | grep -o '"status":"ok"')
if [ -n "$HEALTH" ]; then echo "✅"; else echo "❌"; exit 1; fi

# Test 3: AGB prediction
echo -n "3. AGB prediction... "
curl -s -X POST http://localhost:5000/predict/agb \
  -H "Content-Type: application/json" \
  -d '{"features":{"B2":0.15,"B3":0.18,"B4":0.10,"B5":0.25,"B6":0.35,"B7":0.30,"B8":0.50,"B11":0.25,"B12":0.20,"NDVI":0.65,"VV":-13.5,"VH":-20.2,"elevation":1250,"slope":15}}' \
  | grep -q "agb" && echo "✅" || echo "❌"

# Test 4: SOC prediction
echo -n "4. SOC prediction... "
curl -s -X POST http://localhost:5000/predict/soc \
  -H "Content-Type: application/json" \
  -d '{"features":{"B2":0.15,"B3":0.18,"B4":0.10,"B8":0.50,"B11":0.25,"NDVI":0.65,"VV":-13.5,"VH":-20.2,"elevation":1250,"slope":15,"aspect":180,"precip_annual":2500,"temp_mean":22.5,"soil_texture":2,"latitude":26.5,"longitude":90.5}}' \
  | grep -q "soc" && echo "✅" || echo "❌"

echo ""
echo "✅ All tests passed! Pipeline is ready."
```

Run with:
```bash
chmod +x test_pipeline.sh
./test_pipeline.sh
```

---

## Debugging Failed Tests

### Issue: Models won't load

```bash
# Check file existence and permissions
ls -la frontend/ml/models/

# Try loading manually
python
>>> import pickle
>>> pickle.load(open('frontend/ml/models/agb_satellite_rf_uncertainty.pkl', 'rb'))
# If error - models may need retraining or file is corrupted
```

### Issue: Server won't start

```bash
# Check port availability
lsof -i :5000

# Check Python path
which python

# Run with verbose output
python -u ml/model_server.py
```

### Issue: Predictions are NaN

```bash
# Check feature ranges
echo "B2: 0.15 (should be 0-1 for reflectance)"
echo "elevation: 1250 (should be 0-8848 meters)"

# Verify model expects same features in model_server.py
```

---

## Support & Resources

- **Model Server Code**: `frontend/ml/model_server.py`
- **Carbon Utility**: `frontend/src/lib/carbonCalculation.ts`
- **API Route**: `frontend/src/app/api/carbon-monitoring/route.ts`
- **Dashboard**: `frontend/src/app/dashboard/page.tsx`
- **Documentation**: `frontend/ml/README.md`
- **Deployment**: `frontend/ml/DEPLOYMENT.md`

Next step: Deploy to production and monitor in production environment.
