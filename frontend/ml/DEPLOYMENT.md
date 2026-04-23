# Model Server Deployment Guide

## Quick Start

### 1. Install Dependencies

```bash
# Navigate to the frontend directory
cd frontend

# Install Python dependencies
pip install flask flask-cors scikit-learn numpy pandas

# Optional: For enhanced ML capabilities
pip install xgboost lightgbm joblib

# Verify installation
pip list | grep -E "flask|scikit-learn|numpy"
```

### 2. Verify Models Exist

```bash
# Check that the model files are present
ls -la ml/models/

# Output should show:
# agb_satellite_rf_uncertainty.pkl (AGB model)
# SOC_model.pkl (SOC model)
```

### 3. Start the Model Server

```bash
# From frontend directory
python ml/model_server.py

# Expected output:
# 🚀 Starting Carbon Stock Model Server...
# Loading models from frontend/ml/models/...
# ✅ Models loaded successfully
# 🌐 Server running at http://localhost:5000
# Press CTRL+C to stop
```

## Production Deployment

### Using Gunicorn (Recommended for Production)

```bash
# Install Gunicorn
pip install gunicorn

# Run with Gunicorn (4 workers, production mode)
gunicorn -w 4 -b 0.0.0.0:5000 ml.model_server:app

# Run with more workers for high load
gunicorn -w 8 -b 0.0.0.0:5000 --timeout 300 ml.model_server:app
```

### Docker Deployment

Create `Dockerfile`:
```dockerfile
FROM python:3.10-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY ml/ ./ml/

EXPOSE 5000

CMD ["python", "ml/model_server.py"]
```

Build and run:
```bash
# Build
docker build -t carbon-model-server .

# Run
docker run -p 5000:5000 carbon-model-server
```

### Systemd Service (Linux)

Create `/etc/systemd/system/carbon-model.service`:
```ini
[Unit]
Description=Carbon Stock Model Server
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/path/to/frontend
ExecStart=/usr/bin/python3 ml/model_server.py
Restart=on-failure
RestartSec=10s

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable carbon-model
sudo systemctl start carbon-model
sudo systemctl status carbon-model
```

## Testing the Deployment

### 1. Health Check

```bash
curl http://localhost:5000/health

# Expected response:
# {
#   "status": "ok",
#   "models_loaded": true,
#   "message": "Model server is running"
# }
```

### 2. Model Information

```bash
curl http://localhost:5000/models/info

# Expected response with model details
```

### 3. Test AGB Prediction

```bash
curl -X POST http://localhost:5000/predict/agb \
  -H "Content-Type: application/json" \
  -d '{
    "features": {
      "B2": 0.15, "B3": 0.18, "B4": 0.10,
      "B5": 0.25, "B6": 0.35, "B7": 0.30,
      "B8": 0.50, "B11": 0.25, "B12": 0.20,
      "NDVI": 0.65, "VV": -13.5, "VH": -20.2,
      "elevation": 1250, "slope": 15
    }
  }'

# Expected response with AGB and uncertainty
```

## Troubleshooting

### Server Won't Start

**Error: "No module named 'flask'"**
```bash
# Install Flask
pip install flask flask-cors
```

**Error: "Model file not found"**
```bash
# Verify model paths
ls -la ml/models/agb_satellite_rf_uncertainty.pkl
ls -la ml/models/SOC_model.pkl

# Update paths in model_server.py if needed
```

**Error: "Port 5000 already in use"**
```bash
# Find process using port 5000
lsof -i :5000

# Kill the process
kill -9 <PID>

# Or use different port
python ml/model_server.py --port 5001
```

### Model Loading Issues

**Error: "Pickle protocol mismatch"**
```bash
# Verify model compatibility
python -c "import pickle; pickle.load(open('ml/models/agb_satellite_rf_uncertainty.pkl', 'rb'))"

# If error, models may need retraining with current Python/sklearn version
```

**Error: "Feature mismatch"**
```bash
# Check expected features in model_server.py
# Ensure satellite data provides all required bands
grep -n "required_features" ml/model_server.py
```

### Connection Issues

**Error: "Connection refused"**
```bash
# Check if server is running
curl http://localhost:5000/health

# Check logs
ps aux | grep model_server

# If not running, start it:
python ml/model_server.py
```

**Error: "CORS error in browser"**
```bash
# Server has CORS enabled by default
# Check header in response:
curl -v http://localhost:5000/health | grep -i "access-control"
```

## Performance Tuning

### Configuration Parameters

Edit `ml/model_server.py` to adjust:

```python
# Number of threads for prediction
N_JOBS = -1  # Use all available cores

# Cache satellite data (reduce API calls)
CACHE_SATELLITE_DATA = True
CACHE_TTL = 3600  # seconds

# Batch prediction size
BATCH_SIZE = 32
```

