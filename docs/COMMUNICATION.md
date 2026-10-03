# Talking to the backend

**For:** Member 2 (frontend) and Member 3 (ML).

One document, both audiences. If you only read one section: frontend starts at
§1, ML starts at §4.

> **Read `PROJECT_STATUS.md` first for what is true right now.** It is newer than
> this document on the data-flow question in particular: the ML pipeline now
> pushes directly to the database via `mongo_pusher.py`, so `pnpm run seed` is
> **not** part of the normal flow. See §4.
>
> Measured numbers live in [`tests/`](tests/) — start with
> [`tests/02-FULL-STACK-TEST-REPORT.md`](tests/02-FULL-STACK-TEST-REPORT.md).

Everything here is asserted by tests against real data and against mocks, so
you can trust it without reading the server source.

---

## The one-paragraph version

The server is Express + TypeScript on MongoDB, serving `snake_case` JSON that
matches TRD §6 exactly. It runs on `localhost:4000`. REST for everything, plus a
Socket.IO channel for the live replay. Two routes call the Python service
live; everything else is served from the database. If Python is down, nothing
breaks — you get `"cached": true` and stored default numbers.

---

## 1. Frontend: connecting

```bash
cd server && pnpm start          # http://localhost:4000
```

No database, no Python, nothing else installed:

```bash
cd server && USE_MOCKS=true pnpm start
```

Mock mode opens no database connection and serves contract-shaped payloads from
`src/mocks/`. **Every endpoint returns the same shape in both modes**, so you can
build the whole dashboard against mocks and nothing changes when real data
arrives. This is deliberate — the mock shapes are typed against the same
interfaces the real routes return, so a mock drifting from the contract is a
compile error rather than something you discover at 2am.

Verify which mode you are in:

```bash
curl localhost:4000/health
```

```json
{
  "ok": true,
  "database": { "driver": "mongodb (atlas)", "host": "...", "database": "chakravyuh" },
  "mocks": false,
  "ml_url": "http://localhost:8000",
  "replay": { "running": false, "speed": 60, "progress": 0, "emitted": 0,
              "queued": 4972, "pending_alerts": 3, "clock": null }
}
```

`mocks: true` means you are on fixtures. `queued` is your transaction count.

---

## 2. Frontend: the endpoints

Base path `/api`. TRD §8 is the contract.

| Method | Path | Returns |
| --- | --- | --- |
| GET | `/health` | Database, mock flag, replay state |
| GET | `/api/alerts` | `AlertWithRing[]`, newest first |
| GET | `/api/rings` | `RingSummary[]` |
| GET | `/api/rings/:id` | `RingGraph` — the visualiser payload |
| GET | `/api/rings/:id/taint` | `TaintPayload`. `?txn=&as_of=` |
| POST | `/api/rings/:id/freeze` | `FreezePayload`. Body `{k, exclude, txn, as_of}` |
| GET | `/api/rings/:id/recruits` | `Recruit[]` |
| GET | `/api/rings/:id/geo` | `RingGeo` |
| GET | `/api/accounts/:id` | `AccountDetail` |
| GET | `/api/metrics` | `{ rows, note }` |
| POST | `/api/rings/:id/evidence` | PDF binary. Body `{graph_png, txn, as_of}` |
| POST | `/api/replay/start` | Body `{speed}` |
| POST | `/api/replay/stop` | |
| GET | `/api/replay/state` | `ReplayState` |

`GET /api/rings` is not in the TRD contract table. It is a convenience for a
ring list; if you do not need it, ignore it.

### Errors

Always `{ "error": "message" }` with a 4xx or 5xx.

A failed DTO returns 400 with the failing fields:

```json
{
  "error": "invalid request: k: k must not be greater than 10",
  "fields": { "k": ["k must not be greater than 10"] }
}
```

Good for showing inline field errors. `k` is **how many accounts to recommend
freezing**, 0–10, default 3. It is a count, not an amount.

### Response shapes

