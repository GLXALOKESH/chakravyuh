# 05 — Backend activity logging verification

**Measured 3 Oct 2026.** This report covers the Pino logging implementation in
`server/`. Configuration and event semantics are in the
[logging guide](../REALTIME_BACKEND_LOGGING_PLAN.md).

## Result

- Typecheck clean.
- **171 tests passed in 15 files; 0 failed, 0 skipped.**
- **26 new logging checks**, plus all 145 existing regression checks.
- Pretty-mode smoke test printed the expected event and metadata.
- Both info-level load runs produced valid newline-delimited JSON exclusively.
- Every measured load-test request returned HTTP 200. One initial phase had a
  latency/throughput anomaly; it did not recur in the reverse-order comparison.

The full suite completed in **13.01s**, then printed the existing Vitest teardown
warning: `close timed out after 10000ms` and two Vite servers preventing exit.
The command exited successfully. The warning was also present before this
logging update; its cause was not investigated in this change.

## Regression command

From `server/`:

```bash
pnpm run typecheck
LOG_LEVEL=silent LOG_FORMAT=json MONGO_URL=placeholder TEST_MONGO_URL= ML_URL=http://127.0.0.1:1 pnpm test
```

This creates an isolated temporary single-node MongoDB replica set. The explicit
unreachable ML URL selects the fallback behavior expected by the existing suite.
Logging tests inject their own debug-level JSON capture sink even when the
process logger is silent.

### New coverage

| Suite | Checks | Coverage |
| --- | --- | --- |
| `logging.test.ts` | 13 | Concurrent request/DB/ML correlation; exactly-once HTTP completion; parser errors, 404 and preflight; aborts; timeout and HTTP 200 fallback; live-cache source; ML failure categories; distinct retry call ids and `applied: false`; predictor timeout causes; bounded safe metadata; aggregate run counters; detached context |
| `db-logging.test.ts` | 13 | Real query result/count semantics; execute-once result/error preservation; slow threshold; DB logging disabled; parallel reads; raw collection truncation/rollback; seed commit and metadata context; post-commit metadata failure; driver callback retries; unknown commit outcomes; partial/duplicate batches; local validation/session preservation; connection listener reuse |

The callback-retry test uses a real replica-set transaction and a driver-labeled
transient error. The unknown-commit test injects the driver's final rejection;
it verifies classification without claiming to reproduce an actual network
partition. Existing fund-flow, seed, stream and replay tests cover their domain
behavior alongside these logging assertions.

## Output checks

Pretty output was exercised with:

```bash
LOG_LEVEL=info LOG_FORMAT=pretty pnpm exec tsx -e "import('./src/services/logger.service.ts').then(async ({ logEvent, flushLogs }) => { logEvent('info', 'logging.smoke', { direction: 'in', method: 'GET', path: '/health' }); await flushLogs(); })"
```

It printed an `INFO: logging.smoke` line with `direction`, `method`, `path` and
`event` metadata. Captured-log tests assert JSON fields, rather than depending
on pretty formatting or terminal colors.

Raw bodies/documents, authorization/cookies, query values, filter values,
ground truth, graph PNGs, rejected bulk documents and error messages are omitted.
Generator stderr/malformed lines are observed by byte count. Result counts and
timings remain available as safe structured fields.

## Silent versus info load comparison

### Method

A disposable verification harness created a temporary MongoDB replica set and
seeded deterministic fixtures directly through the seed service, exclusively
into `chakravyuh_logging_verify`:

```text
600 accounts · 35 identifiers · 4,972 transactions · 3 rings · 3 alerts
```

For each mode it started a fresh Node API process on an ephemeral localhost
port, loaded the replay script, and ran the existing unmodified
`src/bin/loadtest.ts` against that port:

```bash
LOADTEST_BASE=http://127.0.0.1:<ephemeral-port> pnpm exec tsx src/bin/loadtest.ts
```

