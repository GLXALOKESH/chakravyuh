# Chakravyuh server

Express API, Socket.IO replay and the evidence pack. This is the whole of the
server-side scope from `TRD.md`: F6 (API and storage), F11 (live replay), F12
(evidence pack), plus the ML client, the seeder and the contract mocks.

TypeScript, Mongoose against MongoDB, class-validator on every request.

## Quick start

```bash
cp .env.example .env      # then put your MONGO_URL in it
npm install
npm run seed              # load data/demo/ or the dev fixtures
npm start                 # http://localhost:4000
npm test
```

Working on the frontend before any database exists? Skip all of the above except
`npm install` and run with mocks:

```bash
USE_MOCKS=true npm start
```

Mock mode opens no database connection at all, which is what makes it usable for
the hours 2 to 10 that TRD section 15 sets aside.

```bash
curl localhost:4000/api/rings/RING01 | jq
curl -X POST localhost:4000/api/rings/RING01/freeze -H 'content-type: application/json' -d '{"k":3}'
curl -X POST localhost:4000/api/rings/RING01/evidence -o pack.pdf
```

`npm test` needs nothing: with no `MONGO_URL` it starts its own mongod, so the
database-backed checks run rather than skipping.

## Layout

```
server/
├── src/
│   ├── bin/                   server.ts (http + socket), seed.ts, indexes.ts
│   ├── models/                Mongoose schemas, one file per collection
│   ├── configs/               env.ts, mongoose.ts (the connection)
│   ├── constants/             roles, channels, sentinels, socket event names
│   ├── controllers/           request in, response out, no logic
│   ├── services/              replay engine, evidence PDF, ML client, seeder
│   ├── repositories/          one per collection, all queries live here
│   ├── DTOClasses/            class-validator request classes
│   ├── exceptions/            AppError and the status codes
│   ├── middlewares/           validate(Dto), error handler, 404, asyncHandler
│   ├── routes/                one table per resource
│   ├── utilities/             iso(), chunk(), small pure helpers
│   ├── interfaces/            domain and repository types, no Mongoose in domain
│   ├── mappers/               row -> domain -> wire, in two explicit steps
│   ├── fixtures/              dev fixture generator (see below)
│   ├── mocks/                 contract payloads and their router
│   └── app.ts                 Express assembly
└── test/
```

A request travels `route -> validate(Dto) -> controller -> repository -> mapper`.
Controllers never build queries; repositories never shape responses.

## Environment

Copy `.env.example` to `.env`. Every value has a working default except
`MONGO_URL`, which is required unless you are running in mock mode.

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | `4000` | |
| `MONGO_URL` | `mongodb://localhost:27017/chakravyuh` | The TRD section 9 name and default. Only treated as configured when set explicitly. |
| `TEST_MONGO_URL` | *(unset)* | Overrides which database the suite uses. |
| `DB_CONNECT_TIMEOUT_MS` | `10000` | Cold Atlas connections can be slow. |
| `ML_URL` | `http://localhost:8000` | The Python service. |
| `ML_TIMEOUT_MS` | `3000` | Per TRD section 3. |
| `USE_MOCKS` | `false` | Serve contract mocks; opens no database. |
| `SEED_PROFILE` | `demo` | Reads `data/<profile>/`. |
| `SEED_FIXTURES` | `true` | Allow the dev fixtures when `data/` is missing. |
| `REPLAY_DEFAULT_SPEED` | `60` | Replay seconds per real second. |
| `REPLAY_TICK_MS` | `250` | Clock cadence, per TRD section 9. |

`.env.example` ships a placeholder connection string. Anything containing
`placeholder`, `changeme` or `YOUR_` is reported as "no database", which is what
keeps `npm start` and `npm test` honest before the real one arrives.

`MONGO_URL` is read only when explicitly set. The TRD default is applied so the
value is never empty, but it is not treated as a choice — otherwise every fresh
clone would try to connect to a local mongod that is not running.

Atlas:

```bash
MONGO_URL="mongodb+srv://USER:PASSWORD@cluster0.abcde.mongodb.net/chakravyuh?retryWrites=true&w=majority"
```

## Commands

