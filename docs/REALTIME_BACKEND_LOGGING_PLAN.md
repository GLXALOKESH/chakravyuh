# Real-time backend incoming/outgoing logs — implementation and operation

**Status: implemented and regression-tested, 3 Oct 2026.** Typecheck clean;
**171 tests passing in 15 files** (145 existing + 26 logging checks).
Measured verification: [report 05](tests/05-BACKEND-LOGGING.md).

From `server/`, start the readable local feed:

```bash
LOG_LEVEL=info LOG_FORMAT=pretty LOG_DB_ENABLED=true pnpm run dev
```

Use `LOG_FORMAT=json` for one structured record per stdout line. Use
`LOG_LEVEL=debug` to include health/state polling and individual seed DB
operations. Follow `request_id` through HTTP → DB → Python → response, and
`run_id` for background replay/predictor work. Configuration is in §7.

## 1. What we want to see

Show a readable, live account of what the backend receives, what it calls, what
it sends back, and how long each operation takes. Start with the server terminal
so the team can use it immediately while operating the dashboard.

**Scope assumption:** “incoming/outgoing” means traffic crossing the backend:
HTTP requests/responses, MongoDB operations/results, Python calls, generator
input and Socket.IO output.
Bank-account credits/debits are transaction data and already use the ledger and
stream events; they are not the direction labels in this plan.

The useful questions are:

- Did the dashboard request reach Express?
- Which MongoDB collection did it read or write, how long did that take, and
  how many documents were returned or affected?
- Was an operation slow, rejected before execution, or unsuccessful in MongoDB?
- Which operation did Express send to Python?
- Did Python answer, fail, or time out?
- Did the user receive a live result or a cached fallback?
- Are transactions arriving, being scored and being emitted to the dashboard?
- Did a seed actually commit, and was its fund-flow artifact present?

## 2. Implemented approach

**Pino provides structured logs**, with **pino-pretty for local terminal display**.
Express middleware and existing service/repository boundaries emit the events.
Database operation logging is included.

```text
Dashboard ── request ──► Express ── request ──► Python
Dashboard ◄─ response ── Express ◄─ response ── Python
                           │
                           ├── read/write ──► MongoDB
                           │◄── result/error ───┘
                           │
                  structured log events
                           │
                     live terminal

Generator ── NDJSON ──► StreamService ── batched Socket.IO ──► Dashboard
                           │
                       /predict
                           │
                         Python
```

Every event has the same structure. Pretty mode makes it readable for a person;
JSON mode keeps one record per line for filtering and later tooling. A future
dashboard log viewer can reuse this event format in a separate frontend task.

### Previous baseline

- `src/bin/server.ts`: startup, configuration and shutdown messages.
- `src/middlewares/error.middleware.ts`: request error messages.
- Ring controllers: warnings when taint/freeze falls back to cache.
- `src/services/generator.process.ts`: generator startup errors, malformed-line
  warnings and forwarded stderr.
- `src/bin/seed.ts`: final seed counts.
- Database repositories already contain queries; `bulk.repository.ts` handles
  batched inserts, and `seed.repository.ts` truncates using raw collection calls.

Before this update, there was no central structured logger, correlated request
lifecycle, or consistent visibility into successful outgoing Python calls and
database operations. Those scattered console messages now use the shared logger.

## 3. Minimum useful output

Illustrative shorthand only; the timings and counts below are not measurements.
Actual pretty output includes named JSON metadata after the event name; it does
not use these abbreviated `req`/`op`/`run` columns. JSON uses `request_id`,
`operation_id`, `run_id` and nested `counts`.

