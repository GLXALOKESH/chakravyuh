# Chakravyuh — ML & Data Pipeline Documentation

This directory contains the synthetic data generation engine, graph feature extractors, and the **Adversarial Self-Improving Loop (Model 1 vs. Model 2)**.

---

## 1. Directory Structure

```
ml/
├── config.py         # Global settings, paths, seeds, thresholds, hyperparameters
├── generate.py       # Deterministic baseline synthetic banking data generator
├── features.py       # Behavioral & graph topology feature extraction
├── models.py         # XGBoost (V1/V2) and Isolation Forest baseline models
├── adversary.py      # Model 1 (Red Team): Fraud mutation & evasion generator
├── detector.py       # Model 2 (Blue Team): Graph classifier & risk scorer
├── loop.py           # Infinity Snake continuous adversarial battle loop
├── export.py         # Formats and writes handoff JSONs to ../data/
└── saved_models/     # Pickled model binaries (.pkl)
```

---

## 2. The 2-Model Infinity Loop ("Ouroboros")

```
                 +-----------------------------+
                 |   Model 1: Adversary        |
                 |   (Red-Team Fraudster)      |
                 +-----------------------------+
                   |                         ^
   Generates fake  |                         | Adapts evasion tactics
   harder patterns |                         | based on missed frauds
                   v                         |
                 +-----------------------------+
                 |   Model 2: Detector         |
                 |   (Blue-Team Investigator)  |
                 +-----------------------------+
                   |
                   | Retrains & updates risk scores
                   v
                 +-----------------------------+
                 |    Export to ../data/*.json |
                 +-----------------------------+
```

1. **Model 1 (Adversary)**:
   - Starts with basic fraud (cycles, fans).
   - Learns what the Detector catches, then mutates:
     - Applies Gaussian amount jitter (avoiding exact round-number triggers).
     - Introduces Poisson temporal delay (avoiding rapid 24h turnover flags).
     - Multi-hop layer routing (breaking simple 3-node cycles).
2. **Model 2 (Detector)**:
   - Computes graph topological metrics (Tarjan cycles, flow ratios, PageRank).
   - Classifies risk scores and identifies top explainable features.
   - Retrains on new evasion tricks.

---

## 3. Quick Run Commands

```bash
# 1. Run baseline demo data generator
python ml/generate.py --profile demo

# 2. Run feature extraction and baseline model training
python ml/models.py --train --predict

# 3. Run the Adversarial Infinity Loop (e.g. 5 rounds)
python ml/loop.py
```
