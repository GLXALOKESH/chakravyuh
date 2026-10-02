"""
config.py — Centralised Configuration & Hyperparameters
=========================================================
Single source of truth for paths, thresholds, seeds, and ML hyperparameters.
"""

from pathlib import Path

# Paths
BASE_DIR = Path(__file__).resolve().parent.parent
ML_DIR = BASE_DIR / "ml"
DATA_DIR = BASE_DIR / "data"
SAVED_MODELS_DIR = ML_DIR / "saved_models"

# Ensure directories exist
DATA_DIR.mkdir(parents=True, exist_ok=True)
SAVED_MODELS_DIR.mkdir(parents=True, exist_ok=True)

# Random Seeds for Determinism
GLOBAL_SEED = 42

# Financial / Currency Constants (All calculations in Integer Paise)
PAISE_PER_INR = 100
REPORTING_THRESHOLD_PAISE = 50_000 * PAISE_PER_INR  # ₹50,000 reporting threshold

# Fraud Rule Thresholds
RAPID_TURNOVER_WINDOW_HOURS = 24
MIN_CYCLE_LENGTH = 3
MAX_CYCLE_LENGTH = 7
FAN_IN_OUT_MIN_ACCOUNTS = 5

# Risk Band Cutoffs (0.00 to 1.00)
RISK_BAND_THRESHOLDS = {
    "CRITICAL": 0.80,
    "HIGH": 0.60,
    "MEDIUM": 0.35,
    "LOW": 0.00,
}

# Model Hyperparameters
XGBOOST_PARAMS = {
    "n_estimators": 100,
    "max_depth": 5,
    "learning_rate": 0.05,
    "subsample": 0.8,
    "colsample_bytree": 0.8,
    "random_state": GLOBAL_SEED,
    "eval_metric": "logloss",
}

ISOLATION_FOREST_PARAMS = {
    "n_estimators": 100,
    "contamination": 0.08,
    "random_state": GLOBAL_SEED,
}
