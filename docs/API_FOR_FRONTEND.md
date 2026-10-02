# API reference for the dashboard

**From:** Member 1 (server). **For:** Member 2 (frontend).

Every payload below is **copied from a live response**, not written from memory.
Server is running at `http://localhost:4000` with demo data.

If a shape here disagrees with what you get, that is a bug — tell me.

---

## 1. Connecting

```ts
export const API = 'http://localhost:4000';
```

CORS is open, so no proxy needed. Run Next.js on 3000 or 5173 and call 4000
directly.

```bash
curl localhost:4000/health
```

```json
{
  "ok": true,
  "database": { "driver": "mongodb (atlas)", "host": "hackathon.gqtv7yg.mongodb.net", "database": "chakravyuh" },
  "mocks": false,
  "ml_url": "http://localhost:8000",
  "replay": { "running": false, "speed": 60, "progress": 0, "emitted": 0,
              "queued": 4972, "pending_alerts": 3, "clock": null }
}
```

`mocks: true` means fixture mode — same shapes, no database. Useful for
building without the server. `queued` is your transaction count.

---

## 2. Endpoints

| Method | Path | Returns |
| --- | --- | --- |
| GET | `/health` | status, replay state |
| GET | `/api/alerts` | `Alert[]` |
| GET | `/api/rings` | `RingSummary[]` |
| GET | `/api/rings/:id` | `RingGraph` — the visualiser payload |
| GET | `/api/rings/:id/recruits` | `Recruit[]` |
| GET | `/api/rings/:id/geo` | `RingGeo` |
| GET | `/api/rings/:id/taint` | `TaintPayload` |
| POST | `/api/rings/:id/freeze` | `FreezePayload` |
| GET | `/api/accounts/:id` | `AccountDetail` |
| GET | `/api/metrics` | `{ rows, note }` |
| POST | `/api/rings/:id/evidence` | PDF, `application/pdf` |
| POST | `/api/replay/start` | `{ speed }` → `ReplayState` |
| POST | `/api/replay/stop` | `ReplayState` |
| GET | `/api/replay/state` | `ReplayState` |

### Useful demo IDs

| | |
| --- | --- |
| rings | `RING01` (10 members, risk 0.91), `RING02` (5, 0.84), `RING03` (10, 0.78) |
| victim transaction | `TXN003975` |
| account E | `ACC0311` — shares `DEV017`, no ring transactions |
| a source account | `ACC0040` — role `source`, 7 transactions, 3 signals |

---

## 3. Types

```ts
type AccountRole = 'source' | 'mule' | 'controller' | 'cash-out' | 'member';
type Channel = 'UPI' | 'IMPS' | 'NEFT' | 'ATM';
type IdentifierType = 'device' | 'phone' | 'ip';

interface GeoPoint { city: string; lat: number; lng: number }

interface Alert {
  id: string;
  ring_id: string | null;
  fired_at: string | null;
  reason: string | null;
  // joined from the ring, so the list renders with no follow-up calls
  risk: number | null;
  members: number;
  volume: number | null;
}

interface RingSummary {
  id: string;
  risk: number;
  volume: number;
  members: number;
}

interface RingGraph {
  id: string;
  risk: number;
  volume: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
  victim_txn_ids: string[];
}

type GraphNode =
  | { id: string; type: 'account'; role: AccountRole; risk: number }
  | { id: string; type: 'device' | 'phone' | 'ip' };   // no role, no risk

type GraphEdge =
  | { source: string; target: string; kind: 'txn'; amount: number; count: number }
  | { source: string; target: string; kind: 'identity' };   // no amount

interface RingGeo {
  spread_km: number;
  cities: number;
  homes:    (GeoPoint & { account_id: string })[];
  cashouts: (GeoPoint & { txn_id: string; account_id: string; amount: number; ts: string })[];
}

interface TaintAccount { id: string; balance: number; tainted: number; lien: number }
interface TaintLink { source: string; target: string; value: number }

interface TaintPayload {
  victim_amount: number;
  as_of: string | null;
  accounts: TaintAccount[];
  lost_to_cash: number;
  links: TaintLink[];
  cached: boolean;
}

interface FreezePayload {
  freeze: string[];
  at_risk_before: number;
  secured: number;
  pct_stopped: number;    // 0 to 1 — multiply by 100 to display
  cached: boolean;
}

interface Recruit { id: string; probability: number; reasons: string[] }

interface Signal { feature: string; label: string; weight: number }

interface Transaction {
  id: string; from: string; to: string; amount: number;
  ts: string;                        // ISO 8601
  channel: Channel;
  location: GeoPoint | null;         // non-null only on ATM
}

interface AccountDetail {
  id: string;
  holder: string | null;
  bank: string | null;
  home: GeoPoint | null;
  opened_at: string | null;
  opening_balance: number;
  features: Record<string, number>;  // 17 features, free-form — see §4
  risk_v1: number | null;
  risk_v2: number | null;
  signals: Signal[];
  ring_id: string | null;
  role: AccountRole | null;
  role_reason: string | null;
  linked_identifiers: { id: string; type: IdentifierType; account_ids: string[] }[];
  recent_transactions: Transaction[];   // newest first
}

interface MetricsRow {
  model: string;
  pr_auc: number | null;
  ring_recall: number | null;
  pattern_d_recall: number | null;   // null — no pattern-D detector yet
}
interface Metrics { rows: MetricsRow[]; note: string }

interface ReplayState {
  running: boolean; speed: number; progress: number;
  emitted: number; queued: number; pending_alerts: number; clock: string | null;
}
```

