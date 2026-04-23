# 🚀 Quick Start Guide - Carbon Calculation Pipeline

## 5-Minute Setup

### Terminal 1: Start Model Server

```bash
cd frontend
pip install flask flask-cors scikit-learn numpy pandas
python ml/model_server.py
```

Expected output:
```
🚀 Starting Carbon Stock Model Server...
✅ Models loaded successfully
🌐 Server running at http://localhost:5000
```

### Terminal 2: Verify Server is Running

```bash
# Test health check
curl http://localhost:5000/health

# Should return:
# {"status":"ok","models_loaded":true,"message":"Model server is running"}
```

### Browser: Test Dashboard

1. Go to `http://localhost:3000`
2. Connect wallet
3. Go to Dashboard
4. Click "📊 Calculate Credits" on a verified land
5. Wait 30-60 seconds
6. View carbon calculation results

---

## 📊 What You'll See

**Results Display:**
```
✅ 2025 Starting Values
   AGB: 125.45 t/ha
   BGB: 25.09 t/ha
   SOC: 45.32 t/ha
   Total Stock: 4,994 t

✅ 2026 Ending Values
   AGB: 128.50 t/ha
   BGB: 25.70 t/ha
   SOC: 46.15 t/ha
   Total Stock: 5,108 t

✅ Carbon Impact (1 year)
   AGB Change: +3.05 t/ha
   SOC Change: +0.83 t/ha
   Total Change: +114 t
   CO₂ Change: +420 t CO₂
   Status: ✅ Carbon Gain
```

---

## 🆘 Troubleshooting

| Issue | Solution |
|-------|----------|
| "IPFS data is not valid JSON" | Your land was registered with wrong file type. See [REGISTRATION_FIX.md](REGISTRATION_FIX.md) |
| "Content-Type: image/jpeg" | Geometry CID is an image, not GeoJSON. Re-register your land (see fix guide) |
| "Connection refused" | Start model server: `python ml/model_server.py` |
| "Models won't load" | Check files: `ls ml/models/*.pkl` |
| "No module flask" | Install: `pip install flask flask-cors` |
| "Port 5000 in use" | Kill: `lsof -i :5000 \| kill -9 <PID>` |
| "Results not showing" | Verify land is verified first |

---

## 📚 Documentation

- **Architecture**: `frontend/ml/README.md`
- **Deployment**: `frontend/ml/DEPLOYMENT.md`
- **Testing**: `frontend/ml/TESTING.md`
- **Summary**: `CARBON_PIPELINE_SUMMARY.md`

---

## ⚙️ How It Works (3 Steps)

```
1. Click "Calculate Credits"
         ↓
2. Fetch satellite data + Run ML models
   (Earth Engine → Model Server → Predictions)
         ↓
3. Display results with carbon change metrics
```

---

## 🎯 Key Features

✅ Real satellite data (Sentinel-1, Sentinel-2, ERA5)
✅ Machine learning predictions (AGB + SOC)
✅ Uncertainty quantification
✅ CO2 equivalent calculations
✅ Year-over-year change tracking
✅ Complete error handling

---

## 📋 Checklist

- [ ] Python 3.8+ installed
- [ ] Flask dependencies installed
- [ ] Model files exist: `ml/models/*.pkl`
- [ ] Model server running on localhost:5000
- [ ] Health check passes: `curl http://localhost:5000/health`
- [ ] Land is verified on blockchain
- [ ] Dashboard loads without errors
- [ ] "Calculate Credits" button is enabled

---

## 🚨 Common Issues

**Q: Button is disabled**
A: Land must be verified first. Go to Authority page to verify.

**Q: Calculation takes too long**
A: Normal - fetching satellite data takes 15-30 seconds. Check logs.

**Q: Results are empty**
A: Ensure model server is running and land data is complete.

**Q: Different results each time**
A: By design - each year's satellite data changes, models may have uncertainty.

---

## 📞 Need Help?

Check the documentation:
- Architecture: `frontend/ml/README.md`
- Deployment: `frontend/ml/DEPLOYMENT.md`  
- Testing: `frontend/ml/TESTING.md`

Or check browser console (F12) for detailed error messages.

---

**Status: ✅ Ready to Deploy**

Your complete carbon calculation pipeline is ready. Start with "5-Minute Setup" above!