```text
14:20:01.000 INFO  IN   http.request   req=a91 GET /api/rings/RING01/taint
14:20:01.001 INFO  OUT  db.operation  req=a91 op=d01 collection=rings operation=findOne
14:20:01.003 INFO  IN   db.result     req=a91 op=d01 returned_count=1 duration_ms=2
14:20:01.004 INFO  OUT  ml.request     req=a91 call=m12 POST /taint ring=RING01
14:20:01.043 INFO  IN   ml.response    req=a91 call=m12 status=200 duration_ms=39
14:20:01.045 INFO  OUT  http.response  req=a91 status=200 duration_ms=45 cached=false

14:20:05.000 INFO  IN   http.request   req=b72 POST /api/rings/RING01/freeze
14:20:05.001 INFO  OUT  db.operation  req=b72 op=d02 collection=rings operation=findOne
14:20:05.002 INFO  IN   db.result     req=b72 op=d02 returned_count=1 duration_ms=1
14:20:05.003 INFO  OUT  ml.request     req=b72 call=m13 POST /mincut
14:20:08.004 WARN SYS  ml.timeout     req=b72 call=m13 timeout_ms=3000
14:20:08.005 WARN SYS  ml.fallback    req=b72 cached=true fallback_source=stored_default
14:20:08.006 INFO  OUT  http.response  req=b72 status=200 duration_ms=3006 cached=true

14:20:10.000 INFO  SYS  stream.summary run=run-42 received_txns=120 emitted_txns=115
14:20:10.003 INFO  OUT  ml.request     run=run-42 seq=8 call=m14 POST /predict txns=120
14:20:10.048 INFO  IN   ml.response    run=run-42 seq=8 call=m14 status=200 duration_ms=45 scores=18 rings=1 alerts=1

14:20:15.000 INFO  OUT  db.operation  req=c34 op=d03 collection=transactions operation=find
14:20:15.340 WARN IN   db.result     req=c34 op=d03 returned_count=50 duration_ms=340 slow=true
14:20:16.000 INFO  OUT  db.operation  seed=s01 op=d04 collection=fund_flow_paths operation=insertMany attempted_count=1000 transaction_id=t01 attempt=1
14:20:16.040 INFO  IN   db.result     seed=s01 op=d04 inserted_count=1000 duration_ms=40 commit_state=pending
```

The freeze example is important: the Python call failed, but the API successfully
returned its fallback. Those are separate outcomes and should be visible together.

Generator input and dashboard output counts can differ: salary credits feed the
predictor but are filtered from the main dashboard transaction stream. Queueing
and different reporting windows also affect counts; do not label every mismatch
as data loss.

## 4. Event format and correlation

| Field | Meaning |
| --- | --- |
| `time`, `level`, `service` | UTC timestamp, severity, and `chakravyuh-server` |
| `event`, `msg` | Stable machine-readable event name, also used as the display message |
| `direction` | `in`, `out`, or `internal`, always relative to Express |
| `peer` | `client`, `ml`, `generator`, or `mongodb`, when applicable |
| `request_id` | One server-generated id for an incoming HTTP request |
| `call_id` | One id for each outgoing Python request attempt |
| `operation_id` | One id for a database operation, paired across start/result/error |
| `database`, `collection`, `operation` | Safe database name, collection name and operation such as `find`, `countDocuments`, `insertMany`, `deleteMany` or `findOneAndUpdate` |
| `transaction_id`, `commit_state` | Application-generated transaction id; a write inside a transaction remains pending until commit |
| `run_id`, `seq` | Existing live-run and predictor-batch identifiers |
| `seed_id`, `attempt` | Seed correlation and transaction/retry attempt, where relevant |
| `method`, `path`, `status_code` | HTTP details; omit query strings from the path |
| `duration_ms`, `timeout_ms` | Measured elapsed time and configured deadline |
| `cached`, `fallback_source` | Whether a fallback was served and where it came from |
| `counts`, `error_code` | Small operation-specific summaries and failure classification |
| `returned_count`, `count_value`, `attempted_count` | Documents returned, a count-query result, or documents submitted; these are different measurements |
| `matched_count`, `modified_count`, `deleted_count`, `inserted_count`, `upserted_count` | Actual write result counts, only when exposed by the operation result |
| `slow`, `stage` | Whether a DB operation exceeded the configured threshold; failure stage such as validation, execution or commit |

Use `crypto.randomUUID()` for request/call/seed/operation/transaction ids. Keep request context in
`AsyncLocalStorage` so concurrent requests retain their own ids through async
service calls. The initial implementation keeps these ids internal to logs and
does not require response-header or public contract changes.