---

## 4. Payloads

### `GET /api/rings`

```json
[
  { "id": "RING01", "risk": 0.91, "volume": 1200000, "members": 10 },
  { "id": "RING02", "risk": 0.84, "volume":  900000, "members":  5 },
  { "id": "RING03", "risk": 0.78, "volume":  600000, "members": 10 }
]
```

### `GET /api/alerts`

```json
[
  {
    "id": "ALT03",
    "ring_id": "RING03",
    "fired_at": "2026-10-01T12:12:00Z",
    "risk": 0.78,
    "members": 10,
    "volume": 600000,
    "reason": "9 accounts opened within days of each other on 3 shared devices"
  }
]
```

Newest first. `risk`, `members` and `volume` come from the ring — you do not
need a second request per alert.

### `GET /api/rings/RING01`

The visualiser payload. Accounts and identifiers in one node list, joined by
`txn` and `identity` edges.

```json
{
  "id": "RING01",
  "risk": 0.91,
  "volume": 1200000,
  "nodes": [
    { "id": "ACC0040", "type": "account", "role": "source",      "risk": 0.743 },
    { "id": "ACC0042", "type": "account", "role": "mule",        "risk": 0.914 },
    { "id": "ACC0060", "type": "account", "role": "cash-out",    "risk": 0.688 },
    { "id": "ACC0070", "type": "account", "role": "coordinator", "risk": 0.907 },
    { "id": "DEV017",  "type": "device" },
    { "id": "PHN042",  "type": "phone" }
  ],
  "edges": [
    { "source": "ACC0040", "target": "ACC0042", "kind": "txn", "amount": 150000, "count": 1 },
    { "source": "DEV017",  "target": "ACC0042", "kind": "identity" }
  ],
  "victim_txn_ids": ["TXN003975"]
}
```

**16 nodes, 31 edges** for RING01 — 10 accounts plus 6 identifiers.

Two things that will bite if you assume otherwise:

- **Identifier nodes have no `role` and no `risk`.** They are `device`, `phone`
  or `ip`. Type your nodes as a union, or guard before reading `role`.
- **`identity` edges have no `amount` or `count`.** Narrow on `kind` first.

`ACC0070` is the coordinator: highest identity connectivity, but `risk: 0.907`
and no money moved through it. That contrast is the demo's main point — do not
hide it by colouring purely on `amount`.

### `GET /api/rings/RING01/geo`

