# Live mode: streaming contract

**For:** all three members. **Status:** built and tested end to end (see
[Verification](#verification)).

Live mode is the second way the dashboard can play, next to the replay of
stored, pre-analysed data. Nothing is precomputed:

1. `ml/stream_generator.py` invents a bank's traffic as it happens and plants
   fraud rings at random moments.
2. The server reads that stream, keeps it in memory, and relays transactions
   to the dashboard every 250 ms.
3. About once a second the server sends the predictor everything new.
   `ml/online.py` updates each account's features, rescores the accounts it
   touched, and looks for rings among the high-risk ones.
4. Scores, rings and alerts go back to the dashboard as they are worked out.

```
ml/stream_generator.py ──NDJSON on stdout──► server StreamService ──Socket.IO stream:*──► dashboard
   (started by the server per run)              │  in-memory LiveStore, served at /api/live
                                                └─ POST /predict every ~1 s ─► ml/service.py (online.py)
                                                   ◄── scores, rings, alerts ──┘
```

The replay is unchanged and stays as the fallback. One mode runs at a time:
starting either stops the other.

## Running it

```bash
pnpm dev                              # from the repo root: ML service, server, dashboard
```

Or by hand, three terminals:

```bash
ml/.venv/Scripts/python ml/service.py           # :8000  (bin/python on macOS/Linux)
cd server && pnpm start                         # :4000  STREAM_ONLY=true to run with no database
cd client && pnpm dev                           # :3000
```

The dashboard opens a fresh live run on its own when the server has no stored
data (`STREAM_ONLY=true`). Otherwise use the **Replay | Live** switch in the bar.

Without the browser:

```bash
curl -X POST localhost:4000/api/stream/start -H 'content-type: application/json' -d '{"seed":42,"rate":900}'
curl localhost:4000/api/stream/state
curl localhost:4000/api/live/alerts
curl localhost:4000/api/live/metrics
curl -X POST localhost:4000/api/stream/stop
```

ML side only, no server:

```bash
python ml/stream_harness.py --fixed --days 3     # alerts as they fire, then recall and timing
```

## Rules that hold everywhere

- **Timestamps** are `YYYY-MM-DDTHH:MM:SSZ`, second precision. `features._parse`
  uses a strict `strptime`, and the server rejects anything else.
- **Money** is integer paise from the generator to the server and to the
  predictor. The server converts it to whole rupees for the dashboard in one
  place (`rupees()` in `live.store.ts`, rounding half up, the same as
  `ml/run.py paise_to_rupees`).
- **Labels never leave the server.**
  - The generator puts `is_fraud` and the planted ring's label only in a
    `gt` field on each `txn` line, and in `truth` lines.
  - The server keeps both to score the predictor (`/api/live/metrics`) and
    forwards them to nobody.
  - The planters name victims after their ring (`VICTIM_RING01`), so the live
    generator renames each victim to a neutral `VICTIM_<hex>`.
  - Tests assert all of this: `server/test/stream.service.test.ts` and
    `ml/tests/test_stream_generator.py`.
- **Ids.** Live rings are `LIVE-R01`, `LIVE-R02` and so on; live alerts are
  `LIVE-A01`. The `LIVE-` prefix is how the dashboard knows to read `/api/live`.

## 1. Generator → server (NDJSON on stdout)

One JSON object per line, in non-decreasing simulated time. An account or
identifier line always comes before the first transaction that names it.

```json
{"type":"run","seed":918273,"rate":300,"sim_start":"2026-10-03T04:00:00Z","sim_end":"2026-10-17T04:00:00Z","config":{"accounts":3000,"patterns":["A","B","C","D"]}}
{"type":"account","account":{"id":"ACC0101","holder":"Priya F. Patel","bank":"Canara Bank","home":{"city":"Lucknow","lat":26.85,"lng":80.95},"opened_at":"2026-08-11T04:00:00Z","opening_balance_paise":5821300}}
{"type":"identifier","id":"DEV0042","kind":"device","account_id":"ACC0101"}
{"type":"txn","txn":{"id":"TXN004211","from":"ACC0101","to":"ACC0230","amount_paise":120000,"ts":"2026-10-03T07:12:44Z","channel":"UPI","location":null},"gt":{"is_fraud":false,"ring":null}}
{"type":"truth","ring":"G03","pattern":"A","member_ids":["ACC3100","..."],"victim_txn_id":"TXN000731","victim_amount_paise":45120000,"planted_at":"2026-10-03T12:00:00Z"}
{"type":"clock","ts":"2026-10-03T07:12:50Z"}
{"type":"end","reason":"duration"}
```

**Flags:**

| Flag | Default | Meaning |
| --- | --- | --- |
| `--seed N` / `--fixed` | random | `--fixed` is seed 42 |
| `--rate` | 300 | Simulated seconds per real second |
| `--accounts` | 3000 | Population size |
| `--density` | about 0.28 | Ordinary transactions per account per day. The default is the `train` profile's, so the model sees what it was trained on |
| `--first-ring-min` | 240 | Simulated minutes before the first ring |
| `--ring-every-min` | 480 | Average simulated minutes between rings |
| `--patterns` | `A,B,C,D` | Which ring patterns to plant |
| `--duration-min` | 14 days | How long the run lasts |
| `--start` | this hour | Simulated start time |
| `--fast` | off | No pacing, for tests |

**Rings.** They come from `generate.py`'s own planters, time-shifted so the
victim deposit lands at the chosen moment. Ring accounts get the same
opening-balance repair the batch generator applies, done before anything is
sent.

**Remote generators.** `POST /api/stream/ingest` with `{"events":[...]}` takes
the same lines from a generator the server did not start. It needs
`Authorization: Bearer $STREAM_INGEST_TOKEN`, and a run started with
`{"external":true}`.

## 2. Server → predictor (`ml/service.py`, :8000)

```
POST /predict/reset  {run_id, sim_start}                 -> {ok, run_id, model:{ready, source, trained_on, trained_at}}
POST /predict        {run_id, seq, clock, accounts, identifiers, txns}
                     -> {seq, applied, took_ms, scores[], rings[], alerts[], stats}
```

- **Request fields.** `accounts`, `identifiers` and `txns` are the generator's
  objects, with the label stripped.
- **`scores[]`**: `{id, risk_v1, risk_v2, anomaly, risk, band, provisional, signals?}`.
  - A score is only sent when it moved by at least 0.02 or changed band.
  - `provisional` means fewer than 3 transactions so far.
  - `signals` are SHAP reasons, for accounts at risk ≥ 0.5.
- **`rings[]`**: `{id, version, member_ids, roles:{id:{role, role_reason}}, edges:[{from, to, amount(paise), count}], identity_links, volume_paise, risk, victim_txn_ids, first_seen}`.
  - Sent whenever a ring's version goes up.
  - Members are only ever added.
  - A ring keeps its id from one discovery run to the next: communities that
    overlap by at least half are the same ring.
- **`alerts[]`**: `{id, ring_id, fired_at, reason}`, exactly one per ring, the
  first time it is confirmed.

**Ordering and retries.**

- The server keeps one request in flight and numbers them with `seq`.
- Resending a `seq` already applied returns the cached answer with
  `applied:false`, so retrying after a timeout is safe.
- `409 {"detail":{"error":"run_mismatch"|"expected_seq"}}` means the predictor
  is not on this run (it restarted, or a batch was skipped). The server resets
  it and resends the whole run, which it keeps in memory.
- `503` means the models are still loading.

**Models.**

- Trained on the `train` profile the first time the service starts (about
  3 s), then saved to `ml/saved_models/online/` (gitignored) in XGBoost's own
  JSON format.
- The pickles committed under `saved_models/` would not load with the
  installed XGBoost (`input stream corrupted`).
- The isolation-forest score uses bounds fixed at training time, because a
  batch-relative min and max means nothing for a few rows.

**Features.** These match `features.compute_features` (the inline code, not
`_compute_core`), one transaction at a time. `ml/tests/test_online_parity.py`
checks every V1 and identity feature on the demo data.

**Taint and freeze for a live ring.** `/taint` and `/mincut` take an optional
`run_id`. When it matches the live run, they read that run's ledger instead
of the demo files.

## 3. Server ↔ dashboard

### Socket.IO

| Event | Payload |
| --- | --- |
| `stream:state` | `{mode, running, run_id, seed, rate, sim_start, sim_end, clock, ended, counts:{txns, accounts, scored, high_risk, rings, alerts}, predictor:{status: idle\|starting\|ok\|lagging\|down, pending_txns, last_error, took_ms}, generator:{status, pid}}`. About once a second, and on any change |
| `stream:snapshot` | `{state, txns (last 4000), txns_total, scores, rings, alerts, metrics}`. Sent on connect while a run exists, so a reload restores the views |
| `stream:txns` | `{run_id, txns:[{id, from, to, amount, ts, channel, location}]}`. Every 250 ms. Rupees, with location, no salary credits |
| `stream:scores` | `{run_id, scores:[{id, risk, risk_v1, risk_v2, band, provisional, signals?}]}` |
| `stream:ring` | `{run_id, version, ring}`, where `ring` is the `GET /rings/:id` shape plus `version` |
| `stream:alert` | `{run_id, alert}`, where `alert` is the `/alerts` shape plus `before_cashout`: whether it fired before any of the ring's cash left |
| `stream:clock` | `{run_id, ts}` |
| `stream:end` | `{run_id, reason}`. `duration`, `stopped`, `capacity`, `replay started` or `generator stopped` |
| `stream:error` | `{error}` |
| `stream:start` (from the client) | `{seed?, rate?}` |
| `stream:stop` (from the client) | — |

### REST

| Method | Path | Returns |
| --- | --- | --- |
| POST | `/api/stream/start` | `{ok, run_id, rate, seed}`. Body `{seed?, rate? (1–3600), external?}` |
| POST | `/api/stream/stop` | `{ok}` |
| GET | `/api/stream/state` | as `stream:state` |
| POST | `/api/stream/ingest` | `{accepted, rejected}` |
| GET | `/api/live/snapshot` | as `stream:snapshot` |
| GET | `/api/live/alerts`, `/api/live/rings`, `/api/live/rings/:id` and its `/taint`, `/freeze`, `/geo`, `/recruits` | the stored-data shapes, through the same mappers. `/recruits` is `[]` for now |
| GET | `/api/live/accounts/:id` | `AccountDetail` |
| GET | `/api/live/transactions` | paged like `/api/transactions` |
| GET | `/api/live/metrics` | `{planted, caught, missed, false_rings, median_minutes_to_alert, caught_before_cashout, flagged_accounts, flagged_in_rings, note}` |

## Server settings

| Variable | Default | |
| --- | --- | --- |
| `STREAM_ONLY` | `false` | With no `MONGO_URL`: live mode only. The stored-data routes answer 503 |
| `PYTHON_BIN` | `ml/.venv` Python, else `python` | Runs the generator |
| `STREAM_GENERATOR` | `ml/stream_generator.py` | |
| `STREAM_DEFAULT_RATE` | `300` | |
| `STREAM_TICK_MS` | `250` | How often transactions go to the dashboard |
| `STREAM_PREDICT_INTERVAL_MS` | `1000` | How often the predictor is sent a batch |
| `STREAM_PREDICT_TIMEOUT_MS` | `5000` | Separate from `ML_TIMEOUT_MS` |
| `STREAM_PREDICT_BATCH_MAX` | `5000` | Transactions per request |
| `STREAM_MAX_TXNS` | `200000` | A run ends here, so memory stays bounded |
| `STREAM_INGEST_TOKEN` | unset | Opens `/api/stream/ingest` |

On the ML side, `ML_RELOAD=1` turns uvicorn's auto-reload back on. It is off by
default because a reload throws away the live run.

## What it does not do yet

- **Recruits.** The live predictor does not score likely recruits.
- **Persistence.** Live runs are not saved: the run lives in memory and is
  replaced by the next one. Writing it to MongoDB would have to be batched,
  and kept off the Atlas free tier.
- **Fixed thresholds.** Ring discovery reruns every 300 simulated seconds, or
  as soon as an account crosses 0.5 risk.

## Verification

1. **ML tests:** `python -m pytest ml/tests`. This includes:
   - online feature parity with the batch code;
   - the generator's ordering, balance and label rules;
   - the predictor finding every planted ring with stable ids and one alert each.
2. **Server tests:** `cd server && pnpm test`. `test/stream.service.test.ts`
   drives whole runs with a fake predictor and a fake generator:
   - batching and rupee conversion;
   - no labels sent to the predictor or the dashboard;
   - one request in flight;
   - backoff while the predictor is down, and resend on 409;
   - capacity, drain and generator failure.
3. **End to end:** the commands under [Running it](#running-it). Killing the ML
   service mid-run turns the predictor status to `down` while transactions
   keep streaming; restarting it resyncs the run.
