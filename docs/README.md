# Chakravyuh documentation

Contracts, status and design for the three services. **Start with
[PROJECT_STATUS.md](PROJECT_STATUS.md)** — it records what is true right now.

## Current state

```
server/   Member 1  Express + TypeScript + Mongoose 9    171 tests passing
ml/       Member 3  Python pipeline, 17 modules          complete, 33 tests
client/   Member 2  Next.js dashboard                    in progress
docs/     this folder
```

The three work together against a local MongoDB 9.0 replica set or MongoDB Atlas.
`ml/service.py` answers `/taint` and `/mincut` live — responses carry
`"cached": false`, meaning Python is computing rather than serving a stored
default. Stored-data views are served from the database; [STREAMING.md](STREAMING.md)
describes the separate in-memory live mode.

**Latest backend addition:** correlated HTTP, MongoDB and Python logs, cached
fallback visibility, seed commit outcomes and replay/live-run summaries. Start
with `LOG_LEVEL=info LOG_FORMAT=pretty LOG_DB_ENABLED=true pnpm run dev` from
`server/`. See the [logging guide](REALTIME_BACKEND_LOGGING_PLAN.md) and
[verification report](tests/05-BACKEND-LOGGING.md).

**Previous addition:** optional `outputs/fund_flows.json` is now persisted
as individual `fund_flow_paths` documents and a current-profile
`fund_flow_summaries` document, within the existing seed transaction. See the
[artifact contract](ML_INTEGRATION.md#39-outputsfund_flowsjson--optional-object)
and [verification report](tests/04-FUND-FLOW-PERSISTENCE.md). Its 15 new tests
passed; population from the real demo artifact is pending because that file was
absent from the checkout.

## Read this first

| Document | For | What |
| --- | --- | --- |
| **[PROJECT_STATUS.md](PROJECT_STATUS.md)** | everyone | What is built, what is broken, what is not done |
| **[tests/](tests/)** | everyone | Measured benchmarks and test reports, numbered in reading order |

## Contracts — do not let these drift

| Document | For | What |
| --- | --- | --- |
| **[API_FOR_FRONTEND.md](API_FOR_FRONTEND.md)** | Member 2 | Every endpoint with real payloads. Start here |
| **[COMMUNICATION.md](COMMUNICATION.md)** | Member 2, Member 3 | How to talk to the server |
| **[ML_INTEGRATION.md](ML_INTEGRATION.md)** | Member 3 | File formats and endpoints the pipeline must satisfy |
| **[ML_PIPELINE_FLOW.md](ML_PIPELINE_FLOW.md)** | Member 3 | The Python pipeline step by step |
| **[HOW_DATA_FLOWS.md](HOW_DATA_FLOWS.md)** | Member 3 | What the server does after the seed |
| **[QUESTIONS_FOR_ML.md](QUESTIONS_FOR_ML.md)** | Member 3 | Open questions, with what was already answered |
| **[STREAMING.md](STREAMING.md)** | everyone | Generator, predictor and dashboard contracts for live mode |

## Design and decisions

| Document | What |
| --- | --- |
| **[BACKEND_STATUS.md](BACKEND_STATUS.md)** | Why the server is built the way it is |
| **[REALTIME_BACKEND_LOGGING_PLAN.md](REALTIME_BACKEND_LOGGING_PLAN.md)** | Implemented HTTP, ML and MongoDB logs: startup/configuration, correlation fields, slow-operation timing, seed and live-run lifecycle |

## From the ML team

Written by Member 3, not ours to edit:

| Document | What |
| --- | --- |
| [BACKEND_INTERFACE.md](BACKEND_INTERFACE.md) | The pipeline's own contract document |
| [ML_SYSTEM_STATUS_REPORT.md](ML_SYSTEM_STATUS_REPORT.md) | Their status report |
| [SERVER_INTEGRATION_VERIFICATION.md](SERVER_INTEGRATION_VERIFICATION.md) | Their integration verification |

Note: `BACKEND_INTERFACE.md` specifies `amount_paise` where TRD §6 and the server
specify `amount` in rupees. Resolved 3 Oct — `run.py` converts on export, so
Atlas holds `amount`. The document predates that fix.

## Running the stack

One command starts everything with prefixed, interleaved logs:

```bash
./dev.sh
```

```
[mongo]  replica set already initialised
[ml]     Uvicorn running on http://0.0.0.0:8000
[api]    … server.ready … port=4000 mode=database …

── ready ──
  ● API          http://localhost:4000
  ● ML service   http://localhost:8000
  ● MongoDB      http://localhost:27017
```

The API line above is abbreviated; its actual output is structured JSON or
pretty metadata depending on `LOG_FORMAT`.

| Flag | Does |
| --- | --- |
| `./dev.sh` | mongod + ML service + API |
| `./dev.sh --no-ml` | API only — use when testing the cached fallback |
| `./dev.sh --seed` | Reseed first |
| `./dev.sh --stop` | Stop whatever it started |

Ctrl-C stops everything. Without that, orphaned mongod processes keep port 27017
and the next run reports a conflict that looks like a different problem.

Verify the ML service is answering rather than serving a stored default:

```bash
curl localhost:4000/api/rings/RING01/taint | grep cached
```

`"cached": false` means live Python. `true` means fallback.

### One-time setup

```bash
brew tap mongodb/brew && brew trust mongodb/brew
brew install mongodb-community@9.0        # replica set required, see below
brew install libomp                       # xgboost's native dep
python3 -m venv ml/.venv
ml/.venv/bin/pip install -r ml/requirements.txt
cd server && pnpm install
```

A **replica set is mandatory** — the seeder wraps its load in a transaction and
MongoDB only permits transactions on one. `dev.sh` initiates `rs0` on first run.

The ML team's direct-push workflow needs only index creation on the server.
The default seed selects fixtures and replaces registered collections. For an
intentional import of a complete exported profile, including optional fund flows,
use `SEED_FIXTURES=false pnpm run seed demo` from `server/`. This is a full
dataset replacement, not a single-artifact merge.

Frontend without a database: `USE_MOCKS=true pnpm start` — identical shapes.