```typescript
type AccountRole = 'source' | 'mule' | 'controller' | 'cash-out' | 'member';

interface AlertWithRing {
  id: string; ring_id: string | null; fired_at: string | null;
  reason: string | null;
  risk: number | null;      // joined from the ring
  members: number;          // joined
  volume: number | null;    // joined
}

interface RingSummary { id: string; risk: number; volume: number; members: number }

interface RingGraph {
  id: string; risk: number; volume: number;
  nodes: GraphNode[]; edges: GraphEdge[]; victim_txn_ids: string[];
}

interface GraphNode {
  id: string;
  type: 'account' | 'device' | 'phone' | 'ip';
  role?: AccountRole;
  risk: number;
  label?: string;
}
interface GraphEdge { source: string; target: string; amount: number; count: number }

interface RingGeo {
  spread_km: number; cities: number;
  homes:    { account_id: string; city: string; lat: number; lng: number }[];
  cashouts: { txn_id: string; account_id: string; city: string;
              lat: number; lng: number; amount: number }[];
}

interface AccountDetail extends Account {
  linked_identifiers:   { id: string; type: 'device'|'phone'|'ip'; account_ids: string[] }[];
  recent_transactions:  Transaction[];
}

interface Transaction {
  id: string; from: string; to: string; amount: number;
  ts: string;            // ISO 8601
  channel: 'UPI' | 'IMPS' | 'NEFT' | 'ATM';
  location: { city: string; lat: number; lng: number } | null;
}

interface TaintPayload {
  victim_amount: number;
  as_of: string | null;
  accounts: { id: string; balance: number; tainted: number; lien: number }[];
  lost_to_cash: number;
  links: { source: string; target: string; value: number }[];
  cached: boolean;
}

interface FreezePayload {
  freeze: string[];
  at_risk_before: number;
  secured: number;
  pct_stopped: number;     // 0 to 1, multiply by 100 for display
  cached: boolean;
}

interface Recruit { id: string; probability: number; reasons: string[] }
interface ReplayState {
  running: boolean; speed: number; progress: number;
  emitted: number; queued: number; pending_alerts: number; clock: string | null;
}
```

### `id` not `_id`

The database stores `_id`; the API always exposes it as **`id`**. One mapper,
one place. Do not expect `_id` in any response.

### `is_fraud` is never present

Not in transactions, not anywhere. The domain type has no such field, so there
is nothing for the mapper to emit. A test asserts it appears in no response, in
both real and mock modes. Ground truth exists for scoring only.

---

## 3. Frontend: replay over Socket.IO

```js
import { io } from 'socket.io-client';
const socket = io('http://localhost:4000');

socket.on('txn',         (t) => {});   // { id, from, to, amount, ts, channel }
socket.on('alert',       (a) => {});   // the alert list shape
socket.on('replay:clock',(c) => {});   // { ts }
socket.on('replay:state',(s) => {});   // ReplayState
socket.on('replay:end',  ()  => {});   // fires once, after the last txn

socket.emit('replay:start', { speed: 60 });
socket.emit('replay:stop');
```

`speed` is replay-seconds per real second. 60 is the default; 600 finishes the
whole script in about half a minute.

`replay:state` is also emitted on connect, so a presenter who reloads mid-demo
recovers the bar without asking.

**REST and socket share one engine.** If the socket misbehaves during a demo,
recover over HTTP:

```bash
curl -X POST localhost:4000/api/replay/start \
  -H 'content-type: application/json' -d '{"speed":600}'
```

A full run on the fixture dataset emits 4,972 `txn` events, 3 `alert` events and
about 25 clock ticks. Transactions arrive in `ts` order — you do not need to sort.

---

## 4. ML: how your data reaches the server

> **Changed 3 Oct 2026.** You now push straight to Atlas with
> `mongo_pusher.py`. The server reads whatever is in the database, so the
> JSON-file flow below is the *fallback*, not the normal path.
>
> After a push the server only needs:
>
> ```bash
> cd server && pnpm run db:indexes    # a direct push skips index creation
> ```
>
> **Do not run `pnpm run seed` unless you mean it.** It would truncate the
> collections and load `src/fixtures` over your data. It exists for the case
> where data arrives as files on the backend machine.
>
> Live data as of now: 926 accounts, 8,041 transactions, 3 rings, 3 alerts,
> last pushed `2026-10-02T23:47:25`.

You write JSON. The server reads it once at seed time and serves from MongoDB
after that. **Changing a file does nothing until you re-seed.**

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
    └── recruits.json          optional
```

```bash
cd server && pnpm run seed     # prints what landed, fails loudly on bad data
```

Field formats are in `ML_INTEGRATION.md`. What happens to your files afterwards
is in `HOW_DATA_FLOWS.md`. Read both before you run the pipeline.

Three things that will bite:

- **`channel`, not `txn_type`.** Enum is `UPI|IMPS|NEFT|ATM` and it is
  validated. One bad value fails the entire seed rather than skipping a row.
- **Rupees, not paise.** TRD §6 is rupees. Converting makes every figure 100×
  wrong while still looking plausible.
- **`identifiers.json` is not optional in practice.** Device/phone/IP sharing is
  what links accounts that never transact directly. Without it the identity
  graph is empty and "V2 with identity" has nothing to work with.

### Live service

Serve on `http://localhost:8000`. Only two routes call you, per TRD §3:

```
POST /taint    { ring_id, victim_txn_id, as_of }
POST /mincut   { ring_id, k, exclude, as_of }
GET  /health
```

Exact response shapes are in `ML_INTEGRATION.md` §3 and §4. Two rules:

- `accounts[].tainted` must sum to `victim_amount`. The dashboard shows a
  conservation line and a gap looks like a server bug.