Background replay/live work should use its own run context rather than inheriting
the id of the HTTP request that originally started it. Python requests initiated
by a user retain `request_id`; background predictor batches use `run_id` and `seq`.
Each retry gets a new `call_id`, even when it resends the same batch sequence.

## 5. Where to instrument

### A. Incoming HTTP requests and outgoing responses — first priority

Add request logging in `src/app.ts` **before CORS and `express.json()`**, so
preflight, malformed JSON and oversized-body requests are observable too.

1. Create the request context and emit `http.request` immediately.
2. Capture a monotonic start time for accurate elapsed duration.
3. On response `finish`, emit exactly one `http.response` with final status,
   duration and content type. This means Express finished writing the response;
   it does not prove the browser processed it.
4. On premature `close`, emit `http.aborted` only if the response did not finish.
   Guard against recording a normal close as a second completion.
5. Attach the matched route template when it is available at completion. Keep a
   bounded, query-free path for unmatched routes.

Use the existing error middleware to attach sanitised error details to the
request context. Keep its error response behavior intact. Avoid logging the same
stack trace both there and in the completion logger.

Do not wrap or replace `res.json()`/`res.send()` to capture full responses. PDF
and binary responses should be logged through lifecycle metadata like JSON ones.

### B. Outgoing Python calls and incoming results — first priority

Instrument `src/services/ml.service.ts` and
`src/services/predictor.client.ts`:

- `ml.request`: method, route, ids, configured timeout, safe input counts.
- `ml.response`: status, duration including body parsing, safe result counts.
- `ml.timeout`, `ml.unreachable`, `ml.http_error`, `ml.invalid_response`:
  distinguish deadline, connection, HTTP-status and decoding failures.
- `ml.fallback`: log at the point the ML client chooses a stored/default result.
  Distinguish `stored_default`, `live_cache`, and `empty` fallback sources.

Keep existing deadlines: `ML_TIMEOUT_MS` for the ordinary client and
`STREAM_PREDICT_TIMEOUT_MS` for prediction batches. Logging must not introduce
extra ML requests, retries or alter fallback decisions.

Record predictor `409` as a resynchronisation trigger and `503` as model
unavailability. Log `applied: false` when a retried sequence returns its cached
answer; this is successful retry handling, not a new application of the batch.

Replace existing controller fallback warnings with this central event once it
covers the same cases, avoiding duplicate messages. Carry `cached` metadata back
to the HTTP log through request context, without changing the response shape.

### C. Socket.IO, replay and live streaming — second priority

Use the existing Socket.IO handlers and injected engine emit callbacks in
`src/bin/server.ts`, plus lifecycle points in the stream/replay services:

- Log client connection/disconnection and incoming start/stop/clear commands.
- Log actual run start/end, generator start/exit/failure and predictor status
  transitions (`starting`, `ok`, `lagging`, `down`).
- Log retry backoff and predictor reset/resynchronisation decisions.
- Aggregate high-volume transaction, score and clock events into one summary
  per active run per second. Flush a final summary on stop/end.
- Log ring discoveries and alerts individually with ids and small counts.

Track emitted events as **emitted**, not delivered or acknowledged. Socket.IO
emit calls do not establish that a browser received or rendered the payload.
Keep generator stdout as the NDJSON data channel; observe its lifecycle and
counts from Node rather than changing Python's output.

### D. Database operations and connection lifecycle — first priority

Add a shared `withDbLog(metadata, execute)` helper and use it around the existing
awaited database calls. The callback executes **once** and returns the original
result or rethrows the original error. Pass the current MongoDB session through
unchanged. Logging must not rerun queries or change their filters, projections,
ordering, pagination, write options or result shape.

#### Operation events

| Event | Direction | Record |
| --- | --- | --- |
| `db.operation` | OUT | Request/seed context, operation id, collection, operation name, safe query shape or attempted batch size |
| `db.result` | IN | Same ids, duration, outcome and available result counts; `slow: true` at warn level above the threshold |
| `db.error` | SYS | Same ids, duration, stage and sanitised error code/name; raw messages omitted |
| `db.batch.summary` | SYS | Aggregate progress of seed batches, with attempted and known successful counts kept separate |

