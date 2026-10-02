# Chakravyuh — ML & Data Pipeline <-> Express (TypeScript) Integration Contract

This document provides the exact integration specifications, JSON schemas, and **TypeScript interfaces** for connecting the Python ML/Data layer with an **Express + TypeScript** backend.

---

## 1. Architecture Flow for Express (TypeScript)

Since the backend is in Node.js/Express, Python and Node communicate primarily via **JSON data files in `data/`** (or a child process if dynamic inference is needed).

```
+------------------------------------+
|        Python ML Pipeline          |
|  (generate.py -> models.py)        |
+------------------------------------+
                  |
                  | Writes precomputed JSONs to disk
                  v
+------------------------------------+
|               data/                |
|  - accounts.json                   |
|  - transactions.json               |
|  - predictions.json                |
|  - detected_rings.json             |
|  - graph_network.json              |
+------------------------------------+
                  |
                  | Express reads files directly (fs / import)
                  v
+------------------------------------+
|     Express + TypeScript Server    |
|   (REST API routes for UI)         |
+------------------------------------+
```

---

## 2. Ready-to-Use TypeScript Interfaces (`types.ts`)

Give these types to the backend developer so they have full type safety:

```typescript
// types/chakravyuh.ts

export type RiskBand = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type KycStatus = 'VERIFIED' | 'PENDING' | 'FLAGGED';
export type AccountType = 'SAVINGS' | 'CURRENT' | 'SALARY';
export type TxnType = 'UPI' | 'IMPS' | 'NEFT' | 'ATM' | 'SALARY_CREDIT';
export type RingPatternType = 'CYCLE' | 'FAN_IN' | 'FAN_OUT' | 'COMMUNITY';

export interface Account {
  _id: string;              // e.g. "ACC10001"
  account_number: string;   // e.g. "100019283746"
  name: string;             // e.g. "Rajesh Sharma"
  account_type: AccountType;
  created_at: string;       // ISO 8601 string
  opening_balance: number;  // In INTEGER PAISE (₹50,000 = 5000000)
  phone: string;
  pan_masked: string;
  kyc_status: KycStatus;
}

export interface Transaction {
  txn_id: string;           // e.g. "TXN9081234"
  timestamp: string;        // ISO 8601 string
  from: string;             // Sender Account ID (e.g. "ACC10001" or "SALARY")
  to: string;               // Receiver Account ID (e.g. "ACC10042" or "CASH")
  amount: number;           // In INTEGER PAISE (e.g. 2500000 = ₹25,000.00)
  txn_type: TxnType;
  status: 'COMPLETED' | 'FAILED';
  description?: string;
}

export interface FeatureContribution {
  feature: string;          // e.g. "cycle_participation_count"
  impact: number;           // Relative weight/impact (0.0 to 1.0)
  value: number;            // Observed feature value
}

export interface PredictionScore {
  account_id: string;
  risk_score: number;       // Normalized score (0.00 to 1.00 or 0 to 100)
  risk_band: RiskBand;      // "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
  is_mule: boolean;
  reasons: string[];        // Human-readable fraud flags
  top_features: FeatureContribution[];
}

export interface DetectedRing {
  ring_id: string;
  pattern_type: RingPatternType;
  risk_level: RiskBand;
  member_accounts: string[];
  total_flow_amount: number; // In paise
  first_seen: string;
  last_seen: string;
  summary: string;
}

export interface GraphNode {
  id: string;
  label: string;
  risk_score: number;
  risk_band: RiskBand;
  is_mule: boolean;
}

export interface GraphLink {
  source: string;
  target: string;
  amount: number;
  count: number;
}

export interface GraphNetwork {
  nodes: GraphNode[];
  links: GraphLink[];
}
```

---

## 3. How Express Loads the Data (Code Example)

The Express backend can read the pre-generated JSON files directly on startup into memory (or serve them via repository services):

```typescript
import express, { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { Account, Transaction, PredictionScore, DetectedRing, GraphNetwork } from './types/chakravyuh';

const app = express();
const DATA_DIR = path.join(__dirname, '../data');

// Load JSON data synchronously or via cache
const accounts: Account[] = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'accounts.json'), 'utf-8'));
const transactions: Transaction[] = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'transactions.json'), 'utf-8'));
const predictions: PredictionScore[] = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'predictions.json'), 'utf-8'));
const rings: DetectedRing[] = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'detected_rings.json'), 'utf-8'));
const graph: GraphNetwork = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'graph_network.json'), 'utf-8'));

// 1. Get Top High Risk Accounts for Dashboard
app.get('/api/accounts/flagged', (req: Request, res: Response) => {
  const highRisk = predictions
    .filter(p => p.risk_band === 'HIGH' || p.risk_band === 'CRITICAL')
    .sort((a, b) => b.risk_score - a.risk_score);
  res.json(highRisk);
});

// 2. Get Account Details + Risk Profile
app.get('/api/accounts/:id', (req: Request, res: Response) => {
  const acc = accounts.find(a => a._id === req.params.id);
  const score = predictions.find(p => p.account_id === req.params.id);
  if (!acc) return res.status(404).json({ error: 'Account not found' });
  res.json({ ...acc, prediction: score });
});

// 3. Get Full Fraud Network for Visualizer (Cytoscape / D3 / Sigma)
app.get('/api/graph/network', (req: Request, res: Response) => {
  res.json(graph);
});

// 4. Get Detected Fraud Rings
app.get('/api/rings', (req: Request, res: Response) => {
  res.json(rings);
});
```

---

## 4. Money & Unit Rules

- **Amounts in integer paise**: All monetary values are integers (1 INR = 100 paise).
  - To display in UI: `(amount / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR' })`
- **Zero Database Requirement**: Express does not need MongoDB running; reading the compiled JSONs from disk or memory is fast (<1ms) and perfectly portable.

---

## 5. Workflow Step-by-Step

1. **You (Data/ML)** run the generation & modeling scripts:
   ```bash
   python ml/generate.py --profile demo
   python ml/models.py --train --predict
   ```
   This generates all `.json` files into the `data/` folder.
2. **He (Express/TS Backend)** reads the `data/*.json` files and serves the REST endpoints to the Frontend.