- `freeze` must never contain an account from `exclude` (TRD §7.7).

Also wired but not called by the UI: `POST /recruits`, `POST /pipeline/run`.

### The 3 second timeout is not negotiable

TRD §3 fixes `ML_TIMEOUT_MS` at 3000. Past that, connection error or any
non-2xx, the server returns the ring's stored `default_taint` /
`default_freeze` with `"cached": true`. No route ever fails because Python is
unreachable.

This fails **quietly**, which is why it is worth stating plainly: if `/mincut`
takes 4 seconds, every freeze in the demo silently shows cached numbers and
nothing looks broken.

Check the server log for `served from cache`. If every taint and freeze response
has `cached: true`, your service is not being reached and the dashboard is
showing my stored defaults rather than your model.

---

## 5. Shared vocabulary

If these words mean different things in different places, that is where bugs
come from.

| Term | Meaning |
| --- | --- |
| **ring** | A detected group of linked accounts. `RING01`, `RING02`, `RING03` |
| **member** | An account in a ring. Has a `role` |
| **role** | `source`, `mule`, `controller`, `cash-out`, or `member` |
| **taint** | How much stolen money is traceable to an account right now |
| **freeze** | Which accounts to act on, and how much money that stops |
| **`pct_stopped`** | `secured / at_risk_before`, 0 to 1 |
| **`victim_txn_ids`** | The deposits that were stolen. The origin of all taint |
| **`CASH`** | Sentinel id for cash-out. **Not an account** |
| **`is_fraud`** | Ground truth. Stored, never sent to any consumer |

### Taint conservation

The number the dashboard cares about: taint must trace back to the victim
amount without inflating.

```
victim_amount  48000
lost_to_cash   15000
distributed    33000   (sum of accounts[].tainted)
```

`lost_to_cash` is money that reached the `CASH` sentinel and is gone. It is
expected to be non-zero — money laundering ends somewhere.

On the cached path, Python cannot re-optimise around an excluded account, so the
server recomputes `secured` and `pct_stopped` from the ring's own stored
per-account taint. Un-ticking an account still lowers the percentage:

```
k:3                              pct_stopped 0.643
k:3, exclude:["ACC0040"]         pct_stopped 0.302
k:10, exclude:[two accounts]     pct_stopped 0.129
```

Demo step 6 depends on this. It requires `default_taint` to contain per-account
entries — leaving it `{}` gives zeroes and a flat bar.

---

## 6. Environment variables

Copy `server/.env.example` to `.env`. Everything has a working default except
`MONGO_URL`, which is required unless running in mock mode.

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | `4000` | |
| `MONGO_URL` | *(TRD default)* | Only treated as configured when set explicitly |
| `TEST_MONGO_URL` | *(unset)* | Overrides which database tests use |
| `DB_CONNECT_TIMEOUT_MS` | `10000` | Cold Atlas connections are slow |
| `ML_URL` | `http://localhost:8000` | Your service |
| `ML_TIMEOUT_MS` | `3000` | TRD §3. See §4 above |
| `USE_MOCKS` | `false` | Serve mocks, open no database |
| `SEED_PROFILE` | `demo` | Reads `data/<profile>/` |
| `SEED_FIXTURES` | `true` | Allow fixtures when `data/` is missing |
| `REPLAY_DEFAULT_SPEED` | `60` | Replay seconds per real second |
| `REPLAY_TICK_MS` | `250` | Clock cadence, TRD §9 |

If your `MONGO_URL` names no database, the server appends `chakravyuh`. MongoDB
otherwise connects to a database called `test` without complaining, which hides
your data.

---

## 7. Quick reference

```bash
# is it up
curl localhost:4000/health

# the dashboard's main calls
curl localhost:4000/api/rings
curl localhost:4000/api/rings/RING01
curl localhost:4000/api/accounts/ACC0311
curl localhost:4000/api/alerts

# the two live-ML routes
curl localhost:4000/api/rings/RING01/taint
curl -X POST localhost:4000/api/rings/RING01/freeze \
  -H 'content-type: application/json' -d '{"k":3,"exclude":["ACC0040"]}'

# replay
curl -X POST localhost:4000/api/replay/start -d '{"speed":600}'
curl localhost:4000/api/replay/state

# the evidence pack
curl -X POST localhost:4000/api/rings/RING01/evidence \
  -H 'content-type: application/json' -d '{}' -o pack.pdf
```

Reference fixture numbers, so you can tell whether the data you are looking at
is the fallback generator or a real pipeline run: 600 accounts, 35 identifiers,
4,972 transactions, 3 rings, 3 alerts.

If `pnpm run seed` prints `from src/fixtures`, the pipeline's files were not
found. Check `SEED_PROFILE` and that `data/<profile>/` exists.
