# Chakravyuh — ML & Data Pipeline <-> Backend Integration Contract

This document defines the clear data flow, file formats, and expectations between the **Data/ML Engineer** and the **Backend Engineer**.

---

## 1. High-Level Architecture Overview

```
+---------------------+       Generates Files       +-----------------------+
|                     | --------------------------> |                       |
|   ML & Data Layer   |                             |    data/ (JSON/CSV)   |
|   (Python scripts)  | <-------------------------- |                       |
+---------------------+    Reads for Feature Eng    +-----------------------+
           |                                                    |
           | Exposes Python Functions                           | Ingests / Queries
           v                                                    v
+---------------------------------------------------------------------------+
|                              Backend Layer                                |
|                        (FastAPI / Flask / Node.js)                        |
|                                                                           |
|   - Serves REST APIs for Investigator UI                                  |
|   - Reads processed accounts, transactions, fraud rings, & risk scores    |
|   - Calls ML inference functions on-demand for specific account drilldowns|
+---------------------------------------------------------------------------+
```

---

## 2. From ML/Data Guy -> To Backend Guy (What You Give Him)

You provide **two delivery formats**:
1. **Static Data Dumps (JSON files in `data/`)**: For the backend to load into a database / cache or serve directly.
2. **Python Module Functions (`ml/models.py`, `ml/features.py`)**: For on-demand risk scoring and graph extraction.

---

### A. Generated Data Files (in `data/`)

#### 1. `data/accounts.json`
List of all bank accounts in the system.
```json
[
  {
    "_id": "ACC10001",
    "account_number": "100019283746",
    "name": "Rajesh Sharma",
    "account_type": "SAVINGS",
    "created_at": "2024-01-15T10:00:00Z",
    "opening_balance": 5000000,
    "phone": "+919876543210",
    "pan_masked": "ABCDE****F",
    "kyc_status": "VERIFIED"
  }
]
```
> **Note on Money**: All currency values (`opening_balance`, `amount`) are stored as **integer paise** (e.g. ₹50,000.00 = `5000000` paise). The frontend/backend divides by 100 for display.

#### 2. `data/transactions.json`
All synthetic transactions across accounts.
```json
[
  {
    "txn_id": "TXN9081234",
    "timestamp": "2024-02-01T14:22:10Z",
    "from_account": "ACC10001",
    "to_account": "ACC10042",
    "amount": 2500000,
    "txn_type": "UPI",
    "status": "COMPLETED",
    "description": "P2P transfer"
  }
]
```

#### 3. `data/predictions.json` (ML Risk Scoring Output)
Predictions computed by the ML models for every account.
```json
[
  {
    "account_id": "ACC10001",
    "risk_score": 0.89,
    "risk_band": "CRITICAL",
    "model_version": "V2_GRAPH_TABULAR",
    "is_mule": true,
    "top_contributing_features": [
      {"feature": "cycle_participation_count", "impact": 0.42, "value": 3},
      {"feature": "in_out_turnover_ratio_24h", "impact": 0.31, "value": 0.98},
      {"feature": "smurfing_entropy", "impact": 0.16, "value": 0.12}
    ]
  }
]
```

#### 4. `data/detected_rings.json` (Graph Topology & Rings)
Fraud rings detected by cycle detection, fan-in/fan-out, and community clustering.
```json
[
  {
    "ring_id": "RING_001",
    "pattern_type": "CYCLE",
    "risk_level": "CRITICAL",
    "member_accounts": ["ACC10001", "ACC10042", "ACC10099"],
    "total_flow_amount": 15000000,
    "first_seen": "2024-02-01T10:00:00Z",
    "last_seen": "2024-02-01T18:00:00Z",
    "summary": "Circular flow detected: ACC10001 -> ACC10042 -> ACC10099 -> ACC10001"
  }
]
```

---

### B. Python Functions Backend Can Import Directly

If the backend is built in Python (FastAPI/Flask), the backend can directly import functions from `ml/`:

```python
# In backend's service/route file:
from ml.models import predict_account_risk, get_feature_importance
from ml.features import extract_account_subgraph

# 1. Score a single account on-the-fly
result = predict_account_risk(account_id="ACC10001")
# returns: {"risk_score": 0.89, "risk_band": "CRITICAL", "reasons": [...]}

# 2. Get ego network graph for visualizer (nodes & links)
subgraph = extract_account_subgraph(account_id="ACC10001", hops=2)
# returns: {"nodes": [...], "edges": [...]}
```

---

## 3. From Backend Guy -> To ML Guy (What He Gives You / What to Expect)

1. **Target Account Queries for Dynamic Re-scoring**:
   - Backend sends: `account_id: str` or a batch list `account_ids: list[str]`.
   - ML returns: Score, explanations, and risk band.
2. **Graph Expansion Parameters**:
   - Backend sends: `account_id`, `hops` (e.g. 1 or 2 depth), and `date_range`.
   - ML/Graph module returns: Filtered node/edge list formatted for the visualizer.
3. **New Ingested Transactions (Optional Live Simulation)**:
   - Backend sends: New transaction dictionary `{from, to, amount, timestamp}`.
   - ML module updates feature graph and recalculates impacted node scores.

---

## 4. Summary Quick-Reference Table

| Item | Direction | Format | Purpose |
|---|---|---|---|
| `accounts.json` | ML -> Backend | JSON File | Account metadata & opening balances |
| `transactions.json` | ML -> Backend | JSON File | All transaction events |
| `predictions.json` | ML -> Backend | JSON File | Precomputed ML risk scores & feature explanations |
| `detected_rings.json` | ML -> Backend | JSON File | Detected mule rings & graph cycle structures |
| `ml.models.predict_account_risk()` | ML -> Backend | Python Call | Live single account risk scoring |
| `account_id` / `filter_params` | Backend -> ML | Python/HTTP | Investigation drilldown requests from UI |

---

## 5. How to Run & Verify

1. **ML Guy runs**:
   ```bash
   python ml/generate.py --profile demo
   python ml/models.py --train --predict
   ```
2. **Backend Guy runs**:
   - Reads files directly from `data/` or runs backend server to serve the JSON payloads to Frontend.
