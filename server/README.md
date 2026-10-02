# Chakravyuh server

Express API, Socket.IO replay and the evidence pack. This is the whole of the
server-side scope from `TRD.md`: F6 (API and storage), F11 (live replay), F12
(evidence pack), plus the ML client, the seeder and the contract mocks.

TypeScript, Prisma 7 against PostgreSQL, class-validator on every request.

## Quick start

```bash
cp .env.example .env      # then put a real DATABASE_URL in it
npm install               # also runs `prisma generate` via postinstall
npm run migrate:dev       # create the schema
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

## Layout

```
server/
├── prisma/
│   └── schema.prisma          the data model, and where the odd choices are explained
├── prisma.config.ts           migration connection (Prisma 7 has no url in the schema)
├── src/
│   ├── bin/                   server.ts (http + socket), seed.ts
│   ├── configs/               env.ts, prisma.ts (the client singleton)
│   ├── constants/             roles, channels, sentinels, socket event names
│   ├── controllers/           request in, response out, no logic
│   ├── services/              replay engine, evidence PDF, ML client, seeder
│   ├── repositories/          one per collection, all Prisma queries live here
│   ├── DTOClasses/            class-validator request classes
│   ├── exceptions/            AppError and the status codes
│   ├── middlewares/           validate(Dto), error handler, 404, asyncHandler
│   ├── routes/                one table per resource
│   ├── utilities/             iso(), chunk(), small pure helpers
│   ├── interfaces/            domain and repository types, no Prisma in domain
│   ├── mappers/               row -> domain -> wire, in two explicit steps
│   ├── fixtures/              dev fixture generator (see below)
│   ├── mocks/                 contract payloads and their router
│   ├── app.ts                 Express assembly
│   └── repositories/prisma/   generated; do not edit
└── test/
```

A request travels `route -> validate(Dto) -> controller -> repository -> mapper`.
Controllers never build queries; repositories never shape responses.

## Environment

Copy `.env.example` to `.env`. Every value has a working default except
`DATABASE_URL`, which is required unless you are running in mock mode.

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | `4000` | |
| `DATABASE_URL` | *(placeholder)* | PostgreSQL. Required except in mock mode. |
| `TEST_DATABASE_URL` | *(unset)* | Overrides which database the suite uses. |
| `ML_URL` | `http://localhost:8000` | The Python service. |
| `ML_TIMEOUT_MS` | `3000` | Per TRD section 3. |
| `USE_MOCKS` | `false` | Serve contract mocks; opens no database. |
| `SEED_PROFILE` | `demo` | Reads `data/<profile>/`. |
| `SEED_FIXTURES` | `true` | Allow the dev fixtures when `data/` is missing. |
| `REPLAY_DEFAULT_SPEED` | `60` | Replay seconds per real second. |
| `REPLAY_TICK_MS` | `250` | Clock cadence, per TRD section 9. |

`.env` ships with a placeholder connection string so `prisma generate` works with
no database at all. Anything containing the word `placeholder` is treated as "no
database", which is what keeps `npm test` and `npm start` honest before the real
one arrives.

## Commands

| Command | Does |
| --- | --- |
| `npm run dev` | `tsx watch` on `src/bin/server.ts`. |
| `npm start` | Run the server. |
| `npm run build` | Compile `src/` to `dist/` with `tsconfig.build.json`. |
| `npm run typecheck` | Typecheck everything including tests. No emit. |
| `npm run migrate:dev` | Create and apply a migration. Use while the schema moves. |
| `npm run migrate` | `migrate deploy`. Use for an existing environment. |
| `npm run db:push` | Sync the schema without a migration. Prototyping only. |
| `npm run studio` | Prisma Studio. |
| `npm run seed` | Load `data/<profile>/`, or the fixtures. |
| `npm test` | Vitest. |
| `npm run prisma:generate` | Regenerate the client. Also runs on `postinstall`. |

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
| POST | `/api/rings/:id/freeze` | Body `{k, exclude, txn, as_of}`. Calls Python, else cached default. |
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

`prisma/schema.prisma` is the source of truth. Tables: `rings`, `accounts`,
`identifiers`, `transactions`, `alerts`, `recruits`, `metrics`, `seed_meta`.

Prisma 7 keeps the connection string out of the schema: the runtime client gets
it through `@prisma/adapter-pg` in `src/configs/prisma.ts`, and the migration CLI
gets it through `prisma.config.ts`. Both read the same `DATABASE_URL`.

Four deliberate choices, each explained in a comment where it lives:

- **Money is `Float`, never `Decimal`.** Prisma maps `Decimal` to an object that
  serialises as a JSON *string*, which breaks TRD section 8's requirement that
  amounts be JSON numbers. The largest figure here is far inside float64's exact
  integer range.
- **No foreign keys on `transactions.from_account` and `to_account`.** Cash-out is
  a transfer to the sentinel account id `CASH`, which is not a row in `accounts`.
- **`recruits` is an addition.** TRD section 6 has no collection for it, but
  TRD section 3 allows only taint and freeze to call Python, so the pipeline
  output has to be stored for `GET /rings/:id/recruits` to be answerable.
- **`accounts.role` is a `String`, not an enum.** Prisma forbids hyphens in enum
  names, so `cash-out` needs `@map`, and Prisma 7's generated enum still emits
  the underscore spelling to TypeScript. That mismatch is only observable against
  a live database and would silently null every role in the demo. The closed set
  is enforced by the `AccountRole` union in `src/constants` and by the seeder.
  `Channel` and `IdentifierType` are real enums because their names already match
  the contract exactly.

`is_fraud` is stored and never serialised. The `Transaction` domain type has no
such field, so no mapper can leak it even by accident, and a test asserts it
appears in no response.

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
`src/fixtures/generator.ts`. That module is **not** the data generator and should
be deleted once the real one lands. It produces roughly 600 accounts, 5,000
transactions and three planted rings following the PRD demo scenario, and it
satisfies the TRD section 13 invariants, which is why the demo has something
coherent to show.

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

54 checks run with no database and no files on disk. 43 more skip themselves
until `DATABASE_URL` is set, then run as written.

Always runs:

- `evidence.test.ts` — the PDF is a real PDF, and still produced with sections missing.
- `fixtures.test.ts` — the TRD section 13 generator invariants.
- `replay.test.ts` — ordering, clock cadence, alert firing, end condition, REST control.
- `mocks.contract.test.ts` — the TRD section 8 shapes against the mocks.
- `ml-fallback.test.ts` — taint and freeze return `cached: true` with Python stopped.

Runs once `DATABASE_URL` is set:

- `contract.test.ts` — every endpoint against the TRD section 8 shapes, real data.
- the database-backed groups inside `replay.test.ts` and `ml-fallback.test.ts`,
  and `seed.test.ts` — reseeding does not duplicate, and a failed seed rolls back.

Tests run against `DATABASE_URL` with `?schema=chakravyuh_test` appended, because
the suite truncates tables and that should never cost anyone their dev data. Set
`TEST_DATABASE_URL` to override. Files run one at a time so they can share that
schema.

Prisma ships its own query engine, so there is no in-process PostgreSQL
substitute: the database-backed files are genuinely skipped, not quietly faked.

## Deviations from TRD

1. **PostgreSQL, not MongoDB.** The team chose PostgreSQL. `MONGO_URL` is
   `DATABASE_URL`, the persistence layer is Prisma rather than Mongoose, and the
   field names follow TRD section 6 with `_id` exposed as `id`.
2. **`recruits` table added.** See above.
3. **Express 4, pinned with a caret range.** Express 5 is current, but its
   path-handling changes are not worth the risk inside a 26 hour build.