`db.operation` marks the start of a logical application operation, not proof that
a wire command was sent. Measure its awaited execution with a monotonic clock.
This duration can include Mongoose casting/buffering, connection selection,
network time, server execution and result processing. Label it application-side
duration rather than claiming it is MongoDB's server-only execution time.

For a `findOne` result, report `returned_count: 0` or `1`; an absent record is a
successful DB operation, even if the controller subsequently returns HTTP 404.
For `countDocuments`, use `count_value`. For writes, use counts from the actual
result; do not infer inserted count from input length. Partial bulk errors,
duplicate-key handling and unavailable counts must remain distinguishable.

#### Coverage in the current architecture

- Wrap query execution in **all existing repositories**, including account,
  ring, identifier, transaction, alert, recruit, metric and fund-flow operations.
- Instrument inserts once in `bulk.repository.ts`, where batches are executed;
  avoid duplicating the same insert event in each calling repository.
- Explicitly instrument `model.collection.deleteMany()` in
  `seed.repository.ts`. These raw collection calls would bypass a plan based
  only on Mongoose query middleware.
- Cover summary/metric/seed-metadata upserts and the `createIndexes()` calls in
  `ensureIndexes()`. Index creation is a distinct operation, not a document write.
- Record validation failures that occur before a DB call with
  `stage: "validation"`; do not report a fabricated MongoDB response.
- Propagate HTTP `request_id` or seed/transaction context through the helper.
  Parallel repository reads get distinct operation ids under the same request.

This observes operations issued by the Node backend. ML's separate direct DB
push and MongoDB's own internal operations are not captured by Node repository
instrumentation. Live-stream data currently lives in memory, so ordinary live
ingestion must not generate fictitious database writes in the log.

Use this helper as the primary database logging mechanism. Mongoose debug output
alone lacks the complete result/timing lifecycle and raw-call coverage required
here. Driver command monitoring can be a later diagnostic addition if needed;
the initial implementation does not enable full command dumps or DB profiling.

#### Connection events

In `configs/mongoose.ts`, log `db.connecting`, `db.connected`,
`db.reconnected`, `db.disconnected` and `db.connection_error` from actual
connection transitions. Distinguish expected shutdown from unexpected loss.
Attach listeners once per connection and clean them up where necessary so
tests, reloads and repeated `connect()` calls do not duplicate events.

Use the active connection's safe host/database description, including when tests
pass an override URL. Never log the full connection URI or credentials. A
connection error does not itself prove that every in-flight operation failed;
each operation records its own outcome.

### E. Seed transactions and batched writes

In `seed.service.ts` and the existing transaction wrapper, emit:

```text
seed.started
seed.profile_loaded       source, profile, fund_flows_present, input counts
seed.transaction_started  seed_id, transaction_id, attempt
db.batch.summary          collection, batches_completed, attempted_count, known result counts
seed.transaction_committed
seed.completed            duration, verified counts, summary.truncated if present
seed.failed               stage, error_code, transaction outcome
```

MongoDB may retry a transaction callback. Label attempt logs accordingly and
emit commit success only after `withTransaction()` resolves. Keep the same
logical transaction id across callback attempts. A successful insert within a
transaction means `commit_state: "pending"`, not durable persistence. A failed
transaction records a rollback only when known; an indeterminate commit outcome
is labelled unknown. Logging adds no retries of its own. `setLastSeed()`
runs after commit: failure there must be identified as a metadata failure after
commit, not described as a rollback of already committed domain data.

Fund-flow logs should distinguish missing artifact, empty paths, and populated
paths. Label file counts as input counts; any persisted counts reported as
verified must be read after commit. Do not change `SeedResult` or public API
payloads merely to expose logging metadata.

## 6. Readability and data volume

- `info`: normal API and DB operation lifecycle, ordinary ML calls, connection
  transitions, run transitions and seed results.