```json
{
  "spread_km": 1759,
  "cities": 2,
  "homes": [
    { "account_id": "ACC0040", "city": "Bengaluru", "lat": 12.9716, "lng": 77.5946 },
    { "account_id": "ACC0051", "city": "Kolkata",   "lat": 22.5726, "lng": 88.3639 }
  ],
  "cashouts": [
    { "txn_id": "TXN005013", "account_id": "ACC0060", "city": "Delhi",
      "lat": 28.578, "lng": 77.1945, "amount": 70466, "ts": "2026-10-01T10:05:00Z" }
  ]
}
```

10 homes, 4 cashouts. **`homes` is where accounts are registered; `cashouts` is
where the money left.** The gap is the finding — RING01 spans 1,759 km between
registration and withdrawal. Two cash-out accounts (`ACC0060`, `ACC0063`)
withdraw in exactly two cities, Delhi and Chennai.

### `GET /api/rings/RING01/taint`

```json
{
  "victim_amount": 1200000,
  "as_of": "2026-10-01T10:31:00Z",
  "cached": true,
  "accounts": [
    { "id": "ACC0040", "balance": 376617, "tainted": 371472, "lien": 371472 },
    { "id": "ACC0048", "balance":  56249, "tainted":  43515, "lien":  43515 },
    { "id": "ACC0070", "balance": 181011, "tainted":      0, "lien":      0 }
  ],
  "lost_to_cash": 109371,
  "links": [
    { "source": "ACC0040", "target": "ACC0042", "value": 147951 },
    { "source": "ACC0060", "target": "CASH",     "value": 61896 }
  ]
}
```

10 accounts, 14 links.

**`cached: true` right now.** The Python service isn't running, so this is the
ring's stored default. Shapes are identical to live — build normally, just do
not treat `cached` as an error. Suggested handling: a small badge, not a banner,
because it will be true for the whole build.

Two invariants worth rendering:

```
accounts[].tainted  +  lost_to_cash  ==  victim_amount
371472 + 86231 + 188566 + 140733 + 78660 + 43515 + 61164 + 30968 + 0 + 109371  =  1200000
```

If that does not hold, something upstream is wrong and it is worth showing.

`ACC0070` has `balance: 181011` but `tainted: 0` — the coordinator holds money
but moved none of the victim's. That is what a coordinator looks like: a device
hub with a balance that is not part of the trail.

`links` ending in `"CASH"` are the losses. Sankey or flow diagram both work off
`links`.

### `POST /api/rings/RING01/freeze`

Body is `{ k, exclude, txn, as_of }`. **`k` is how many accounts to recommend
freezing — 0 to 10, default 3.** It is a count, not an amount.

```bash
curl -X POST localhost:4000/api/rings/RING01/freeze \
  -H 'content-type: application/json' -d '{"k":3}'
```

```json
{
  "freeze": ["ACC0040", "ACC0060", "ACC0063"],
  "at_risk_before": 1090629,
  "secured": 700771,
  "pct_stopped": 0.643,
  "cached": true
}
```

Exclusion works and the percentage drops:

```bash
-d '{"k":3,"exclude":["ACC0040"]}'
# {"freeze":["ACC0060","ACC0063"],"secured":329299,"pct_stopped":0.302}
```

```
k:3                              pct_stopped 0.643
k:3, exclude:["ACC0040"]         pct_stopped 0.302
k:10, exclude:[two accounts]     pct_stopped 0.129
```

An excluded account never appears in `freeze`. That is enforced server-side —
you do not need to filter it out, though it does no harm.

`pct_stopped` is 0 to 1. Multiply by 100 for display.

### `GET /api/rings/RING01/recruits`

```json
[
  {
    "id": "ACC0311",
    "probability": 0.82,
    "reasons": ["Shares device DEV017 with ACC0051", "Account is 2 days old", "No transactions yet"]
  },
  {
    "id": "ACC0318",
    "probability": 0.41,
    "reasons": ["Shares phone PHN042 with ACC0042", "Median hold 9 min"]
  }
]
```

`reasons` is already human-readable — render it directly, no mapping needed.

### `GET /api/accounts/ACC0040`