| Command | Does |
| --- | --- |
| `npm run dev` | `tsx watch` on `src/bin/server.ts`. |
| `npm start` | Run the server. |
| `npm run build` | Compile `src/` to `dist/` with `tsconfig.build.json`. |
| `npm run typecheck` | Typecheck everything including tests. No emit. |
| `npm run seed` | Load `data/<profile>/`, or the fixtures. |
| `npm run db:indexes` | Create the indexes declared on the schemas. |
| `npm test` | Vitest. Starts its own mongod if needed. |

## Endpoints

Base path `/api`. Response shapes are TRD section 8; `test/contract.test.ts`
asserts every one of them against real data and `test/mocks.contract.test.ts`
against the mocks.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/health` | Database, mock flag, replay state. |
| GET | `/api/alerts` | Alerts newest first, joined with ring risk, member count and volume. |
| GET | `/api/rings` | Ring summaries. Not in the TRD contract table. |
| GET | `/api/rings/:id` | Members, roles, transaction edges, identity edges. |
| GET | `/api/rings/:id/taint` | `?txn=&as_of=`. Calls Python, else cached default. |
| POST | `/api/rings/:id/freeze` | Body `{k, exclude, txn, as_of}`. `k` is how many accounts to recommend, 0-10, default 3. Calls Python, else cached default. |
| GET | `/api/rings/:id/recruits` | From the database, never Python. |
| GET | `/api/rings/:id/geo` | Home branches and cash-out points. |
| GET | `/api/accounts/:id` | Features, role, signals, identifiers, recent activity. |
| GET | `/api/metrics` | The V1 against V2 table. |
| POST | `/api/rings/:id/evidence` | PDF. Body `{graph_png, txn, as_of}`. |
| POST | `/api/replay/start` | Body `{speed}`. |
| POST | `/api/replay/stop` | |
| GET | `/api/replay/state` | Progress, for the replay bar. |

Errors are `{ "error": "message" }` with a 4xx or 5xx status. A DTO that fails
validation returns 400 with the failing fields under `details.fields`.

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

`src/models/` is the source of truth. Collections: `rings`, `accounts`,
`identifiers`, `transactions`, `alerts`, `recruits`, `metrics`, `seed_meta`.

Field names are the snake_case of TRD section 6 verbatim, because section 6 says
"field names below are the contract between all three services". There is no
column mapping layer: what the Python pipeline writes into `data/<profile>/*.json`
is what lands in the document. `_id` is a string everywhere, since section 6 says
"IDs are strings", and the API exposes it as `id`.

MongoDB has no migrations, no schema file to push and no client to generate, so
there is nothing to run before the first query. The one thing the database has to
be told is which indexes exist, which is `npm run db:indexes` — the seeder and the
test setup both call it, so a fresh database is indexed before anything reads it.

`createIndexes`, not `syncIndexes`: the second drops any index it does not
recognise, which on a shared Atlas cluster means quietly deleting somebody else's.

Six deliberate choices, each explained in a comment where it lives:

- **Money is a plain number.** MongoDB has no decimal type that round-trips as a
  JSON number, and TRD section 8 requires amounts to be JSON numbers. The largest
  figure in this dataset is far inside float64's exact integer range.
- **`from` and `to` are the contract's own field names.** They are SQL keywords,
  not MongoDB ones. This is the single biggest simplification of a document store
  over a relational one for this schema.
- **No foreign keys anywhere.** Cash-out is a transfer to the sentinel account id
  `CASH`, which is not a document in `accounts`. MongoDB has no foreign keys, so
  that is a legal document rather than a problem to work around. A relational
  schema would need either a fake account row that then appears in account
  listings, or a nullable column and a special case in every query.
- **One identifier document with an array, not a row per link.** The question the
  dashboard asks is "which accounts share this device", which is the array itself.
  Indexed as an ordinary multikey index, so it is one lookup rather than one query
  per account.
- **`accounts.role` is a string, not an enum.** MongoDB has no enum type, and the
  closed set in TRD section 7.5 includes `cash-out`, which is not a legal
  identifier. The set is enforced by `toAccountRole` in `src/constants`, so an
  unrecognised value degrades to `member` rather than reaching the dashboard as a
  role nobody recognises.
- **`channel` and `type` are validated enums.** Their names already match the
  contract, and the schema is where the constraint lives now that the database
  cannot enforce one. A profile with an unknown channel fails the seed instead of
  landing half-loaded.

`is_fraud` is stored and never serialised. The `Transaction` domain type has no
such field, so no mapper can leak it even by accident, and a test asserts it
appears in no response.

### Transactions need a replica set

MongoDB only allows a transaction to start on a replica set, and the seeder wraps
its whole load in one so a failure part way through leaves the previous data
intact. Atlas is a replica set by default, so an Atlas `MONGO_URL` just works.

A local `mongod` is not, and will fail with `Transactions are not supported by
this deployment`. Either point at Atlas or start a local single-node replica set:

```bash
mongod --replSet rs0 --dbpath /var/lib/mongodb
mongosh --eval 'rs.initiate()'      # once
```

### null and missing are different

MongoDB distinguishes a field set to `null` from a field that is absent, and a
query for `null` matches both. Every schema here sets `default: null`, so every
document has every field present, which keeps the two the same. Nothing in the
codebase filters on `= null` today; if something starts to, this is the reason it
may need `$exists` as well.

## What the seeder expects

`npm run seed` reads the generator's output and the pipeline's outputs, then
clears and reloads inside one transaction. It is safe to run repeatedly.

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
`src/fixtures/generator.ts`. That module is **not** the data generator and should
be deleted once the real one lands. It produces roughly 600 accounts, 5,000
transactions and three planted rings following the PRD demo scenario, and it
satisfies the TRD section 13 invariants, which is why the demo has something
coherent to show.

`recruits` is a collection the TRD does not have but the API needs: section 3
allows only taint and freeze to call Python live, so the pipeline's recruitment
output has to be stored for `GET /rings/:id/recruits` to be answerable.

## Mocks

`src/mocks/` holds contract-shaped payloads for every endpoint, typed against the
same interfaces the real routes return. `USE_MOCKS=true` serves them, so the
dashboard can be built before the pipeline exists. A mock that drifts from the
contract is a compile error rather than something the frontend discovers at 2am.

The mock taint conserves to the victim amount exactly as the real one does, so the
dashboard's totals behave the same either way.

## When Python is down

`src/services/ml.service.ts` enforces the 3 second timeout and, on timeout,
connection error or a non-2xx response, returns the ring's stored
`default_taint` or `default_freeze` with `"cached": true`. No route fails because
the ML service is unreachable.

On the cached path Python cannot re-optimise around an excluded account, so the
freeze route recomputes `secured` and `pct_stopped` from the ring's own
per-account taint. Un-ticking an account in the dashboard therefore still lowers
the percentage, which demo step 6 depends on.

## Tests

```bash
npm test
```

98 checks. All of them run, every time, with or without a configured database:
`test/global-setup.ts` uses `MONGO_URL` when there is one and otherwise starts a
single-node replica set in-process. Nothing skips itself.

That is deliberate. The persistence layer is where a type system stops helping: a
repository can typecheck perfectly and still query a field name that does not
exist, which returns zero rows and looks like a data problem rather than a typo.
Two real bugs in this codebase were invisible until these checks could actually
run:

- the replay engine read its script at startup without installing it, so pressing
  play threw `replay script is empty` on a live demo
- `insertMany` with `ordered: false` silently *drops* documents that fail
  validation instead of raising, so an unknown channel became a missing
  transaction rather than an error

The suite uses `MONGO_URL` with the database name replaced by `chakravyuh_test`,
because it clears collections and that should never cost anyone their dev data.
Set `TEST_MONGO_URL` to override. Files run one at a time so they can share it.

## Deviations from TRD

1. **Atlas, not a local MongoDB.** TRD section 2 says `MongoDB (local)`. An Atlas
   connection string is the same wire protocol and the same driver; it just means
   the demo laptop does not need a running mongod. A local replica set works
   unchanged.
2. **`recruits` collection added.** See above.
3. **Express 4, pinned with a caret range.** Express 5 is current, but its
   path-handling changes are not worth the risk inside a 26 hour build.
4. **`src/models/`, `src/repositories/`, `src/mappers/` are a refinement of the
   TRD section 4 sketch.** The TRD lists `models/`, `routes/` and `mocks/`; the
   rest of the layering here is ours.
