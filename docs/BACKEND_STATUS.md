# Backend: what has been built

**Owner:** Member 1 (server).

This is what exists, why it is built the way it is, and what is deliberately not
done. Read `HOW_DATA_FLOWS.md` if you need to know how to feed it;
`ML_INTEGRATION.md` if you are writing the pipeline.

> **For current numbers, read `PROJECT_STATUS.md` first.** This document explains
> the design and the reasoning; that one records what is true right now. They are
> kept separate deliberately — a design doc that gets rewritten every time
> something changes stops being a design doc.
>
> Measured benchmarks and test reports are in [`tests/`](tests/).

---

## Status

Working and verified against **MongoDB Atlas** (`hackathon.gqtv7yg.mongodb.net`).

```
pnpm typecheck   clean
pnpm test        114 passed, 0 failed, 0 skipped
```

Serving the ML team's pushed dataset: 926 accounts, 8,041 transactions, 3 rings,
3 alerts. All 15 endpoints return correct shapes.

Stack: Express 4, TypeScript (strict), Mongoose 9, class-validator, Socket.IO,
~6,750 lines across `src/` and `test/`.

### The three services, as they actually stand

| Area | State |
| --- | --- |
| Server (`server/`) | Complete. 15 endpoints, 114 tests, verified live against Atlas |
| ML pipeline (`ml/`) | Written. 17 modules, ~7,500 lines. 12 deps not installed, so untested from here |
| Frontend (`client/`) | In progress — Next.js, graph components landed on `main` |

---

## What was built, in order

### 1. Scaffold and data layer
14-folder structure per TRD §4, Express app assembly, the seven collections, a
seeder that loads JSON in one transaction, and contract-shaped fixtures so the
dashboard had something coherent to show before the pipeline existed.

### 2. The API
Six controllers, all 14 endpoints at TRD §8 shapes, DTO validation on every
request, the evidence pack PDF, and live replay over Socket.IO.

### 3. TypeScript migration
`fad803e` — plain JavaScript to strict TypeScript. `class-validator` on every
request, typed domain layer, no `any` in the request path.

### 4. PostgreSQL to MongoDB
`6ce0b00`, `6a7ee26` — the current state.

This was forced, not chosen for taste. Prisma 7 **does not support MongoDB at
all** — its own docs say to stay on v6.19. The team had picked PostgreSQL with
Prisma 7, so that combination could not work. Mongoose is also what TRD line 30
specifies and what PRD F6 names, so it is the better landing spot regardless.

What that meant in practice:

- Deleted `prisma/`, `prisma.config.ts`, the generated client, and the
  migration scripts. MongoDB has no migrations and Mongoose has no codegen, so
  there is nothing to generate and nothing to push.
- Added `src/models/` — one Mongoose schema per collection. TRD §4 line 85
  mandates this folder for a Mongoose stack.
- Added `src/bin/indexes.ts`, the closest thing MongoDB has to a schema push.
- Rewrote all nine repositories.

### 5. Documentation
`docs/ML_INTEGRATION.md`, `docs/HOW_DATA_FLOWS.md`, and README rewrites.

### 6. Merged with the other two members' work
`ac118cc`. `main` brought in the ML pipeline and the frontend's graph
components. Two documentation conflicts resolved in favour of `main`, which had
the newer content. The PostgreSQL files and `tsconfig.build.json` were not
resurrected by the merge.

The `amount_paise` naming and the data-directory split date from this merge.
See §Not done.

---

## Architecture

```
route → validate DTO → controller → repository → mapper → JSON
```

Controllers never build queries. Repositories never shape responses. One
direction of dependency only, which is why swapping the database twice did not
touch the controllers.

| Folder | Files | Role |
| --- | --- | --- |
| `bin/` | 3 | `server.ts`, `seed.ts`, `indexes.ts` |
| `models/` | 9 | Mongoose schemas, `collection()` options, `strictQuery: 'throw'` |
| `configs/` | 2 | `env.ts`, `mongoose.ts` |
| `constants/` | 1 | roles, channels, sentinels, socket events |
| `controllers/` | 6 | request in, response out, no logic |
| `services/` | 4 | replay engine, evidence PDF, ML client, seeder |
| `repositories/` | 9 | one per collection, all queries live here |
| `DTOClasses/` | 1 | class-validator request classes |
| `exceptions/` | 1 | `AppError` and status codes |
| `middlewares/` | 2 | `validateDto`, error handler, 404, `asyncHandler` |
| `routes/` | 1 | one table per resource |
| `utilities/` | 2 | `iso()`, `chunk()`, `mongo-url` helpers |
| `interfaces/` | 2 | domain and repository types |
| `mappers/` | 2 | row → domain → wire, in two explicit steps |
| `fixtures/` | 3 | dev fixture generator (temporary) |
| `mocks/` | 2 | contract payloads and their router |

---

## Endpoints