- `warn`: slow DB operations, unexpected DB disconnection, fallback, timeout,
  retry/resync, rejected input and client aborts.
- `error`: unexpected server failures, database failures and failed seed stages.
- `debug`: successful health checks, preflight, frequent state polling and
  finer-grained diagnostics. Failures on these routes must still be visible.

Use explicit fields rather than serialising entire requests, responses, accounts
or transaction arrays. In particular, omit authorization/cookie values, ingest
tokens, connection-string credentials, ground-truth labels and `graph_png`.
Omit raw error messages and stacks; bound allowed text fields. Generator stderr
and malformed lines are observed by byte count only, without their raw text.

Database query descriptions should contain field names and bounded options such
as projection/sort keys, limit and skip, rather than filter values, update
documents or returned records. Bulk-error objects can contain the rejected
document: serialise a safe error summary instead of the raw object.

For normal API reads/writes, info shows operation start and completion. All
operations under a seed context are debug-level, with info batch progress
aggregated once per second per collection and a final summary. Slow operations and failures remain visible at
warn/error. Do not sample away failures or run extra count/explain queries on
the request path just to fill log fields.

Use aggregate counters for high-volume paths, not one line per transaction or
clock tick. Do not persist diagnostic events into MongoDB or await log writes
inside request, replay or seed transaction work. Use a bounded shutdown flush
so final lifecycle events are not immediately lost to `process.exit()`.

## 7. Files, dependencies and configuration

All runtime implementation is under `server/`.

| File | Responsibility |
| --- | --- |
| `src/services/logger.service.ts` — new | Pino instance, safe structured metadata, injected log destination, bounded shutdown flush |
| `src/utilities/log-context.util.ts` — new | Async request/run/seed context and correlation ids |
| `src/utilities/db-log.util.ts` — new | Execute-once DB logging wrapper, timing, safe result/error summaries and slow-operation classification |
| `src/utilities/ml-log.util.ts` — new | One-attempt Python boundary logging and failure classification |
| `src/services/activity-log.service.ts` — new | Per-run counter summaries driven by existing engine ticks |
| `src/middlewares/request-log.middleware.ts` — new | HTTP start, completion and abort logging |
| `src/configs/env.ts`, `.env.example` | Document and parse logging settings |
| `src/app.ts`, `src/middlewares/error.middleware.ts` | Install request logging and attach error context |
| `src/services/ml.service.ts`, `src/services/predictor.client.ts` | Python boundary events and fallback metadata |
| `src/bin/server.ts`, replay/stream/generator services | Socket and engine lifecycle, aggregate summaries, shutdown flush |
| `src/repositories/*.repository.ts` | Wrap existing read/write execution; cover shared bulk inserts, raw collection deletes and upserts without double logging |
| `src/configs/mongoose.ts`, `src/services/seed.service.ts`, `src/bin/seed.ts` | Connection/index events, transaction attempts, commit outcomes and seed-stage events |
| Existing ring/live controllers | Replace duplicate fallback console warnings after central logging is present |
| `test/logging.test.ts` — new | Captured-log assertions with fake sinks/clients |
| `test/db-logging.test.ts` — new | DB result/error counts, operation correlation, slow timing and replica-set transaction logging |
| `test/logging.helpers.ts` — new | Isolated captured JSON log destination |

Installed dependencies: `pino` 10.3.1 (runtime), `pino-pretty` 13.1.3
(development). Installation used:

```bash
pnpm add pino
pnpm add -D pino-pretty
```

Supported configuration:

| Variable | Default | Purpose |
| --- | --- | --- |
| `LOG_LEVEL` | `info`; `silent` when `NODE_ENV=test` | `debug`, `info`, `warn`, `error`, or `silent` |
| `LOG_FORMAT` | `json` | `pretty` for a local terminal; JSON for machine consumption |
| `LOG_STREAM_INTERVAL_MS` | `1000` | Minimum summary interval, driven by existing ticks/batches; clamped to at least 100ms |
| `LOG_DB_ENABLED` | `true` | Emit DB diagnostics; disabling it never disables database operations |
| `LOG_DB_SLOW_MS` | `200` | Application-side slow-operation threshold; clamped to at least 0ms |

