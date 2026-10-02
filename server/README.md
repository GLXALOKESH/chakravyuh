# Chakravyuh server

Express API, Socket.IO replay and the evidence pack. This is the whole of the
server-side scope from `TRD.md`: F6 (API and storage), F11 (live replay), F12
(evidence pack), plus `mlClient.js`, the seeder and the contract mocks.

## Quick start

```bash
npm install
npm run seed     # builds the database from data/demo/ or the dev fixtures
npm start        # http://localhost:4000
npm test         # 67 checks
```

No database installation is needed. With `DATABASE_URL` unset the API runs on
PGlite, an in-process build of real PostgreSQL, stored in `server/.pglite/`.
Set `DATABASE_URL` to point at a real PostgreSQL and the same code runs against
it with no other change.

```bash
curl localhost:4000/api/rings/RING01 | jq
curl -X POST localhost:4000/api/rings/RING01/freeze -H 'content-type: application/json' -d '{"k":3}'
curl -X POST localhost:4000/api/rings/RING01/evidence -o pack.pdf
```

## Environment

Copy `.env.example` to `.env`. Every value has a working default except
`DATABASE_URL`, which is optional.

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | `4000` | |
| `DATABASE_URL` | *(unset)* | Unset selects PGlite. |
| `PGLITE_DIR` | `.pglite` | `:memory:` for a throwaway database. |
| `ML_URL` | `http://localhost:8000` | The Python service. |
| `ML_TIMEOUT_MS` | `3000` | Per TRD section 3. |
| `USE_MOCKS` | `false` | Serve contract mocks instead of the database. |
| `SEED_PROFILE` | `demo` | Reads `data/<profile>/`. |
| `SEED_FIXTURES` | `true` | Allow the dev fixtures when `data/` is missing. |
| `REPLAY_DEFAULT_SPEED` | `60` | Replay seconds per real second. |

## Endpoints

