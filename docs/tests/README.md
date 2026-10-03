# Test and benchmark reports

Numbered in the order they should be read. Each supersedes the previous on its
own subject — read the newest, not all of them.

| # | Report | What it establishes |
| --- | --- | --- |
| 01 | [Local Mongo setup and benchmark](01-LOCAL-MONGO-SETUP-AND-BENCHMARK.md) | Install method, replica set setup, 1M transactions in 2.45s, Atlas-vs-local matrix, saturation ceilings |
| 02 | [Full-stack test report](02-FULL-STACK-TEST-REPORT.md) | All three services tested together for the first time: 25 ML tests, 114 server tests, live Python integration, venv setup |
| 03 | [Throughput strategy](03-THROUGHPUT-STRATEGY.md) | The 1M-in-30-40s requirement, the three readings of it, and what each costs |

## Current numbers

Measured on Apple M4, 10 cores, 16 GB, MongoDB 9.0.2 local replica set:

```
1M transactions ingested          2.45s          (target was 30–40s)
ingest throughput                 407,498 docs/sec
1M + 3 indexes                     4.21s
API ceiling                       ~6,200 req/s
Mongo read ceiling (1M docs)      ~5,500 ops/sec  at 50-way parallelism
API p50 at 100 req/s              1ms            (was 7,440ms on Atlas)
server tests                      114 passed, 0 skipped
ML tests                          25 passed
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

## A note on running these

Reports 01 and 02 both assume the ML service is **stopped** for the fallback
tests. `ml-fallback.test.ts` and `pipeline.test.ts` assert the degraded path,
which requires Python to be unreachable. Running them with `ml/service.py` up
produces 15 failures that are not defects.

## Not test reports

These live in `docs/` because they are contracts and status, not measurements:

- `PROJECT_STATUS.md` — what is true right now
- `API_FOR_FRONTEND.md` — endpoint reference for Member 2
- `COMMUNICATION.md` — how frontend and ML talk to the server
- `BACKEND_STATUS.md` — design decisions and why
- `ML_INTEGRATION.md`, `ML_PIPELINE_FLOW.md`, `HOW_DATA_FLOWS.md` — ML contract
- `QUESTIONS_FOR_ML.md` — open questions for Member 3