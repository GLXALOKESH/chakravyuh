#!/usr/bin/env python3
"""
Bootstrap script: installs deps, generates data, trains models, launches app.
Run: python run.py
"""
import subprocess
import sys
import os

def pip_install():
    print("📦 Installing dependencies...")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "-r", "requirements.txt", "-q"])

def generate_data():
    if os.path.exists("data/transactions.csv"):
        print("✅ Data already exists — skipping generation.")
        return
    print("🔧 Generating synthetic dataset...")
    subprocess.check_call([sys.executable, "data_generator.py"])

def run_pipeline():
    if os.path.exists("data/account_scores.csv"):
        print("✅ Model outputs already exist — skipping pipeline.")
        return
    print("🧠 Running fraud detection pipeline...")
    subprocess.check_call([sys.executable, "fraud_engine.py"])

def launch_app():
    print("\n🚀 Launching FraudGraph dashboard...")
    print("   → http://localhost:8501\n")
    subprocess.check_call(["streamlit", "run", "app.py", "--server.port=8501"])

if __name__ == "__main__":
    pip_install()
    generate_data()
    run_pipeline()
    launch_app()