A readable local feed starts with:

```bash
LOG_LEVEL=info LOG_FORMAT=pretty LOG_DB_ENABLED=true pnpm run dev
```

Pretty mode requires the development dependency. Production installs use JSON
stdout. Run the server directly for an unprefixed JSON feed; combined stack
launchers may prefix individual services' lines.

The code defaults to JSON; `.env.example` sets `LOG_FORMAT=pretty` for local
development. `LOG_DB_ENABLED=false` suppresses DB diagnostics, while HTTP, ML,
seed and run events remain available. `LOG_LEVEL=silent` suppresses all events.

## 8. Completed rollout

1. **Foundation:** shared Pino logger, configuration, correlation context, HTTP
   middleware and the execute-once database logging helper.
2. **First delivery: HTTP + DB + Python.** Instrument repository reads/writes,
   connection events and both ML clients. Show request → DB operations → Python
   (when used) → response, with timings, failures and fallback decisions.
3. **Seed transactions:** add batch progress, index creation, transaction attempts,
   commit/rollback/unknown outcomes and optional fund-flow ingestion summaries.
4. **Live-run visibility:** add socket lifecycle, predictor transitions,
   run correlation and per-second transaction/score summaries.

All four stages are implemented. Seed metadata still runs after the domain
transaction commits; logging identifies that boundary explicitly.

Preserve the existing public API, socket payloads, ML behavior and seed
transaction semantics throughout. This plan requires no ML code changes.

## 9. Verification and completion criteria

Use an injected/captured log destination rather than assertions on terminal
colours or entire formatted strings.

- A normal request emits start and exactly one completion with a shared id.
- Concurrent requests and their Python calls keep distinct correlation ids.
- DB operations share the correct HTTP or seed context; parallel reads have
  distinct operation ids. Each execution has one result/error event.
- The DB wrapper invokes its callback once, preserves results and errors, and
  passes the original session. Zero-result reads remain successful DB operations.
- Operation timing and slow thresholds work for reads and writes. Returned,
  counted, attempted and affected document counts are not conflated.
- Raw collection deletes, summary upserts and bulk inserts are covered without
  double logging. Partial/duplicate bulk failures never claim full insertion.
- Disabling DB diagnostics changes only logs. Reconnecting does not accumulate
  listeners, and logs identify the active test/override database correctly.
- Validation, malformed JSON, oversized bodies and unknown routes retain their
  current HTTP behavior and produce the expected completion logs.
- Premature disconnect produces one abort log; normal close does not duplicate
  completion.
- ML timeout/unreachable/non-2xx responses are distinguishable; a cached HTTP
  200 is recorded as successful fallback, not an HTTP 500.
- Predictor retries, `409` resync and `applied: false` are visible without adding
  requests or changing sequence handling.
- A large transaction batch produces bounded summary output and unchanged
  socket events. Stop/restart leaves no logging timers behind.
- Logs omit credential values, raw payloads, ground truth and PNG contents.
- Failed seed transactions never log commit success; post-commit metadata
  failure is distinguishable. Missing and empty fund-flow artifacts are distinct.
- Successful writes inside a transaction stay pending until commit; retry
  attempts, confirmed rollback and unknown commit results are distinguishable.
- Database filter values, write payloads, returned documents and bulk-error
  document contents are absent from the output.

`pnpm run typecheck` and the full suite pass: **171 checks, 15 files, 0 skipped**.
The 26 new checks capture structured JSON rather than terminal formatting.
Existing stream/replay tests continue to check batch sequencing and socket
behavior. The existing load test was also run with silent versus info logging
against isolated fixtures; see [report 05](tests/05-BACKEND-LOGGING.md) for the
measurements and their limits. Pretty output was smoke-tested separately.

**Done means:** while clicking through the dashboard, someone can follow one
request from arrival through its MongoDB operations and any Python calls to the
response, see which collection was queried or written and its outcome/timing,
identify live versus cached results, and see whether a live run is receiving,
scoring and emitting data.
