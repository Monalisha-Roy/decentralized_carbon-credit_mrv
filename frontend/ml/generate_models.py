"""
Generate placeholder ML models for carbon stock prediction.
This creates valid scikit-learn models that can be used for testing.
"""

import pickle
import numpy as np
from sklearn.ensemble import RandomForestRegressor
from pathlib import Path

# Get the models directory
models_dir = Path(__file__).parent / "models"
models_dir.mkdir(exist_ok=True)

# Create a simple Random Forest model for AGB
print("Creating AGB model...")
agb_model = RandomForestRegressor(
    n_estimators=10,
    max_depth=10,
    random_state=42,
    n_jobs=-1
)

# Train on dummy data
X_dummy = np.random.rand(100, 14)  # 14 features
y_agb_dummy = np.random.rand(100) * 200  # AGB values 0-200 t/ha

agb_model.fit(X_dummy, y_agb_dummy)

# Save AGB model
agb_path = models_dir / "agb_satellite_rf_uncertainty.pkl"
with open(agb_path, 'wb') as f:
    pickle.dump(agb_model, f)
print(f"✅ AGB model saved to {agb_path}")

# Create a simple Random Forest model for SOC
print("Creating SOC model...")
soc_model = RandomForestRegressor(
    n_estimators=10,
    max_depth=10,
    random_state=42,
    n_jobs=-1
)

# Train on dummy data
X_soc_dummy = np.random.rand(100, 16)  # 16 features
y_soc_dummy = np.random.rand(100) * 100  # SOC values 0-100 t/ha

soc_model.fit(X_soc_dummy, y_soc_dummy)

# Save SOC model
soc_path = models_dir / "SOC_model.pkl"
with open(soc_path, 'wb') as f:
    pickle.dump(soc_model, f)
print(f"✅ SOC model saved to {soc_path}")

print("\n✅ All models generated successfully!")
print(f"Models are ready at: {models_dir}")
