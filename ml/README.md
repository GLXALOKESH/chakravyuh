# Chakravyuh — ML & Data Pipeline

This directory contains the full fraud-ring detection pipeline:
synthetic data generation, graph feature extraction, V1/V2 XGBoost models,
ring discovery, taint tracing, freeze optimisation, and the **Ouroboros**
red-vs-blue adversarial loop.

---

## Quick Start (one command)

```bash
# From the repo root — generates data, trains models, runs Ouroboros,
# computes geo predictions, converts to rupees, writes data/demo/
python ml/run.py

# Skip data generation if already done (faster re-run)
python ml/run.py --skip-generate

# Skip Ouroboros loop (much faster, for quick iterations)
python ml/run.py --skip-generate --skip-ouroboros

# Then seed the backend
cd server && pnpm run seed
```

---

## What `run.py` Does

```
STEP 1  generate.py  —  synthetic accounts, transactions, identifiers (train/test/demo)
STEP 2  pipeline.py  —  features → V1/V2 XGBoost → rings → taint → freeze → recruits
STEP 3  loop.py      —  Ouroboros: 3 rounds of red-team vs blue-team adversarial battle
STEP 4  geo          —  lat/lng predictions per account, geo_spread_km per ring
STEP 5  conversion   —  paise → rupees (server contract), role mapping, SALARY drop
STEP 6  export       —  writes data/demo/ for npm run seed
```

Output files (what `pnpm run seed` reads):

```
data/demo/
├── accounts.json         ← 926 accounts with risk_v1, risk_v2, signals, home {lat, lng}
├── identifiers.json      ← 475 device / phone / IP records
├── transactions.json     ← 8041 txns (SALARY removed, amounts in rupees)
├── ground_truth.json     ← ring membership (logged only, never served)
└── outputs/
    ├── rings.json        ← 3 rings with default_taint + default_freeze populated
    ├── alerts.json       ← 3 alerts
    ├── metrics.json      ← V1, V2, and Ouroboros model metrics
    ├── recruits.json     ← recruitment candidates
    ├── geo_predictions.json  ← per-account lat/lng + risk scores
    └── ouroboros_results.json  ← full round-by-round adversarial battle log
```

---

## Module Reference

| File | Purpose |
|------|---------|
| `run.py` | **Master orchestrator** — the one command to run everything |
| `generate.py` | Deterministic synthetic banking data (patterns A/B/C/D) |
| `features.py` | Per-account behavioural + graph features (16 features, V1 + V2) |
| `models.py` | XGBoost V1 (transaction-only), V2 (with identity), Isolation Forest |
| `rings.py` | Louvain community detection + role classification |
| `taint.py` | Proportional taint tracing (TRD §7.6) |
| `freeze.py` | Min-cut freeze optimiser (TRD §7.7) |
| `loop.py` | Ouroboros adversarial self-improving loop |
| `adversary.py` | Red-team: fraud ring mutation + evasion strategies |
| `detector.py` | Blue-team: fraud classifier with self-retraining |
| `geo.py` | Synthetic geospatial engine + KDE heatmaps |
| `pipeline.py` | ML sub-pipeline (called by run.py) |
| `service.py` | FastAPI live service on :8000 (POST /taint, /mincut) |
| `config.py` | Global seeds, thresholds, paths |

---

## The Ouroboros Loop (Red vs Blue)

```
Round 0:  Train detector on baseline data
          Baseline PR-AUC V2: 1.00,  Ring Recall: 1.00

Round 1:  Red generates 56 adversarial txns (Gaussian jitter, temporal shift)
          Blue detects 100% → retrains

Round 2:  Red adapts strategy, generates 44 adversarial txns
          Blue detects 100% → retrains

Round 3:  Red escalates — 68 adversarial txns, 18 new accounts
          Blue detects 90.7% (4 missed), retrains with harder examples

Final:    Post-training baseline recall: 0.76
          (model became slightly more conservative to handle adversarial cases)
```

---

## Live Service (FastAPI)

```bash
# Start the live ML service on port 8000
python ml/service.py
```

Endpoints:
- `GET  /health`     — liveness check
- `POST /taint`      — proportional taint trace (TRD §7.6)
- `POST /mincut`     — freeze optimiser (TRD §7.7)
- `POST /ouroboros/run` — run adversarial loop on demand

The Express server calls `/taint` and `/mincut` live (3s timeout).
If this service is down, the server falls back to cached `default_taint` /
`default_freeze` from the ring documents.

---

## Server Contract Notes

Key invariants this pipeline maintains:

- **Amounts in rupees** (not paise) — `amount`, `opening_balance`, all taint/freeze values
- **`channel` ∈ `UPI|IMPS|NEFT|ATM`** — validated, one bad value fails the seed
- **`from: "SALARY"` removed** — SALARY is not a real account id
- **`to: "CASH"` kept** — sentinel for ATM cash-outs
- **`location` only on ATM** — null otherwise
- **`role` ∈ `source|mule|controller|cash-out|member`** — coordinator→controller, relay→mule
- **`default_taint` populated** — needed for cached freeze path on dashboard
- **`is_fraud` stored, never served** — ground truth only

---

## Running Individual Steps

```bash
# Data generation only
python ml/generate.py --all              # all profiles
python ml/generate.py --profile demo    # demo only

# Full ML pipeline (without run.py orchestration)
python ml/pipeline.py --profile demo

# Adversarial loop only
python ml/loop.py --rounds 5 --profile demo

# Geo heatmap export
python -m ml.geo --generate --profile demo
```