Base path `/api`. All shapes asserted by tests against real data *and* mocks.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/health` | Database, mock flag, replay state |
| GET | `/api/alerts` | Newest first, joined with ring risk/members/volume |
| GET | `/api/rings` | Ring summaries |
| GET | `/api/rings/:id` | Members, roles, transaction edges, identity edges |
| GET | `/api/rings/:id/taint` | `?txn=&as_of=`. Calls Python, else cached |
| POST | `/api/rings/:id/freeze` | Body `{k, exclude, txn, as_of}`. `k` is 0–10, default 3 |
| GET | `/api/rings/:id/recruits` | From the database, never Python |
| GET | `/api/rings/:id/geo` | Home branches and cash-out points |
| GET | `/api/accounts/:id` | Features, role, signals, identifiers, recent activity |
| GET | `/api/metrics` | V1 against V2 table |
| POST | `/api/rings/:id/evidence` | PDF. Body `{graph_png, txn, as_of}` |
| POST | `/api/replay/start` | Body `{speed}` |
| POST | `/api/replay/stop` | |
| GET | `/api/replay/state` | Progress, for the replay bar |

Replay also runs over Socket.IO: `txn`, `alert`, `replay:clock`,
`replay:state`, `replay:end` out; `replay:start`, `replay:stop` in. REST and
socket share one engine instance, so a presenter can always recover with
`curl -X POST localhost:4000/api/replay/start -d '{"speed":600}'`.

Errors are `{ "error": "message" }`. A failed DTO returns 400 with the failing
fields under `details.fields`.

---

## Tests

103 checks across 8 files, **all of them running every time**. Nothing skips.

| File | Checks | Covers |
| --- | --- | --- |
| `contract.test.ts` | 25 | Every TRD §8 shape against real data |
| `replay.test.ts` | 16 | Engine plus the real seeded script |
| `fixtures.test.ts` | 16 | Generator invariants |
| `seed.test.ts` | 12 | Seeding, rollback, enum rejection, date round-trip |
| `mocks.contract.test.ts` | 11 | Mock shapes match the contract |
| `ml-fallback.test.ts` | 11 | Every degraded path when Python is down |
| `evidence.test.ts` | 7 | PDF validity |
| `mongo-url.test.ts` | 5 | Connection string normalisation |

With no `MONGO_URL`, `global-setup.ts` starts its own single-node replica set
in-process, so `pnpm test` needs nothing. With a URL, it uses that, pointed at
`chakravyuh_test` — a separate database on the same cluster, because the suite
clears collections and that should never cost anyone their dev data.

### Why the tests are not optional

The persistence layer is where the type system stops helping. A repository can
typecheck perfectly and still query a field name the schema does not have, which
returns zero rows and looks like a data problem rather than a typo.

Two real bugs were invisible until the database-backed tests actually ran, and
both would have surfaced during a live demo:

1. **The replay engine read its script at startup without installing it.** It
   reported the right transaction count, then threw `replay script is empty` the
   moment anyone pressed play.
2. **`insertMany` with `ordered: false` silently drops invalid documents.** A
   transaction with an unknown channel would vanish from the dataset instead of
   erroring — worse than the old PostgreSQL enum violation it replaced. Fixed by
   explicit per-document validation before insert.

The dead `skipIf(!hasDatabase())` guards were removed afterwards, so a silent
zero-test run cannot hide again.

---

## Decisions worth knowing about

**Snake_case storage, TRD §6 verbatim.** No column mapping layer. What the
pipeline writes into `data/<profile>/*.json` is what lands in the document. §6
says these names are the contract between all three services.

**`from` and `to` are literal field names.** They are SQL keywords, not MongoDB
ones. This is the single biggest simplification a document store bought here.

**No foreign keys anywhere.** Cash-out is a transfer to the sentinel id `CASH`,
which is not a document in `accounts`. That is a legal document here rather than
a problem to work around — a relational schema would need either a fake account
row that then shows up in listings, or a nullable column and a special case in
every query.

**`role` is a string, not an enum.** MongoDB has no enum type, and TRD §7.5's
set includes `cash-out`, which is not a legal identifier. Enforced by
`toAccountRole`, so an unrecognised value degrades to `member` rather than
reaching the dashboard as an unknown role.

**`channel` and `type` are validated enums.** Their names match the contract
already, and the schema is where the constraint lives now that the database
cannot enforce one. A profile with an unknown channel fails the seed loudly.

**Money is a plain number.** MongoDB has no decimal that round-trips as a JSON
number, and TRD §8 requires amounts as JSON numbers. Largest figure in the
dataset is far inside float64's exact integer range.

**`_id` is a string everywhere.** §6 says IDs are strings. The API exposes
`_id` as `id`, in one mapper, in one place.

**`is_fraud` is stored and never serialised.** The domain type has no such
field, so no mapper can leak it even by accident. Asserted by test in both real
and mock paths.

**`strictQuery: 'throw'` per schema.** Catches camelCase typos that would
otherwise match nothing, silently.

**`createIndexes`, never `syncIndexes`.** The second drops any index it does not
recognise, which on a shared Atlas cluster means quietly deleting somebody
else's.

**A name-less `MONGO_URL` gets `chakravyuh` appended.** MongoDB does not reject
a connection string with no database name — it silently connects to a database
called `test`, every query succeeds, and the data goes somewhere nobody is
looking. Found this the hard way; `mongo-url.test.ts` guards it.

### Deviations from TRD

1. **Atlas rather than a local MongoDB.** §2 says `MongoDB (local)`. Same
   driver, same wire protocol. Worth a decision only because a local
   *standalone* mongod cannot run the seeder's transaction at all — MongoDB
   requires a replica set, and Atlas provides one by default.
2. **`recruits` collection added.** §3 allows only taint and freeze to call
   Python live, so the pipeline's recruitment output has to be stored for
   `GET /rings/:id/recruits` to be answerable.
3. **Express 4, pinned with a caret.** Express 5 is current, but its path
   handling is not worth the risk inside a 26 hour build.
4. **`src/models/`, `src/repositories/`, `src/mappers/` refine the §4 sketch.**
   §4 lists `models/`, `routes/` and `mocks/`; the rest of the layering is ours.

---

## Not done

Called out so nobody assumes otherwise.

### Two blockers between the server and the pipeline

**Resolved 3 Oct 2026.** Both were on the ML side; see `PROJECT_STATUS.md` for
the current position.

**1. `amount_paise` versus `amount` — resolved by design.** The Atlas push writes
`amount` in rupees, confirmed live (`TXN000276 amount=16835`, no `amount_paise`
key). `ml/generate.py` still emits `amount_paise` internally, because the taint
arithmetic needs paise; `ml/run.py` converts on export. The consequence is that
`pnpm run seed` only works on files produced by `run.py`.

**2. The data directory no longer applies.** The ML team pushes directly to Atlas
via `mongo_pusher.py`, so the server reads whatever is in the database rather
than `data/<profile>/`. `pnpm run seed` is no longer part of the normal flow and
would overwrite their data with fixtures.

### Also outstanding

**The live Python path has still never run.** `ml/service.py` defines `/health`,
`/taint`, `/mincut`, `/pipeline/run` and `/ouroboros/run`, so the route names
line up. But `fastapi`, `uvicorn` and 10 other dependencies are not installed on
the backend machine, so the service has never started and `/taint` and `/freeze`
have only ever taken the cached-fallback path.

**`recruits` is empty.** The ML side confirmed F10 fell back to a hand-weighted
score rather than a true probability. Per TRD §7.8 the frontend must label it
"risk score", not "probability" — that is agreed.

**Ring risk reads ~0.999 on all three rings.** The `risk_v2` scale bug is fixed
(`_normalise_to_100` is no longer called), but the stored values are unchanged.
Three bars at 99.9% reads as synthetic. See `PROJECT_STATUS.md` §Open issues.

**No auth, no rate limiting.** Out of scope for the hackathon.

**`geo_spread_km` is inert.** The map is P2 per TRD §11.

---

## Running it

```bash
cd server
cp .env.example .env     # put your MONGO_URL in it
pnpm install
pnpm start                # http://localhost:4000
```

No schema step. Mongoose needs no generated client and MongoDB has no
migrations.

**The ML team pushes directly to Atlas**, so there is normally nothing to seed —
the server reads whatever is in the database. After they push a new dataset:

```bash
pnpm run db:indexes        # a direct push skips index creation
pnpm start
```

Do **not** run `pnpm run seed` casually. It exists for the file-based path and
would overwrite their data with fixtures.

Frontend work with no database:

```bash
USE_MOCKS=true pnpm start
```

Opens no database connection at all, which is what makes it usable without the
ML side running.

| Command | Does |
| --- | --- |
| `pnpm run dev` | `tsx watch` |
| `pnpm run build` | Compile to `dist/` |
| `pnpm run typecheck` | Typecheck everything including tests |
| `pnpm run db:indexes` | Create declared indexes. Run after an ML push |
| `pnpm run seed` | Load `data/<profile>/`. File-based path only |
| `pnpm test` | 114 checks; starts its own mongod if needed |

---

## Known PRD/TRD drift

Recorded rather than acted on, since `PRD.md` and `TRD.md` are shared team
documents and the resolution is a team decision.

1. **PRD is behind TRD in three places**, which §1 lists: evidence pack is `POST`
   not `GET`, the freeze optimiser takes an `as_of`, and the generator produces
   train and test profiles besides demo. `GET /metrics` and `POST /replay/*` also
   exist in the implementation but not in the PRD contract table.
2. **Atlas instead of local MongoDB.** See Deviations above.
3. **`accounts.role` as a string.** See Decisions above.

Everything the server does follows TRD, which is the newer document. If the team
prefers the PRD reading, that is a conversation, not a bug.
