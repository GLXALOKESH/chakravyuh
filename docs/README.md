# Chakravyuh documentation

Contracts, status and design for the three services. **Start with
[PROJECT_STATUS.md](PROJECT_STATUS.md)** — it records what is true right now.

## Current state

```
server/   Member 1  Express + TypeScript + Mongoose 9    complete, 117 tests
ml/       Member 3  Python pipeline, 17 modules          complete, 33 tests
client/   Member 2  Next.js dashboard                    in progress
docs/     this folder
```

The three work together against a local MongoDB 9.0 replica set or MongoDB Atlas.
`ml/service.py` answers `/taint` and `/mincut` live — responses carry
`"cached": false`, meaning Python is computing rather than serving a stored
default. Everything else is served from the database.

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

## Design and decisions

| Document | What |
| --- | --- |
| **[BACKEND_STATUS.md](BACKEND_STATUS.md)** | Why the server is built the way it is |

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

```bash
# local MongoDB (replica set is required for the seeder's transaction)
brew tap mongodb/brew && brew trust mongodb/brew
brew install mongodb-community@9.0
cd server && nohup mongod --config .mongorc-local &
mongosh --eval 'rs.initiate({_id:"rs0",members:[{_id:0,host:"127.0.0.1:27017"}]})'

# ML
ml/.venv/bin/python ml/service.py          # :8000

# server
cd server && pnpm install && pnpm run db:indexes && pnpm start    # :4000
```

**Do not run `pnpm run seed`.** The ML team pushes directly to the database;
seeding would truncate their collections and load fixtures over the top.

Frontend without a database: `USE_MOCKS=true pnpm start` — identical shapes.