### Monitoring

Check server logs:
```bash
# View recent logs
tail -f /var/log/carbon-model.log

# Count predictions per hour
grep "POST /predict" /var/log/carbon-model.log | wc -l
```

### Load Testing

```bash
# Install Apache Bench
sudo apt-get install apache2-utils

# Test with 100 concurrent requests
ab -n 100 -c 10 http://localhost:5000/health

# Stress test predictions
for i in {1..100}; do
  curl -X POST http://localhost:5000/predict/agb \
    -H "Content-Type: application/json" \
    -d '{...}' &
done
```

## Environment Variables

Create `.env` file in `frontend/` directory:

```env
# Model server configuration
MODEL_SERVER_HOST=localhost
MODEL_SERVER_PORT=5000
MODEL_SERVER_TIMEOUT=300

# ML model paths
AGB_MODEL_PATH=ml/models/agb_satellite_rf_uncertainty.pkl
SOC_MODEL_PATH=ml/models/SOC_model.pkl

# Feature validation
VALIDATE_FEATURES=true
CACHE_PREDICTIONS=true
```

Load in `model_server.py`:
```python
from dotenv import load_dotenv
import os

load_dotenv('../.env')

HOST = os.getenv('MODEL_SERVER_HOST', 'localhost')
PORT = int(os.getenv('MODEL_SERVER_PORT', 5000))
```

## Integration with Frontend

### Connecting Dashboard

The dashboard automatically uses the model server when:

1. User clicks "📊 Calculate Credits" button
2. Frontend calls `/api/carbon-monitoring` API route
3. API fetches satellite data from Earth Engine
4. API calls `/predict/agb` and `/predict/soc` on model server
5. Results displayed on dashboard

### Supported Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Server health check |
| GET | `/models/info` | Model metadata |
| POST | `/predict/agb` | AGB prediction |
| POST | `/predict/soc` | SOC prediction |
| POST | `/predict/carbon` | Combined prediction |

## Advanced Configuration

### Custom Model Loading

```python
# In model_server.py

def load_custom_models():
    """Load models from custom paths"""
    import joblib
    
    agb_model = joblib.load('path/to/agb_model.joblib')
    soc_model = joblib.load('path/to/soc_model.joblib')
    
    return agb_model, soc_model
```

### Feature Preprocessing

```python
# Add preprocessing pipeline
from sklearn.preprocessing import StandardScaler

def preprocess_features(features):
    """Normalize features before prediction"""
    scaler = StandardScaler()
    return scaler.fit_transform([features])[0]
```

### Uncertainty Quantification

```python
# Get prediction confidence
def get_prediction_with_confidence(model, features, n_estimators=100):
    """Get mean and std from ensemble predictions"""
    predictions = [
        tree.predict([features])[0] 
        for tree in model.estimators_
    ]
    return {
        'mean': np.mean(predictions),
        'std': np.std(predictions),
        'confidence': 1 - (np.std(predictions) / np.mean(predictions))
    }
```

## Monitoring & Logging

### Enable Debug Logging

```python
import logging

logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('ml/logs/model_server.log'),
        logging.StreamHandler()
    ]
)
```

### Request Tracking

```bash
# Count requests by endpoint
grep "POST\|GET" ml/logs/model_server.log | cut -d' ' -f7 | sort | uniq -c

# Find slow requests (>5 seconds)
grep "Response time:" ml/logs/model_server.log | awk '$NF > 5'
```

## Backup & Recovery

### Backup Models

```bash
# Create backup
tar -czf ml/models/backup_$(date +%Y%m%d).tar.gz ml/models/*.pkl

# Restore from backup
tar -xzf ml/models/backup_20240101.tar.gz
```

### Model Versioning

```bash
# Tag model versions
mv agb_satellite_rf_uncertainty.pkl agb_v1.0.pkl
mv SOC_model.pkl soc_v1.0.pkl

# Update model_server.py to use versioned models
```

## Next Steps

1. ✅ Install dependencies
2. ✅ Start model server
3. ✅ Test health endpoint
4. ✅ Wire dashboard button (already done)
5. Click "Calculate Credits" in dashboard
6. View results with AGB, SOC, and carbon change metrics

## Support & Debugging

For detailed logs and debugging:

```bash
# Run in debug mode
python -c "from ml.model_server import app; app.run(debug=True, port=5000)"

# Test specific prediction
python ml/test_models.py

# Check model features
python -c "import pickle; m = pickle.load(open('ml/models/agb_satellite_rf_uncertainty.pkl', 'rb')); print(m.n_features_)"
```