The entity panel. Largest payload — 1.9 KB for a source account.

```json
{
  "id": "ACC0040",
  "holder": "A. Gupta",
  "bank": "Bank C",
  "home": { "city": "Bengaluru", "lat": 12.9716, "lng": 77.5946 },
  "opened_at": "2026-08-30T16:04:19Z",
  "opening_balance": 16617,
  "features": {
    "amount_in": 1200000, "amount_out": 840000,
    "txn_in": 1, "txn_out": 6,
    "pass_through": 0.7, "median_hold_min": 14,
    "velocity_per_hr": 0.96, "burst_10min": 4,
    "counterparty_diversity": 0.248,
    "in_degree": 1, "out_degree": 6,
    "account_age_days": 31, "atm_share": 0,
    "shared_device_n": 0, "shared_phone_n": 0,
    "shared_ip_n": 1, "shared_any_new_n": 1
  },
  "risk_v1": 0.627,
  "risk_v2": 0.743,
  "signals": [
    { "feature": "pass_through",   "label": "Forwards 70% of what it receives", "weight": 0.31 },
    { "feature": "median_hold_min","label": "Median hold 14 min",              "weight": 0.24 },
    { "feature": "shared_device_n","label": "Device shared with 0 other accounts","weight": 0.19 }
  ],
  "ring_id": "RING01",
  "role": "source",
  "role_reason": "Half its inflow comes from outside the ring; earliest active member",
  "linked_identifiers": [
    { "id": "IP034", "type": "ip", "account_ids": ["ACC0040","ACC0042","ACC0048","ACC0070"] }
  ],
  "recent_transactions": [
    { "id": "TXN003975", "from": "ACC0500", "to": "ACC0040", "amount": 1200000,
      "ts": "2026-10-01T09:42:10Z", "channel": "UPI", "location": null }
  ]
}
```

17 features across 4 groups — transaction volume, timing behaviour, graph
degree, and identity sharing. Identity features are the `shared_*` ones.

`signals[].label` is written for humans. Render it verbatim; that is the
explainability story and paraphrasing it throws the point away.

`recent_transactions` is newest first and capped. `TXN003975` at the bottom is
the victim deposit — the one `victim_txn_ids` points at.

`role_reason` is a sentence explaining the role. Show it next to the role badge.

### `GET /api/metrics`

```json
{
  "rows": [
    { "model": "V1 transaction only", "pr_auc": 0.61, "ring_recall": 0.88, "pattern_d_recall": null },
    { "model": "V2 with identity",    "pr_auc": 0.79, "ring_recall": 0.94, "pattern_d_recall": null }
  ],
  "note": "Synthetic data, rings planted by the team. Dev fixtures, not a trained run."
}
```

`pattern_d_recall` is `null` on both rows — there is no pattern-D detector yet.
Render it as "—" rather than `0`, which would read as a measured zero and
undermine the row.

The V1 → V2 gap is the demo's model argument: identity linking lifts PR-AUC
from 0.61 to 0.79. `note` is there so synthetic data is always labelled — keep
it visible.

---

## 5. Replay socket

```ts
import { io } from 'socket.io-client';
const socket = io('http://localhost:4000');

socket.on('txn',          (t) => {});  // Transaction
socket.on('alert',        (a) => {});  // Alert
socket.on('replay:clock', (c) => {});  // { ts: string }
socket.on('replay:state', (s) => {});  // ReplayState
socket.on('replay:end',   ()  => {});  // once, after the last txn

socket.emit('replay:start', { speed: 60 });
socket.emit('replay:stop');
```

`speed` is replay-seconds per real second. **60** compresses 7 days into about
10 minutes. **600** finishes in roughly 30 seconds — better for rehearsing.

`replay:state` also fires on connect, so a presenter who reloads mid-demo
recovers the progress bar without asking.

Full run on the demo data: **4,972 `txn`, 3 `alert`, ~25 `replay:clock`,
1 `replay:end`.** Transactions arrive already sorted by `ts` — do not sort them
yourself.

