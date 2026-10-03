# Project status — 3 Oct 2026

**Snapshot of all three services, what is done, and what is not.**

This supersedes the status sections in `BACKEND_STATUS.md`. Read this first for
where things stand; read the others for how and why.

The latest backend verification is the fund-flow update below. Other service,
live-integration and dataset observations are retained from the earlier snapshot;
they were not remeasured during that update.

## Latest backend update — fund-flow persistence

**Implemented and regression-tested, 3 Oct 2026.** The file-based seeder now
reads optional `data/<profile>/outputs/fund_flows.json` and persists:

- `fund_flow_paths`: individual paths keyed by their string `path_id`.
- `fund_flow_summaries`: one `{ _id: "main", profile, summary }` document.

Both collections use the existing index registry, truncation and transaction.
Amounts remain integer paise; `amount_decay_pct` remains a nominal transaction
amount difference. The feature is persistence-only, with API exposure pending.

**Verified:** typecheck clean; **145 tests passed across 13 files, none skipped**
(130 existing + 15 new). Populated path/summary collections, `truncated`,
idempotency, missing/empty files and rollback were verified with test artifacts.

**Remaining verification:** `data/demo/outputs/fund_flows.json` was absent from
this checkout. The real demo profile seeded twice in an isolated temporary
replica set with identical counts: 926 accounts, 475 identifiers, 8,041
transactions, 3 rings, 3 alerts and zero fund-flow documents. The actual ML
artifact's path count and `truncated` value still need verification once the
file is supplied.

