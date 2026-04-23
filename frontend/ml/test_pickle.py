import pickle
import sklearn
import traceback

print(f"scikit-learn version: {sklearn.__version__}")

try:
    with open('models/agb_satellite_rf_uncertainty.pkl', 'rb') as f:
        model = pickle.load(f)
    print("✅ Model loaded successfully")
except Exception as e:
    print(f"❌ Error loading model: {e}")
    traceback.print_exc()