Poll `GET /api/replay/state` for the bar if you prefer REST to socket events.

### Recovering live

REST and socket share one engine, so if the socket misbehaves mid-demo:

```bash
curl -X POST localhost:4000/api/replay/start \
  -H 'content-type: application/json' -d '{"speed":600}'
curl localhost:4000/api/replay/stop
```

---

## 6. Errors

Always `{ "error": "message" }` with a 4xx or 5xx.

```json
{
  "error": "invalid request: k: k must not be greater than 10",
  "fields": { "k": ["k must not be greater than 10"] }
}
```

400 with `fields` keyed by field name — usable directly for inline form errors.

Common ones:

| Status | When |
| --- | --- |
| 400 | Body failed validation. `fields` says which |
| 404 | Unknown ring or account id |
| 500 | Unexpected. Check the server log |

Never retry a 400 — the request is wrong, not the server.

---

## 7. Things that will bite

| Symptom | Cause |
|---|---|
| `role` is `undefined` on a graph node | Identifier nodes have no `role`. Narrow on `type` |
| `amount` is `undefined` on an edge | `identity` edges have no amount. Narrow on `kind` |
| Taint percentages look wrong | Server sends **rupees**, not paise. Do not divide by 100 |
| `pct_stopped` shows `0.64%` | It is 0–1. Multiply by 100 |
| Recruits panel empty | Response is `[]`, not an error |
| Every response `cached: true` | Expected until the Python service is running |
| Money 100× too large | Dividing by 100 when the server already sends rupees |
| A route 404s | Check the path — `/rings/:id/taint` is **GET**, `freeze` and `evidence` are **POST** |

### `id`, never `_id`

The database uses `_id`. Every response exposes `id`. Do not expect `_id`
anywhere.

### `is_fraud` is never present

Not in transactions, not anywhere. Ground truth exists for scoring only — do not
build a view expecting it, it will always be absent.

---

## 8. Building without the server

```bash
USE_MOCKS=true pnpm start
```

Opens no database connection. **Response shapes are identical to real data**, so
anything you build against mocks keeps working when the server returns. Use it
if you want to work without depending on mine being up.

The mock payloads are committed at `server/src/mocks/payloads.ts` if importing
them directly is easier than running a server.

---

## 9. TypeScript client

```ts
const json = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw Object.assign(new Error(body.error ?? res.statusText), { status: res.status, fields: body.fields });
  }
  return res.json() as Promise<T>;
};

export const api = {
  health:  ()               => json<Health>('/health'),
  alerts:  ()               => json<Alert[]>('/api/alerts'),
  rings:   ()               => json<RingSummary[]>('/api/rings'),
  ring:    (id: string)     => json<RingGraph>(`/api/rings/${id}`),
  taint:   (id: string)     => json<TaintPayload>(`/api/rings/${id}/taint`),
  freeze:  (id: string, body: { k?: number; exclude?: string[] }) =>
           json<FreezePayload>(`/api/rings/${id}/freeze`, { method: 'POST', body: JSON.stringify(body) }),
  recruits:(id: string)     => json<Recruit[]>(`/api/rings/${id}/recruits`),
  geo:     (id: string)     => json<RingGeo>(`/api/rings/${id}/geo`),
  account: (id: string)     => json<AccountDetail>(`/api/accounts/${id}`),
  metrics: ()               => json<Metrics>('/api/metrics'),
};
```

---

## 10. Open questions

1. **`features` is free-form** — 17 today, no fixed schema. Do you want a fixed
   list for a radar chart, or render whatever is present?
2. **`geo_spread_km` vs computed `spread_km`** — the ring document has one, the
   geo endpoint returns another. Which is authoritative for display?
3. **Recruits `probability`** — is that a probability or a risk score? ML's
   fallback path labels it "risk score" per TRD §7.8, and that changes how it
   should be presented.
4. **Do you need `/api/accounts/flagged`?** High-risk accounts across all
   rings, for a dashboard panel. Not in TRD §8 and not built — happy to add.

Anything ambiguous here, ask before you build against it. Changing a response
shape later costs both of us.