Contract: [ML_INTEGRATION.md §3.9](ML_INTEGRATION.md#39-outputsfund_flowsjson--optional-object).
Evidence: [fund-flow persistence report](tests/04-FUND-FLOW-PERSISTENCE.md).

**Measured evidence lives in [`tests/`](tests/):**

| Report | Establishes |
| --- | --- |
| [`tests/01-LOCAL-MONGO-SETUP-AND-BENCHMARK.md`](tests/01-LOCAL-MONGO-SETUP-AND-BENCHMARK.md) | 1M transactions in 2.45s, saturation ceilings, Atlas-vs-local matrix |
| [`tests/02-FULL-STACK-TEST-REPORT.md`](tests/02-FULL-STACK-TEST-REPORT.md) | All three services tested together, venv setup, live Python |
| [`tests/03-THROUGHPUT-STRATEGY.md`](tests/03-THROUGHPUT-STRATEGY.md) | The 1M-in-30-40s requirement and what each reading costs |
| [`tests/04-FUND-FLOW-PERSISTENCE.md`](tests/04-FUND-FLOW-PERSISTENCE.md) | Additive fund-flow storage, 145 backend tests, two demo seeds, missing-artifact verification limit |

---

## At a glance

| Service | State | Blocker |
| --- | --- | --- |
| Server (`server/`) | Fund-flow persistence implemented; **145 tests passing** | Actual demo fund-flow artifact absent; population verification pending |
| ML pipeline (`ml/`) | **Complete.** 17 modules, 7,521 LOC, 33 tests | none |
| Frontend (`client/`) | In progress, not ours to assess | — |
| Integration | **Live.** `/taint` and `/mincut` answered by real Python | none |

The earlier full-stack run verified live Python answering the server. The latest
fund-flow run verified backend persistence and regressions on isolated replica
sets; it did not rerun the ML suite or live Python integration.

---

## Server: complete

```
typecheck      clean
tests          145 checks, 13 files, 0 skipped
API            stored-data and live-streaming routes; fund flows are persistence-only
models         10 registered Mongoose models, including seed_meta
repositories   10
verification   isolated local MongoDB replica sets
```

### Stored-data endpoints

The live-streaming routes are documented in [STREAMING.md](STREAMING.md).

```
GET  /health                      POST /api/pipeline/run
GET  /api/alerts                  POST /api/replay/start
GET  /api/rings                   POST /api/replay/stop
GET  /api/rings/:id               GET  /api/replay/state
GET  /api/rings/:id/taint         GET  /api/transactions
POST /api/rings/:id/freeze        GET  /api/accounts/:id
GET  /api/rings/:id/recruits      GET  /api/metrics
GET  /api/rings/:id/geo           POST /api/rings/:id/evidence
```

Two previously added endpoints, neither in the original TRD §8 table:

- **`POST /api/pipeline/run`** — triggers the Python pipeline, then reseeds.
  Previously `runPipeline()` existed in `ml.service.ts` with no controller and no
  route, so it was unreachable. It calls `seed(profile, { forceFixtures: false })`
  deliberately: with `SEED_FIXTURES=true` the seeder would substitute the
  built-in generator and report success while the dashboard kept showing fixture
  data.
- **`GET /api/transactions`** — paginated ledger, requested by the frontend.
  Sorts `{ ts: 1, _id: 1 }`, not `ts` alone, so a page boundary cannot repeat or
  drop a transaction when several share a timestamp. There is a test asserting
  no overlap across a boundary.

### Earlier live-database verification

```
926 accounts · 9,391 transactions · 3 rings · 3 alerts
11/11 endpoints 200 · replay queue 9,391 · is_fraud never present
freeze exclusion: 0.643 → 0.302 → 0.129
taint/freeze:     cached: false  (live Python answering)
```

Verified on both Atlas and the local replica set. Throughput figures in
[`tests/01`](tests/01-LOCAL-MONGO-SETUP-AND-BENCHMARK.md).

### Test breakdown

| File | Checks |
| --- | --- |
| `contract.test.ts` | 25 |
| `replay.test.ts` | 16 |
| `fixtures.test.ts` | 16 |
| `seed.test.ts` | 12 |
| `ml-fallback.test.ts` | 11 |
| `mocks.contract.test.ts` | 11 |
| `transactions.test.ts` | 7 |
| `evidence.test.ts` | 7 |
| `pipeline.test.ts` | 4 |
| `mongo-url.test.ts` | 5 |
| `freeze-edge.test.ts` | 3 |
| `stream.service.test.ts` | 13 |
| `fund_flows.test.ts` | 15 |

The latest full-suite run used an isolated replica set and an unreachable ML
URL for the existing fallback checks. See report 04 for the exact command.

Two real bugs were invisible until the database-backed tests could actually run:

- The replay engine read its script at startup without installing it, then threw
  `replay script is empty` the moment anyone pressed play.
- `insertMany` with `ordered: false` silently drops invalid documents, so an
  unknown channel would vanish from the dataset rather than error.

---

## ML: complete, running

```
17 modules · 8 test files · 7,521 LOC
syntax          all modules parse
third-party     10 deps, all installed in ml/.venv (38 packages)
tests           33 passed
service         running on :8000
```

Modules: `generate, features, models, rings, taint, freeze, detector, loop,
adversary, export, service, run, config, geo, demo_judges, mongo_pusher,
pipeline`.

### Setup that was missing

There was no `requirements.txt` and no virtualenv. Reconstructed
`ml/requirements.txt` from the imports in `ml/*.py`, created `ml/.venv`, and
installed 38 packages.

**One prerequisite that is not a Python package:** xgboost needs the OpenMP
runtime.

```
XGBoost Library (libxgboost.dylib) could not be loaded.
  → Library not loaded: @rpath/libomp.dylib
brew install libomp
```

xgboost, shap and sklearn are each guarded by `try/except ImportError` in
`ml/models.py`, so the module **imports fine without them** and fails only at
`XGBClassifier.fit()`. That is why the gap was invisible until a pipeline run.

Two more that cost time:

- Run pytest from the **repo root**: `ml/.venv/bin/python -m pytest ml/tests/`.
  From `ml/` all 8 files fail to collect with `No module named 'ml'`.
- `/taint` and `/freeze` now return `cached: false`. The live Python path is
  verified, not assumed.

---

## Data

Pushed directly by the pipeline, bypassing the seeder. Present in both Atlas and
the local replica set:

```
accounts    926          transactions  9,391
identifiers 475          rings          3
signals     27/926       recruits       0
```

```
RING01  risk=0.9998  members=10  volume=115119   taint=10  freeze=[ACC1069]
RING02  risk=0.9999  members= 5  volume=2578684  taint= 5  freeze=[ACC1034]
RING03  risk=0.9992  members=11  volume=1950903  taint=10  freeze=[ACC1008,ACC1009]
```

`mongo_pusher.py` does `delete_many({})` per collection before inserting, so a
re-push is a clean wipe with no orphans.

Sample document, confirming the field contract:

```
TXN000276  amount=16835  channel=ATM  ts=Date object
```

`amount` with no `amount_paise` key. `ts` stored as a real Date.

---

## Open issues

### Fund-flow demo artifact pending

Persistence is implemented, but the real `data/demo/outputs/fund_flows.json`
was not available during verification. The demo seeds therefore exercised the
missing-optional-file path. Populated collections and summary preservation are
covered by backend tests; verification against the actual ML output is pending.

The earlier demo issues below are retained from the previous snapshot.

### Fixed 3 Oct 2026 — in the ML code

Three bugs, all found by measurement rather than reading:

**1. `amount_paise` was the wrong key for the Mongo push.** `mongo_pusher.py`
read `amount_paise` while the on-disk JSON had already been converted to `amount`
by `run.py`. Every transaction pushed to Atlas was stored with
`amount_paise: 0`, so `/api/transactions` returned rows the schema rejected and
the ledger was effectively empty against live data. Fixed by having the pusher
use the same field the exporter writes.

**2. Taint conservation failed by up to 257,214.** TRD §7.6's stated main
invariant — taint summed across all accounts including `CASH` must equal the
victim amount — was violated because `run.py` and `service.py` each converted
paise to rupees using a *magnitude threshold* rather than a known unit:

```python
int(v) // 100 if int(v) > 10_000 else int(v)   # service.py
int(v) // 100 if int(v) > 100_000 else int(v)  # run.py
```

`trace()` is unconditionally paise, so any value at or below the threshold was
emitted as paise while larger values were divided — one response in two
currencies. Both now convert unconditionally and round rather than truncate, and
both call a single shared `paise_to_rupees` so the batch path and the live
service cannot drift apart again. Gaps are now 0–1 rupee.

**3. Victim deposit labels were shifted.** Each ring's `victim_txn_ids[0]`
carried a sender naming a different ring (`VICTIM_RING03` on RING01). The
generator is correct; the labels are incidental because `rings.py` assigns ring
ids by community discovery order, not by planted ring. **Not fixed and not a
bug** — tightening the match to `VICTIM_{ring_id}` was tried and left every ring
with zero victims. The invariant that matters is structural and is now asserted
in `ml/tests/test_victim_ring_match.py`.

Regression tests added: `test_victim_ring_match.py` and `test_taint_conservation.py`.

### 1. Ring risk is ~0.999 on all three rings

```
0.9998 · 0.9999 · 0.9992
```

TRD §7.4 defines ring risk as the **mean** member `risk_v2`, so a mean of 0.999
means nearly every member scores near 1.0. Three bars all at 99.9% reads as
synthetic, which is the opposite of what the demo needs.

The `risk_v2` scale bug **is fixed** — `_normalise_to_100` is no longer called in
`ml/models.py`, and scores are now true 0–1 probabilities. But the fix has not
changed the stored values, so either the push predates it or the model genuinely
produces these. Worth confirming which before the demo.

### 2. `signals` present on 27 of 926 accounts

Deliberate: SHAP runs only for accounts above `risk_v2 >= 0.5`, and 27 cross the
threshold. Defensible on compute grounds.

The consequence is that the account panel — the main explainability surface —
is empty for 97% of accounts. The frontend should render "not scored, below the
risk threshold" rather than a blank panel.

### 3. `recruits` collection is empty

F10 fell back to a hand-weighted score rather than a true probability. Per
TRD §7.8 that must be labelled **"risk score", not "probability"**, and the
frontend will do exactly that.

The panel renders empty until the predictor runs.

### 4. Scratch files in the repo root

`patch_answers.py`, `patch_gen.py`, `revert_gen.py`. `patch_answers.py` edits
`ml/BACKEND_ANSWERS.md` in place, which is how the answer text changed after the
code it described. Not ours to remove, but confusing to anyone reading the repo.

### 5. `generate.py` emits `amount_paise` on purpose

25 occurrences. The design is that the internal pipeline needs paise for taint
arithmetic, and `run.py` converts to rupees on export.

This is a reasonable design, but the consequence should be written down
somewhere: **`pnpm run seed` only works on files produced by `run.py`**, never on
raw generator output. A file from a direct `generate.py` run would fail on every
transaction with an error that does not explain itself.

---

## Contract: what the server expects

TRD §6 verbatim, snake_case, no mapping layer.

| Field | Rule |
|---| --- |
| `_id` | string everywhere; API exposes it as `id` |
| `amount` | **integer rupees**, not paise |
| `ts` | ISO 8601, parsed to a real Date |
| `channel` | `UPI \| IMPS \| NEFT \| ATM`, validated — a bad value fails the whole seed |
| `location` | `{city, lat, lng}` on ATM, `null` otherwise |
| `is_fraud` | stored, **never serialised** |
| `CASH` | sentinel id, never an account document |
| `signals[]` | `{feature, label, weight}`; `label` is human-readable |
| `default_taint` / `default_freeze` | real payloads, not `{}` — they are what the dashboard shows when Python is down |

The additive fund-flow artifact has its own contract: `path_id` becomes the
path document's string `_id`, its timestamps become Dates, and `*_paise` values
remain integer paise. It has no ring/role fields or public API representation.
See [ML_INTEGRATION.md §3.9](ML_INTEGRATION.md#39-outputsfund_flowsjson--optional-object).

---

## Data flow as it actually works

```
ml/run.py  →  ml/data/<profile>/*.json  →  mongo_pusher.py  →  MongoDB
                                                            (local rs0 or Atlas)
                                                                    │
                                                                    ▼
                                              server reads via Mongoose
                                                                    │
                                                       ┌────────────┴────────────┐
                                                       ▼                         ▼
                                              REST + Socket.IO          /taint, /freeze
                                                                         (live, verified)
```

**`pnpm run seed` is not part of this flow.** It exists for the other path, where
data arrives as files. Running it now would overwrite the ML team's data with
fixtures.

The new fund-flow ingestion belongs to that **file-based path**. An intentional
full-profile import uses `SEED_FIXTURES=false pnpm run seed demo` from `server/`.
It replaces all registered collections in one transaction. The existing direct
ML push is a separate path; this backend change does not add fund-flow ingestion
to that pusher.

After a direct push, the only command needed is:

```bash
pnpm run db:indexes      # the seeder normally does this; a direct push skips it
pnpm start
```

---

## To run it

```bash
# database — replica set is required for the seeder's transaction
brew tap mongodb/brew && brew trust mongodb/brew
brew install mongodb-community@9.0
brew install libomp                          # xgboost's native dependency
cd server && nohup mongod --config .mongorc-local &
mongosh --eval 'rs.initiate({_id:"rs0",members:[{_id:0,host:"127.0.0.1:27017"}]})'

# ML
ml/.venv/bin/python ml/service.py            # http://localhost:8000
ml/.venv/bin/python -m pytest ml/tests/ -q   # from the repo root, not ml/
python ml/run.py                             # generate + pipeline + push

# backend
cd server
pnpm run db:indexes                          # only after a fresh ML push
pnpm start                                   # http://localhost:4000

# frontend, no database needed
USE_MOCKS=true pnpm start
```

Verify which mode you are in:

```bash
curl localhost:4000/health
curl localhost:4000/api/rings/RING01/taint | grep cached
```

`cached: false` means the live Python path works — verified working now.
`true` means Python is down and the dashboard is showing stored defaults.

---

## Git state

Branch `impl_pipeline_ml_n_server`, tracking `origin/impl_pipeline_ml_n_server`,
merged with `origin/main` cleanly.

`pull.rebase=false` is configured, so `git pull` merges. This matters: rebase
rewrites history and creates new hashes every time, which caused a recurring
conflict loop earlier in the build. Merge is idempotent — pulling twice does
nothing the second time.