Base path `/api`. Response shapes are TRD section 8; `test/contract.test.js`
asserts every one of them against real data and against the mocks.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/health` | Driver, mock flag, replay state. |
| GET | `/api/alerts` | Alerts newest first, joined with ring risk, member count and volume. |
| GET | `/api/rings` | Ring summaries. Not in the TRD contract table. |
| GET | `/api/rings/:id` | Members, roles, transaction edges, identity edges. |
| GET | `/api/rings/:id/taint` | `?txn=&as_of=`. Calls Python, else cached default. |
| POST | `/api/rings/:id/freeze` | Body `{k, exclude, txn, as_of}`. Calls Python, else cached default. |
| GET | `/api/rings/:id/recruits` | From the database, never Python. |
| GET | `/api/rings/:id/geo` | Home branches and cash-out points. |
| GET | `/api/accounts/:id` | Features, role, signals, identifiers, recent activity. |
| GET | `/api/metrics` | The V1 against V2 table. |
| POST | `/api/rings/:id/evidence` | PDF. Body `{graph_png, txn, as_of}`. |
| POST | `/api/replay/start` | Body `{speed}`. |
| POST | `/api/replay/stop` | |
| GET | `/api/replay/state` | Progress, for the replay bar. |

Errors are `{ "error": "message" }` with a 4xx or 5xx status.

### Replay socket events

| Event | Direction | Payload |
| --- | --- | --- |
| `txn` | server to client | `{ id, from, to, amount, ts, channel }` |
| `alert` | server to client | the alert list shape |
| `replay:clock` | server to client | `{ ts }`, once per replay second |
| `replay:start` | client to server | `{ speed }` |
| `replay:stop` | client to server | |
| `replay:end` | server to client | no payload, fires once |
| `replay:state` | server to client | on connect and after a start or stop |

REST and socket share one engine instance, so a presenter can always recover
with `curl -X POST localhost:4000/api/replay/start -d '{"speed":600}'`.

## Database

`sql/001_init.sql` is plain PostgreSQL and is never branched on, so both drivers
behave identically. `npm run migrate` applies it and records what it applied in
`schema_migrations`; running it again is a no-op.

Tables: `rings`, `accounts`, `identifiers`, `transactions`, `alerts`,
`recruits`, `metrics`, `seed_meta`.

Three deliberate choices:

- **Money is `DOUBLE PRECISION`.** node-postgres returns `NUMERIC` as a string to
  preserve precision and PGlite returns a number, so the two drivers would
  disagree on the wire. TRD section 8 requires JSON numbers. The largest figure
  here is far inside float64's exact-integer range.
- **No foreign keys on `transactions.from_account` and `to_account`.** Cash-out
  is a transfer to the sentinel account id `CASH`, which is not a row in
  `accounts`.
- **`recruits` is an addition.** TRD section 6 has no collection for it, but
  TRD section 3 allows only taint and freeze to call Python, so the pipeline
  output has to be stored for `GET /rings/:id/recruits` to be answerable.

`is_fraud` is stored and never serialised. A test asserts it does not appear in
any response.

## What the seeder expects

`npm run seed` reads the generator's output and the pipeline's outputs, then
truncates and reloads inside one transaction. It is safe to run repeatedly.

```
data/<profile>/accounts.json
data/<profile>/identifiers.json
data/<profile>/transactions.json
data/<profile>/ground_truth.json            optional, logged only
data/<profile>/outputs/rings.json
data/<profile>/outputs/alerts.json
data/<profile>/outputs/metrics.json
data/<profile>/outputs/recruits.json        optional
```

Account and ring ids are read from `_id` or `id`. Unknown fields are ignored, so
the generator can carry extra columns.

Until `ml/generate.py` exists, `SEED_FIXTURES=true` falls back to
`devFixtures.js`. That file is **not** the data generator and should be deleted
once the real one lands. It produces roughly 600 accounts, 5,000 transactions
and three planted rings following the PRD demo scenario, and it satisfies the
TRD section 13 invariants, which is why the demo has something coherent to show.

## Mocks

`src/mocks/` holds contract-shaped payloads for every endpoint. `USE_MOCKS=true`
serves them, so the dashboard can be built before the pipeline exists. They are
checked against the same TRD section 8 shapes as the real routes, and the mock
taint conserves to the victim amount exactly as the real one does, so the UI
totals behave the same either way.

## When Python is down

`mlClient.js` enforces the 3 second timeout and, on timeout, connection error or
a non-2xx response, returns the ring's stored `default_taint` or
`default_freeze` with `"cached": true`. No route fails because the ML service is
unreachable.

On the cached path Python cannot re-optimise around an excluded account, so the
freeze route recomputes `secured` and `pct_stopped` from the ring's own
per-account taint. Un-ticking an account in the dashboard therefore still lowers
the percentage, which demo step 6 depends on.

## Tests

`npm test` runs 67 checks with no setup and no files on disk:

- `contract.test.js` — every endpoint against the TRD section 8 shapes, real data.
- `mocks.contract.test.js` — the same shapes against the mocks.
- `fallback.test.js` — taint and freeze return `cached: true` with Python stopped.
- `replay.test.js` — ordering, clock cadence, alert firing, end condition, REST control.
- `fixtures.test.js` — the TRD section 13 generator invariants.
- `seed.test.js` — reseeding does not duplicate, and a failed seed rolls back.

## Deviations from TRD

1. **PostgreSQL, not MongoDB.** The team chose PostgreSQL. `MONGO_URL` is
   `DATABASE_URL`, `models/` holds SQL query modules rather than Mongoose
   schemas, and the field names follow TRD section 6 with `_id` exposed as `id`.
2. **`recruits` table added.** See above.
3. **Express 4, pinned with a caret range.** Express 5 is current, but its
   path-handling changes are not worth the risk inside a 26 hour build.