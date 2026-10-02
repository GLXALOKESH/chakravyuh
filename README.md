# FraudGraph 🕵️
### Detecting Coordinated Financial Fraud Through Heterogeneous Identity and Transaction Graphs

> **CRYPT RC · 32-Hour Hackathon** · Cybersecurity Track

---

## Overview

FraudGraph is a full-stack fraud network intelligence platform that combines:
- **Heterogeneous Identity Graphs** (Account ↔ Device, IP, Phone)
- **Transaction Graphs** (directed money flow with weights)
- **ML-powered Risk Scoring** (XGBoost + Isolation Forest)
- **Community Detection** (Louvain algorithm via NetworkX)
- **Explainable AI** (plain-language reasons for every flag)
- **Early Warning System** (Network Recruitment Risk scoring)

---

## 🚀 Quick Start (One Command)

```bash
python run.py
```

This will:
1. Install all dependencies
2. Generate 20,000+ synthetic transactions with embedded fraud rings
3. Train XGBoost + Isolation Forest models
4. Launch the Streamlit dashboard at `http://localhost:8501`

### Manual steps

```bash
pip install -r requirements.txt
python data_generator.py      # Generate synthetic dataset
python fraud_engine.py        # Train models + compute scores
streamlit run app.py          # Launch dashboard
```

---

## 📁 Project Structure

```
FraudGraph/
├── app.py                  # Streamlit dashboard (6 pages)
├── data_generator.py       # Synthetic data generation
├── fraud_engine.py         # ML pipeline + feature engineering
├── visualizations.py       # PyVis + Plotly chart builders
├── run.py                  # One-command launcher
├── requirements.txt
├── .streamlit/
│   └── config.toml         # Dark theme configuration
├── data/                   # Auto-generated
│   ├── transactions.csv
│   ├── accounts.csv
│   ├── customers.csv
│   ├── identity_links.csv
│   ├── account_scores.csv
│   ├── communities.csv
│   └── stats.json
└── models/                 # Auto-generated
    ├── xgb_model.pkl
    ├── iso_forest.pkl
    ├── scaler.pkl
    └── feature_importances.json
```

---

## 🧩 Features

### 1. Synthetic Financial Dataset
- **20,000+** transactions across **1,000** accounts and **800** customers
- **5 embedded fraud rings**: Money Mule, Carousel, Account Takeover, Bust-out, Synthetic ID
- Realistic identity infrastructure: devices, IPs, phone numbers, addresses

### 2. Identity Graph
- Detects shared infrastructure across supposedly independent accounts
- Flags accounts sharing the same device, IP, or phone number

### 3. Transaction Graph
- Directed account-to-account money flow with amount + timestamp
- PageRank, betweenness centrality, in/out degree features
- Interactive PyVis visualization

### 4. Fraud Detection Models
| Model | Type | Purpose |
|---|---|---|
| **XGBoost** | Supervised | Uses known fraud labels for training |
| **Isolation Forest** | Unsupervised | Detects statistical anomalies |
| **Composite Score** | Ensemble | 60% XGBoost + 40% Isolation Forest → 0-100 |

### 5. Behavioral Features (20+)
- Transaction velocity, burst score, pass-through ratio
- Counterparty diversity, account age, shared devices/IPs
- Time delay between receiving and forwarding funds
- Large transaction ratio, out/in ratio

### 6. Fraud Network Detection
- Louvain community detection on transaction graph
- Marks communities with >30% fraud density as suspicious
- Shows network size, volume, and fraud density

### 7. Fraud Role Classification
| Role | Description |
|---|---|
| **Source** | Originates funds |
| **Coordinator** | Hub distributing to many mules |
| **Mule** | Receives and forwards funds |
| **Relay** | High pass-through, low counterparty diversity |
| **Cash-out** | Terminal node |
| **Normal** | Legitimate behavior |

### 8. Explainable AI
Every suspicious account shows plain-language reasons:
- "🔗 Shared device with 5 other accounts"
- "↔️ High pass-through ratio (92%) — funds in = funds out"
- "💥 Burst activity: 18 transactions in one hour"
- "🆕 Newly created account (23 days old)"

### 9. Fraud Timeline
Chronological money movement visualization per account with counterparty risk overlay.

### 10. Geographic Intelligence
- US scatter map of transactions colored by risk score
- City-level fraud volume breakdown

### 11. Early Warning — Network Recruitment Risk
Computes per-account probability of being recruited into a fraud ring using:
- Shared device/IP overlap with fraud accounts
- Account age
- Graph proximity
- Own behavioral risk

**Example:** `Account ACC000342 — Network Recruitment Risk: 82%`

### 12. Investigator Dashboard (6 pages)
| Page | Content |
|---|---|
| **Overview** | KPIs, timelines, risk distribution, active rings, alerts |
| **Network Explorer** | Interactive PyVis graph with filters |
| **Account Investigator** | Deep-dive: profile, explanations, timeline, connections |
| **Geographic Intelligence** | Map + city stats |
| **Analytics** | Fraud patterns, model performance, community analysis |
| **Early Warning** | Recruitment risk ranking |

---

## 🛠 Tech Stack (100% Free & Open Source)

| Component | Technology |
|---|---|
| Language | Python 3.10+ |
| Dashboard | Streamlit |
| Data processing | Pandas, NumPy |
| Supervised ML | XGBoost |
| Unsupervised ML | Scikit-learn (Isolation Forest) |
| Graph analysis | NetworkX, python-louvain |
| Network viz | PyVis |
| Charts | Plotly |
| Synthetic data | Faker |
| Geographic maps | Plotly Geo |

---

## 📊 Evaluation Criteria

- ✅ **Working end-to-end system** (data → features → model → dashboard)
- ✅ **Beautiful interactive visualization** (dark theme, PyVis + Plotly)
- ✅ **Explainability** (plain-language explanations for every flag)
- ✅ **Fraud network detection** (Louvain communities, ring detection)
- ✅ **"Who joins next?"** (Network Recruitment Risk feature)

---

*No paid APIs · No real customer data · Runs locally with `python run.py`*
