# Test and benchmark reports

Numbered in the order they should be read. Each supersedes the previous on its
own subject — read the newest, not all of them.

| # | Report | What it establishes |
| --- | --- | --- |
| 01 | [Local Mongo setup and benchmark](01-LOCAL-MONGO-SETUP-AND-BENCHMARK.md) | Install method, replica set setup, 1M transactions in 2.45s, Atlas-vs-local matrix, saturation ceilings |
| 02 | [Full-stack test report](02-FULL-STACK-TEST-REPORT.md) | All three services tested together: 33 ML tests, 117 server tests, live Python integration, venv setup, and the paise/rupee unit bug |
| 03 | [Throughput strategy](03-THROUGHPUT-STRATEGY.md) | The 1M-in-30-40s requirement, the three readings of it, and what each costs |
| 04 | [Fund-flow persistence](04-FUND-FLOW-PERSISTENCE.md) | 145 backend tests (130 existing + 15 new), transactional fund-flow storage, two demo seeds and the missing-artifact verification limit |
| 05 | [Backend activity logging](05-BACKEND-LOGGING.md) | 171 backend tests (145 existing + 26 new), correlation and transaction outcomes, JSON/pretty verification and silent-vs-info load comparison |

## Latest backend verification

Report 05 records **171 passed, 15 files, 0 skipped**, plus a clean typecheck.
It verifies correlated HTTP/DB/ML activity, seed outcomes and bounded run
summaries. See its load-test tables for the measured logging comparison.

Report 04 records the previous fund-flow verification:
Fund-flow population, summaries, `truncated`, reseeding and rollback passed with
test artifacts. Two CLI seeds of the real demo profile produced identical counts;
its missing `fund_flows.json` meant both fund-flow collections were empty.

## Earlier full-stack and performance measurements

Measured on Apple M4, 10 cores, 16 GB, MongoDB 9.0.2 local replica set:

```
1M transactions ingested          2.45s          (target was 30–40s)
ingest throughput                 407,498 docs/sec
1M + 3 indexes                     4.21s
API ceiling                       ~6,200 req/s
Mongo read ceiling (1M docs)      ~5,500 ops/sec  at 50-way parallelism
API p50 at 100 req/s              1ms            (was 7,440ms on Atlas)
server tests at that snapshot      117 passed, 0 skipped (latest: 171 in report 05)
ML tests                          33 passed
taint conservation                holds, 0–1 rupee, live and cached
/taint + /freeze                  cached: false  (Python answering live)
```

Atlas free tier, for comparison: **100 operations/sec documented ceiling**,
6,200 req/s of API is unreachable there, and 1M transactions exceed the 512 MB
storage limit before throughput is even relevant.

## Reading order

**If you are new here:** 01 for what the system does now, then
`../PROJECT_STATUS.md` for what is and is not finished.

**If you are preparing a demo:** 02, then `../API_FOR_FRONTEND.md`.

**If you are arguing about scale:** 03, which explains why the target is
reachable locally and not on the free tier.

**If you are integrating fund flows:** 04 for verification, then
[`../ML_INTEGRATION.md` §3.9](../ML_INTEGRATION.md#39-outputsfund_flowsjson--optional-object)
for the schema and storage contract.

**If you are following backend activity:** 05 for verification, then
[`../REALTIME_BACKEND_LOGGING_PLAN.md`](../REALTIME_BACKEND_LOGGING_PLAN.md)
for startup commands and log fields.

## A note on running these

Reports 01 and 02 both assume the ML service is **stopped** for the fallback
tests. `ml-fallback.test.ts`, `pipeline.test.ts` and `freeze-edge.test.ts`
assert the degraded path, which requires Python to be unreachable. Running them
with `ml/service.py` up produces failures that are not defects: the suite seeds
`chakravyuh_test` from the built-in fixtures while a running service loads the
pipeline's own `data/demo`, so the two datasets share ring ids but nothing else.

## Not test reports

These live in `docs/` because they are contracts and status, not measurements:

- `PROJECT_STATUS.md` — what is true right now
- `API_FOR_FRONTEND.md` — endpoint reference for Member 2
- `COMMUNICATION.md` — how frontend and ML talk to the server
- `BACKEND_STATUS.md` — design decisions and why
- `ML_INTEGRATION.md`, `ML_PIPELINE_FLOW.md`, `HOW_DATA_FLOWS.md` — ML contract
- `QUESTIONS_FOR_ML.md` — open questions for Member 3