The API had `LOG_FORMAT=json`, `LOG_DB_ENABLED=true`, real repositories,
`USE_MOCKS=false`, `STREAM_ONLY=false`, and `ML_URL=http://127.0.0.1:1`.
Its stdout was continuously drained, counted and JSON-parsed by the harness.
No logs were persisted to MongoDB. The temporary processes, database and harness
were removed afterward.

The first pair ran **silent → info**. Because one phase showed an anomaly,
a second pair ran **info → silent** on a fresh isolated fixture database.
Each run used the load tool's existing randomized dashboard route weights,
warmup, phase durations, and inter-phase pauses.

### First pair

Latencies are milliseconds, rounded by the existing load tool.

| Phase | Requests per mode | Silent req/s | Info req/s | Silent p50 / p95 / p99 | Info p50 / p95 / p99 |
| --- | ---: | ---: | ---: | --- | --- |
| Baseline, target 20/s | 300 | 20.1 | 20.1 | 6 / 9 / 11 | 7 / 9 / 10 |
| Load, target 50/s | 1,000 | 50.0 | **39.2** | 4 / 7 / 8 | **5 / 202 / 219** |
| Stress, target 100/s | 2,000 | 100.0 | 100.0 | 3 / 6 / 7 | 3 / 6 / 7 |
| Spike, target 200/s | 2,000 | 200.0 | 200.1 | 2 / 5 / 6 | 2 / 5 / 6 |
| Recovery, target 10/s | 50 | 10.2 | 10.2 | 6 / 8 / 8 | 6 / 8 / 8 |

The info load phase took about 26s instead of 20s, with a 233ms maximum
request latency. Its cause is unestablished; it is retained here rather than
discarded or attributed to system noise without evidence.

### Reverse-order pair

| Phase | Requests per mode | Silent req/s | Info req/s | Silent p50 / p95 / p99 | Info p50 / p95 / p99 |
| --- | ---: | ---: | ---: | --- | --- |
| Baseline, target 20/s | 300 | 20.1 | 20.1 | 7 / 9 / 13 | 7 / 9 / 10 |
| Load, target 50/s | 1,000 | 50.0 | 50.0 | 4 / 7 / 7 | 5 / 7 / 8 |
| Stress, target 100/s | 2,000 | 100.0 | 100.0 | 3 / 6 / 7 | 3 / 5 / 6 |
| Spike, target 200/s | 2,000 | 200.1 | 200.1 | 2 / 4 / 6 | 2 / 5 / 6 |
| Recovery, target 10/s | 50 | 10.2 | 10.2 | 5 / 7 / 12 | 6 / 6 / 7 |

Every phase in every run had **zero failed requests**. Each run measured 5,350
requests, plus ten warmup requests. All four runs reported normal recovery.

### Output volume

| Run | Info log bytes | Info log lines | Invalid JSON lines |
| --- | ---: | ---: | ---: |
| First pair | 15,174,485 | 34,090 | 0 |
| Reverse-order pair | 15,123,185 | 34,030 | 0 |

Both silent runs emitted zero bytes. The totals include API setup/shutdown and
warmup; randomized route selection changes the number of DB operations and
fallback events, so line totals need not be identical.

### Interpretation and limits

The repeat sustained the configured 20/50/100/200 req/s rates with info logging,
and its p95 values were within 1ms of silent. This supports the tested local
dashboard workload; it does **not** establish zero overhead, a saturation
ceiling, or the cause of the first phase's slowdown.

This comparison used JSON stdout with a draining consumer, a small fixture
database, and an unreachable Python endpoint. Pretty-terminal throughput, a slow
log consumer, Atlas, million-row ingestion and real model inference were not
measured. The separate counter test verifies that 10,000 stream transactions
aggregate into a summary rather than one log line each.

## Current limitations

- Node instrumentation observes Node-issued database operations. Independent ML
  direct-to-MongoDB pushes are outside this feed.
- Live-stream storage remains in-memory; its logs describe received/scored/emitted
  activity. Socket emission is not proof of browser delivery.
- The earlier real demo `fund_flows.json` verification remains pending; logging
  verification does not supply the missing ML artifact.
