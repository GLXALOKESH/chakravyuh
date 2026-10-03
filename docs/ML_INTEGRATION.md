# ML / Data Pipeline → Express API: Integration Contract

**Owner:** Member 1 (server). **Audience:** Member 3 (ML), and the AI agent
working in `ml/`.

This is the authoritative contract between the Python pipeline and the Express
server. It replaces any earlier interface proposal, and where the two disagree
this file wins — because it describes what the server actually reads and the
frontend already consumes.

Read §1 first. It is the part where the most important disagreement lives.

**Added 3 Oct 2026:** the backend persists the optional
`outputs/fund_flows.json` artifact through the existing file-based seed. See
[§3.9](#39-outputsfund_flowsjson--optional-object) for its schema and storage
rules. Its explicitly named paise fields retain their units.

---

## 1. Please read this: the server is on MongoDB, and the field names in the
TRD are not negotiable

Two points where an earlier draft of this contract needs correcting.

### 1.1 MongoDB stays

The earlier draft proposed "Zero Database Requirement — Express does not need
MongoDB running; reading the compiled JSONs from disk is fast and perfectly
portable."

The server is running MongoDB (Atlas) via Mongoose, and the team decided this.
Keeping it costs nothing: JSON files are read once at seed time, then served
from the database.

What MongoDB actually buys, which matters for this pipeline:

- **Atomic seeding.** The whole load runs in one transaction. If
  `models.py` dies halfway through writing outputs, the previous good data is
  still there. With files-on-disk there is no rollback — you get a half-seeded
  database and a demo that looks subtly wrong.
- **Indexes.** `/api/rings/RING01` returns a 16-node graph; `/api/accounts/:id`
  joins transactions, identifiers and risk signals. Those are indexed lookups.
- **Reproducibility.** Everyone seeds from the same files into the same shape, so
  a discrepancy is always a data problem, never a stale-cache problem.

So: **you write files, I load files.** That part of the draft is right and stays.
Only the serving layer differs, and you do not need to touch it.

### 1.2 Field names are fixed by TRD §6

TRD §6 states: *"Field names below are the contract between all three services."*
Two of you and the frontend are building against it in parallel. Renaming a
field is not a local decision.

The draft's types would not load. Concretely:

| Draft proposes | Server requires | What happens |
| --- | --- | --- |
| `txn_type` | `channel` | Transaction rejected — `channel` is required |
| `timestamp` | `ts` | Transaction rejected — `ts` is required |
| `txn_id` | `_id` | Transaction rejected — `_id` is required |
| `"SALARY"` as `from` | not a valid account | Inserts as a real account id |
| `txn_type: "SALARY_CREDIT"` | `channel` enum is `UPI\|IMPS\|NEFT\|ATM` | **Rejects the whole seed** |

That last one is the dangerous one. `channel` is validated by the schema, so a
single `SALARY_CREDIT` anywhere in `transactions.json` fails the entire load
rather than skipping one row.

**The existing account/transaction and public API amounts are rupees.** TRD §6
shows `"amount": 48000`; the server stores that value as-is. The additional
fund-flow artifact in §3.9 has explicitly named `*_paise` fields, which are
stored in integer paise without conversion. These are separate contracts.

### 1.3 What the draft left out

These have no counterpart in the proposed types, and the server needs all of
them. Without them, ring detection has nothing to attach to.

- `identifiers.json` — **the most important gap.** Device / phone / IP sharing is
  what links accounts that never transact directly. TRD calls it the V2 model
  ("V2 with identity") and the metrics table reports both V1 and V2. Without this
  file there is no identity graph, and `identity_links` on every ring is empty.
- `alerts.json`, `metrics.json`, `recruits.json` — pipeline outputs the API
  serves directly.
- `ground_truth.json` — optional, logged only, never sent to the dashboard.
- `home` / `location` on accounts and ATM transactions — needed for the geo map
  and required by the generator rules in §5.

---

## 2. What you write, and where

```bash
python ml/generate.py --profile demo     # you own this
python ml/pipeline.py --profile demo     # you own this
```

Output layout, one directory per profile:

```
data/demo/
├── accounts.json
├── identifiers.json
├── transactions.json
├── ground_truth.json          optional, logged only
└── outputs/
    ├── rings.json
    ├── alerts.json
    ├── metrics.json
    ├── recruits.json          optional
    └── fund_flows.json        optional; persisted as paths plus a summary
```

`SEED_PROFILE` selects the directory; default `demo`. Extra files are ignored,
and extra fields inside a file are ignored too, so you can carry whatever else
you need.

For an intentional file-based import, run from `server/`:

```bash
SEED_FIXTURES=false pnpm run seed demo
```

`SEED_FIXTURES=true` selects the built-in fixture generator even when the files
exist; it does not import the fund-flow artifact. With fixtures disabled, a
missing profile fails. This command replaces the whole registered dataset in
one transaction, so use a complete exported profile rather than treating it as
an import of just `fund_flows.json`.

---

## 3. File formats

IDs are strings. Timestamps are ISO 8601. Unknown fields are ignored; missing
optional fields become `null`.

### 3.1 `accounts.json` — array

```json
[
  {
    "_id": "ACC0042",
    "holder": "R. Sharma",
    "bank": "Bank B",
    "home": { "city": "Kolkata", "lat": 22.57, "lng": 88.36 },
    "opened_at": "2026-09-28T10:15:00Z",
    "opening_balance": 1200,
    "features": { "pass_through": 0.94, "median_hold_min": 6, "velocity_per_hr": 3.2 },
    "risk_v1": 0.41,
    "risk_v2": 0.88,
    "signals": [
      { "feature": "pass_through", "label": "Forwards 94% of what it receives", "weight": 0.31 }
    ],
    "ring_id": "RING01",
    "role": "mule",
    "role_reason": "Receives from source, forwards within 6 min"
  }
]
```

- `role` ∈ `source | mule | controller | cash-out | member`. TRD §7.5 closes
  this set. **Note for the ML side:** `cash-out` contains a hyphen and is not a
  legal identifier in most languages, which is why it is a plain string in the
  database rather than an enum.
- `features` is free-form — whatever your model consumes. It is stored as-is and
  echoed back on `/api/accounts/:id`.
- `risk_v1` is the transaction-only score, `risk_v2` the one that uses identity.
  Both are 0–1.

### 3.2 `identifiers.json` — array

```json
[{ "_id": "DEV017", "type": "device", "account_ids": ["ACC0042", "ACC0051"] }]
```

`type` ∈ `device | phone | ip`. One document with an array, not a row per link —
"which accounts share this device" is answered by the array itself.

### 3.3 `transactions.json` — array

```json
[
  {
    "_id": "TXN003981",
    "from": "ACC0042",
    "to": "ACC0051",
    "amount": 48000,
    "ts": "2026-10-01T09:42:10Z",
    "channel": "UPI",
    "location": null,
    "is_fraud": true
  }
]
```

- `channel` ∈ `UPI | IMPS | NEFT | ATM` — **validated, and a bad value fails the
  whole seed.** Map `txn_type` → `channel`; drop or remap `SALARY_CREDIT`.
- `location` is `{ "city", "lat", "lng" }` on `ATM` transactions and `null`
  otherwise.
- `to: "CASH"` is the cash-out sentinel (TRD §5). It is **not** an account and
  must not appear in `accounts.json`. `from: "SALARY"` is not defined anywhere —
  use a real account id.
- `is_fraud` is ground truth. It is stored and **never serialised** — the
  `Transaction` domain type has no such field, so no mapper can leak it, and a
  test asserts it appears in no response.

### 3.4 `ground_truth.json` — optional, object

Logged only. Never served. Use whatever shape is convenient.

### 3.5 `outputs/rings.json` — array

```json
[
  {
    "_id": "RING01",
    "member_ids": ["ACC0040", "ACC0042", "ACC0051"],
    "edges": [{ "from": "ACC0040", "to": "ACC0042", "amount": 150000, "count": 1 }],
    "identity_links": [{ "identifier": "DEV017", "account_ids": ["ACC0042", "ACC0051"] }],
    "volume": 1200000,
    "risk": 0.91,
    "geo_spread_km": 0,
    "victim_txn_ids": ["TXN003975"],
    "default_taint": {},
    "default_freeze": {}
  }
]
```

- `member_ids` are account ids; roles come from `accounts.role`.
- `edges` must be aggregate transaction edges between ring members.
- `default_taint` / `default_freeze` are the **cached** responses the API
  returns when the Python service is unreachable. Populate them with real
  numbers — they are what the demo falls back to, and an empty object makes the
  dashboard show zeroes with no explanation. TRD §6 shows `{}` as a placeholder,
  not as a recommendation.

### 3.6 `outputs/alerts.json` — array

```json
[{ "_id": "ALT01", "ring_id": "RING01", "fired_at": "2026-10-01T09:51:00Z", "reason": "5 linked accounts forwarding within minutes" }]
```

`risk`, `members` and `volume` are joined from the ring at request time — do not
include them.

### 3.7 `outputs/metrics.json` — object, single

```json
{
  "rows": [
    { "model": "V1 transaction only", "pr_auc": 0.61, "ring_recall": 0.88, "pattern_d_recall": null },
    { "model": "V2 with identity", "pr_auc": 0.79, "ring_recall": 0.94, "pattern_d_recall": null }
  ],
  "note": "Synthetic data, rings planted by the team"
}
```

Both rows required. These are the numbers the demo's model-comparison slide is
built from, so they should be a real training run.

### 3.8 `outputs/recruits.json` — optional, array

```json
[{ "ring_id": "RING01", "account_id": "ACC0311", "probability": 0.71, "reasons": ["shares 2 devices with ring members"] }]
```

Needed because `GET /api/rings/:id/recruits` is served from the database and
never calls Python — TRD §3 permits only taint and freeze to do that.

### 3.9 `outputs/fund_flows.json` — optional, object

Implemented in the backend on 3 Oct 2026. This temporal-flow artifact is stored
for later querying; API exposure is a separate task.

```typescript
interface FundFlowsArtifact {
  summary: {
    total_paths_identified: number;
    avg_hop_latency_minutes: number;
    fastest_path_minutes: number | null;
    truncated: boolean;
  };
  paths: {
    path_id: string;
    hops: number;
    start_time: string;             // ISO timestamp
    end_time: string;               // ISO timestamp
    duration_minutes: number;
    initial_amount_paise: number;   // integer paise
    final_amount_paise: number;     // integer paise
    amount_decay_pct: number;
    chain: {
      step: number;                // integer
      from_account: string;
      to_account: string;
      txn_id: string;
      timestamp: string;           // ISO timestamp
      amount_paise: number;        // integer paise
      latency_from_prev_min: number | null;
    }[];
  }[];
}
```

The source types live in `server/src/interfaces/fund_flow.interface.ts`.

**MongoDB layout:**

| Collection | Document |
| --- | --- |
| `fund_flow_paths` | One path per document, `_id = path_id`. Other path fields retain their names; the ordered `chain` is embedded within its path |
| `fund_flow_summaries` | One document `{ _id: "main", profile: "demo", summary: { ... } }` for the current seed/profile |

- All ids and account/transaction references are strings. Chain steps and the
  embedded summary have no generated ObjectIds.
- `start_time`, `end_time` and chain `timestamp` become MongoDB Dates.
- All `*_paise` values remain integer paise. The schema validates safe integers
  for amounts, `hops`, `step` and `total_paths_identified`; other numeric fields
  must be finite, with null allowed for the two nullable latency fields.
- **`amount_decay_pct` describes nominal transaction amount differences.** It
  is preserved, including negative values. It is not actual money loss, taint,
  or provenance. There are no inferred `ring_id` or role fields.
- The summary is stored as supplied, including `truncated`. Its reported total
  is not recomputed from `paths.length`.
- Both collections participate in the same transaction, truncation and reseed
  lifecycle as the existing collections. Switching profiles replaces the
  previous summary rather than accumulating a history.

**Optional-file behavior:** a missing file loads as `null` and both collections
are empty after a successful reseed. An artifact with `paths: []` still stores
its supplied summary. Malformed JSON uses the existing filename-prefixed loader
error; document-validation failures roll back the seed, including earlier path
batches and writes to existing collections.

**Indexes:** the default unique `_id` index, plus separate ascending indexes on
`start_time`, `chain.from_account`, `chain.to_account` and `chain.txn_id` for
paths. Summaries have only the default `_id` index.

Verification: [fund-flow persistence report](tests/04-FUND-FLOW-PERSISTENCE.md).
The 15 new backend tests passed. The actual demo artifact was absent during
verification, so its reported 1,000-path population remains unverified.

---

## 4. Live Python service

The files above are for **batch** outputs. Two endpoints are called live, per
request, and only these two — TRD §3.

Serve on `http://localhost:8000`.

| Endpoint | Body | Returns |
| --- | --- | --- |
| `POST /taint` | `{ "ring_id": "RING01", "as_of": "..." }` | per-account taint scores |
| `POST /mincut` | `{ "ring_id": "RING01", "k": 3, "exclude": ["ACC0040"] }` | which accounts to freeze |
| `GET /health` | — | liveness |

### The 3 second timeout is not negotiable

TRD §3 fixes `ML_TIMEOUT_MS` at 3000. On timeout, connection error or non-2xx,
the API returns the ring's cached `default_taint` / `default_freeze` with
`"cached": true` and logs it. No route ever fails because Python is down.

That is a deliberate design choice — a demo must not die because a Python
process is slow — but it means **if `/mincut` takes 4 seconds, every freeze in
the demo silently shows cached numbers** and nothing looks broken.

If your optimiser cannot fit in 3s for a 16-member ring, tell me now rather than
letting it fail quietly on stage. Options: precompute, reduce the graph, or
raise the timeout and accept the wait. A cache that always fires is worse than
no live path.

### One behaviour worth knowing

On the cached path Python cannot re-optimise around an excluded account, so the
freeze route recomputes `secured` and `pct_stopped` from the ring's own stored
per-account taint. Un-ticking an account in the dashboard still lowers the
number — demo step 6 depends on this. It does not need anything from you, but it
means cached and live responses will not be numerically identical.

---

## 5. Endpoints you can rely on

Base path `/api`. These are the frontend's contract (TRD §8). Shapes are asserted
by `test/contract.test.ts` against real data and `test/mocks.contract.test.ts`
against mocks, so a change here breaks a test.

| Method | Path |
| --- | --- |
| GET | `/health` |
| GET | `/api/alerts` |
| GET | `/api/rings` |
| GET | `/api/rings/:id` |
| GET | `/api/rings/:id/taint` |
| POST | `/api/rings/:id/freeze` |
| GET | `/api/rings/:id/recruits` |
| GET | `/api/rings/:id/geo` |
| GET | `/api/accounts/:id` |
| GET | `/api/metrics` |
| POST | `/api/rings/:id/evidence` |
| POST | `/api/replay/start` |
| POST | `/api/replay/stop` |
| GET | `/api/replay/state` |

Two from the earlier draft are **not** on this list, and I would rather say so
than have you build against them:

- **`GET /api/graph/network`** — the graph is embedded in `GET /api/rings/:id` as
  `{ nodes, edges }`, because the visualiser needs ring context (roles, risk,
  identifier nodes) that a global network endpoint has no notion of. The frontend
  is already built against this.
- **`GET /api/accounts/flagged`** — not in TRD §8. It is a two-line filter over
  `/api/rings` and I would rather not add an endpoint for it; say the word if the
  dashboard genuinely needs it and it is five minutes.

Also note `is_mule`, `risk_band` and `top_features` from the draft's
`PredictionScore`. The nearest existing fields are `accounts.role` (a
classification the dashboard filters on) and `signals[]` (feature, human label,
weight — which is what `top_features` is for). Map onto those rather than adding
a parallel shape.

---

## 6. TypeScript types, matching what the server reads

```typescript
// server/src/interfaces/domain.interface.ts — the shapes above, in code.
type AccountRole = 'source' | 'mule' | 'controller' | 'cash-out' | 'member';
type Channel = 'UPI' | 'IMPS' | 'NEFT' | 'ATM';
type IdentifierType = 'device' | 'phone' | 'ip';
type RiskBand = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

interface GeoPoint { city: string; lat: number; lng: number }

interface Signal { feature: string; label: string; weight: number }

interface Account {
  _id: string;
  holder: string | null;
  bank: string | null;
  home: GeoPoint | null;
  opened_at: string | null;
  opening_balance: number;
  features: Record<string, unknown>;
  risk_v1: number | null;
  risk_v2: number | null;
  signals: Signal[];
  ring_id: string | null;
  role: AccountRole | null;
  role_reason: string | null;
}

interface Identifier { _id: string; type: IdentifierType; account_ids: string[] }

interface Transaction {
  _id: string;
  from: string;      // account id, or 'CASH' is only ever a `to`
  to: string;
  amount: number;    // RUPEES, not paise
  ts: string;        // ISO 8601
  channel: Channel;
  location: GeoPoint | null;
  is_fraud: boolean; // stored, never serialised
}

interface Ring {
  _id: string;
  member_ids: string[];
  edges: { from: string; to: string; amount: number; count: number }[];
  identity_links: { identifier: string; account_ids: string[] }[];
  volume: number;
  risk: number;
  geo_spread_km: number;
  victim_txn_ids: string[];
  default_taint: Record<string, unknown>;
  default_freeze: Record<string, unknown>;
}
```

---

## 7. Checking your work without the API process

```bash
cd server
SEED_FIXTURES=false pnpm run seed demo
```

Loads the exported profile into the configured MongoDB replica set and fails
loudly on a bad `channel` or malformed document, with the offending field named.
A failed transaction preserves the previous dataset. A successful seed replaces
all registered collections. The CLI's existing count output covers accounts,
identifiers, transactions, rings and alerts; query the new collections to verify
fund-flow counts and summary values (see the report linked in §3.9).

```bash
cd server && pnpm start
# then, in another terminal:
curl localhost:4000/api/rings/RING01 | jq
curl -X POST localhost:4000/api/rings/RING01/freeze \
  -H 'content-type: application/json' -d '{"k":3}' | jq
```

Reference numbers from the fixture dataset, so you can tell whether your
pipeline produced something comparable: 600 accounts, 35 identifiers, ~4,972
transactions, 3 rings, 3 alerts. Freeze on `RING01` with `k:3` gives
`pct_stopped` 0.643; excluding `ACC0040` gives 0.302.

---

## 8. Open questions

1. **`default_taint` / `default_freeze` structure.** TRD §6 shows `{}`. What
   exactly goes in them? The cached freeze path recomputes `secured` and
   `pct_stopped` from per-account taint, so the shape matters more than it looks.
2. **`pattern_d_recall`.** Both fixture rows are `null`. Is there a pattern-D
   detector coming, or should it stay null?
3. **`geo_spread_km`.** The map is P2 per TRD §11. Confirm whether you want to
   populate it now.
4. **The 3 second budget** — see §4. Flag it early if it is going to be a
   problem.

Anything in here that looks wrong, say so and I will change the server. It is
cheaper to argue now than to debug a half-loaded database during the demo.
