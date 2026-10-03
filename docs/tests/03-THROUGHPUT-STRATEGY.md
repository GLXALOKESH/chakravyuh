# Throughput strategy — 1M transactions in 30–40 seconds

**Written 3 Oct 2026. Research and measurement only. No code changed.**

The target is **1,000,000 transactions in 30–40 seconds**, i.e. **25,000–33,000
transactions per second**. Measured and documented limits say this is not
achievable on an Atlas free cluster for *ingest*, but it is comfortably
achievable for *replay* and *reads*. The engineering differs by two orders of
magnitude between those, so this document separates them first.

**Corrected 3 Oct 2026:** the target was originally stated as 10 seconds
(100K/sec). At 30–40 seconds the number is a third of that, which moves the
ingest case from "three orders of magnitude short" to "a paid tier genuinely
delivers this."

---

## Finding 1: the free tier has a hard documented ceiling

MongoDB documents it plainly:

| Limit | Free cluster (M0) |
| --- | --- |
| **Throughput** | **100 operations per second** (reads + writes combined) |
| Connections | 500 |
| Storage | 512 MB |
| Data transfer | 10 GB in / 10 GB out per rolling 7 days |
| Compute | **Shared vCPU** |

When you exceed the ops/sec limit, Atlas does three things: throttles the network
speed of the cluster, triggers a one-second cooldown per connection, and makes
operations wait in a queue of more than a second.

**This is not a soft limit and there is no setting to raise it.**

### It explains our measurements exactly

```
achieved    67.8 req/s   (spike phase, target 200)
Atlas RTT   90ms median, 965ms max
Node CPU    0.1%
```

The load test hit ~68 req/s and no higher. That is the free tier throttling, not
our code. Node sat at 0.1% CPU the whole time — the application was idle,
waiting on a queue that Atlas was deliberately not draining faster.

Everything I attributed to "Atlas is slow" was Atlas *enforcing a rate limit*.

### The gap

```
Target              25,000 – 33,000 txn/sec
Free tier ceiling           100 txn/sec
─────────────────────────────────────────────────
Shortfall                250×  to  330×
```

**Against dedicated hardware the picture inverts.** Published MongoDB benchmarks
put single-node write throughput at 10,000–70,000 inserts/sec, with ~102K
writes/sec as a reported ceiling on good hardware. So 25–33K/sec is **within
reach of a real machine** — roughly a quarter to a third of the reported
ceiling. That is the difference between the 10-second and 30–40-second targets:
the original 100K/sec was at the hardware ceiling and would have been
benchmarking the database. 33K/sec is a target real infrastructure meets.

---

## Finding 2: storage fails too, before throughput even matters

1M transaction documents at ~140 bytes (measured on our real data):

```
documents     1,000,000 × 140 B  ≈  140 MB
indexes       3 on transactions, ~430 B/doc  ≈  430 MB
                                  ─────────
total                              ≈  570 MB    >  512 MB limit
```

**1M transactions does not fit in a free cluster even at rest**, indexes included.
500K would fit at roughly 285 MB. So the target range has an upper bound around
600–700K documents on free tier, and that assumes zero other collections.

The ML team's current dataset is 8,041 transactions at 1.07 MB. The target is
**124× larger**.

---

## Finding 3: three different questions hide inside "500K in 10 sec"

This is the important part. The phrase means three things with wildly different
answers, and the engineering effort differs by two orders of magnitude.

### Reading A — Ingest: write 1M transactions into the database in 30–40 seconds

**Not achievable on free tier. Achievable on a paid tier, without much headroom.**
Blocked twice over on M0: the 100 ops/sec documented ceiling, and the 512 MB
storage limit.

Published benchmark figures for MongoDB on dedicated hardware are 10,000–70,000
inserts/sec single-node, with ~102K writes/sec as a reported ceiling on good
hardware. Parallel `bulkWrite` measures 5.7–6.2× faster than sequential
`insertOne`.

So 25–33K/sec sits at roughly **25–33% of the single-node hardware ceiling**.
Demanding, but a real machine meets it — unlike the original 100K/sec target,
which was at the ceiling itself and would have been measuring the database.

Cost to close this gap properly: dedicated Atlas cluster (M30+ for dedicated
vCPU, M50+ for serious throughput), sharded for write parallelism, plus a bulk
loader. That is real money — see §Cost below.

### Reading B — Replay: emit 1M transactions to the dashboard in 30–40 seconds

**This is very likely what you actually mean, and it is achievable comfortably.**

This is not a database problem. The replay engine already loads every transaction
into memory at startup. Emitting 1M in-memory events at 33K/sec is a
serialisation and socket problem, not an ops/sec problem.

What makes it achievable is **batching**. Socket.IO delivering 33,000 discrete
events per second to one browser tab will not work — no frontend can render that,
and the frames coalesce into a visible stall. Emitting batches of 50–100
transactions per frame instead gives 330–660 frames/sec, comfortable with
headroom at the 40-second end of the range.

**But be honest about what this demonstrates.** Streaming 1M synthetic
transactions at the dashboard at 33K/sec is a throughput number, not a fraud
detection result. On screen it reads as a blur. The demo value of replay is
showing a ring *emerge* over time — which is the opposite of speed. TRD §8's
default is 60× real time, which takes 7 days of data to ~10 minutes precisely
because you want to watch it happen.

If 1M-in-30s is a requirement, it should be a load test in the report, not the
demo behaviour. Both can be true: demonstrate the throughput number, then run
the replay at a speed that is legible.

### Reading C — Query: serve a dashboard that is backed by 1M transactions

**Achievable on free tier, and this is the one that matters for a real dataset.**

Serving reads against 1M documents is not throughput-limited the way ingest is,
provided the queries are indexed. We already have `ts/_id`, `from/ts` and
`to/ts` on `transactions`. A paginated query against 1M documents returns the
same latency as against 8,041.

This is the reading where 1M transactions is genuinely useful: it makes the
fraud ring harder to find, which is the actual product claim. Our current 8,041
transactions with 3 planted rings is a small haystack.

**This is the reading I would build to.**

---

## Recommendation: build for C, prove A with a number, demo B slowly

| Reading | Target | Free tier | Action |
| --- | --- | --- | --- |
| **A** Ingest 1M in 30–40s | 25–33K/sec | ❌ 250–330× short | Needs a paid tier. Honest benchmark on M30 |
| **B** Replay 1M in 30–40s | 25–33K events/sec | ✅ comfortable in memory | Batch socket frames; demo at legible speed |
| **C** Query 1M documents | reads | ✅ achievable with indexes | **This is the real goal** |

Most of the value is in C. B is a presentation decision. A is a money problem.

---

## Optimisations worth doing regardless

These help on any tier and cost little. Ordered by value.

### 1. Cache the ring list — removes the hottest route from the network

`/api/rings` is 3 documents and changes only when ML re-pushes. A 30-second TTL
cache means the most-hit endpoint never touches the network.

Expected: `/api/rings` drops from ~90ms to <1ms, and it is the most requested
route in the dashboard.

### 2. `estimatedDocumentCount` instead of `countDocuments` on `/api/transactions`

Measured on our live data:

```
countDocuments (full scan)          1047ms cold, 83ms warm
estimatedDocumentCount (metadata)     73ms
```

`countDocuments` scans. `estimatedDocumentCount` reads collection metadata. On a
1M-document collection the gap becomes 100× worse for the scan version. The
pagination total does not need to be exact to the document.

### 3. Composite endpoint for first paint

The dashboard currently makes roughly six calls to render one screen. One
combined `/api/dashboard` returning ring list + selected ring + alerts would cut
network round trips 6×, and on a 90ms-RTT link that is the difference between
~540ms and ~90ms of first paint.

**This is the highest leverage change on a network-bound system.**

### 4. Projection discipline

Every read already names its columns rather than reading whole documents, and
`is_fraud` is excluded everywhere. At 1M scale this matters more — returning
`features` (17 fields) on an account you will not display is pure waste.

### 5. Batched replay frames

Covered in Reading B. Batch of 50–100 per frame → 330–660 frames/sec for
25–33K transactions/sec.

### 6. `writeConcern: 0` for the ML bulk push only

If ML ever needs to load a large dataset, `w: 0` skips the acknowledgement round
trip and is meaningfully faster. **Only for the load, never for the demo** — you
want durability on anything the demo reads.

---

## Phased plan

### Phase 0 — free tier, this week

| | Change | Expected |
| --- | --- | --- |
| 0.1 | TTL cache on `/api/rings` | hottest route <1ms |
| 0.2 | `estimatedDocumentCount` on pagination | 1047ms → 73ms cold |
| 0.3 | Composite first-paint endpoint | ~540ms → ~90ms |
| 0.4 | Cache `/api/alerts` and `/api/metrics` — both single documents | near-zero |

Target: comfortable 100+ req/s for the demo, and a documented ceiling instead of
a mysterious wall at 68.

### Phase 1 — prove the read path at 1M, still free tier

Ask ML to generate a 1M-transaction `train` profile. It does not have to be
pushed to Atlas — a **local replica set** can hold it, because this phase only
measures queries, and reads are not ops/sec-bound the way writes are.

- Local `mongod --replSet rs0` with ~2 GB of disk
- Push 1M transactions, measure `/api/rings/:id`, `/api/accounts/:id`,
  `/api/transactions` p50/p95/p99
- Confirm query plans use indexes (`explain("executionStats")`)

**This is the phase that answers whether the product scales**, and it needs no
spend.

### Phase 2 — replay at scale, free tier

Load the 1M dataset into the replay engine's in-memory script and emit it in
batches. Measure frames/sec and end-to-end wall time. This proves Reading B.

No database writes involved, so the ops/sec ceiling does not apply.

### Phase 3 — ingest benchmark, only if A is genuinely required

If 1M-in-10s is a hard requirement rather than an aspiration, it needs a paid
cluster. Be clear-eyed about what that buys:

| Tier | Compute | What it removes |
| --- | --- | --- |
| M30 | dedicated vCPU | The 100 ops/sec ceiling; supports sharding |
| M50 | 16,000 connections | Concurrency limits under parallel load |
| M60+ | 32,000 connections | Write parallelism at scale |

Even on M30+, 33K writes/sec sustained is a quarter to a third of the published
single-node hardware ceiling. It is reachable, but you would largely be
benchmarking the database rather than the fraud detection — a poor use of a
hackathon unless ingest throughput is itself the deliverable.

---

## What I would not do

**Do not upgrade the tier yet.** Nothing in the current demo needs it. The free
cluster serves 926 accounts and 8,041 transactions at 68 req/s, and the demo
runs at a handful of requests per second. Upgrading before measuring against a
realistic dataset spends money to solve a problem the demo does not have.

**Do not build a sharded cluster.** Sharding adds operational complexity that
three people in a hackathon cannot debug on stage, and it is only worth it well
past the scale where a single node's write capacity is the binding constraint.

**Do not optimise for 33K/sec ingest before proving the read path at 1M.** The
product reads far more than it writes. Optimising ingest is optimising the
rarer path.

---

## Cost, if Phase 3 is required

| Tier | Approximate monthly | Notes |
| --- | --- | --- |
| M0 (current) | $0 | 100 ops/sec, 512 MB |
| M10 | ~$0.11/hr | Shared vCPU. Still slow |
| M30 | ~$0.40/hr | Dedicated vCPU, first tier worth benchmarking on |
| M50 | ~$1.30/hr | Meaningful write throughput |
| M60 | ~$2.30/hr | High concurrency |

For a 32-hour hackathon, M30 for the duration is roughly **$13**. That is
affordable, and it would let Phase 3 produce a real number rather than a
projection. But only after Phase 1 proves the read path matters.

---

## Decision needed

**Which reading is the 500K–1M requirement?**

- **A** — ingest throughput. Costs money, needs a tier upgrade, and is the
  hardest of the three by far.
- **B** — replay speed. Cheap, achievable today, but must not replace legible
  demo pacing.
- **C** — serving a real 1M-transaction dataset. Achievable on free tier with
  Phase 1, and the one that makes the product claim meaningful.

My recommendation is **C**, with B as a measured side result. But this is a team
call, and it changes what gets built.

## Sources

- Atlas Free Cluster Limits — throughput 100 ops/sec, 500 connections, 512 MB
  <https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/>
- Atlas Service Limits — per-tier connection and connection-rate limits
  <https://www.mongodb.com/docs/atlas/reference/atlas-limits/>
- Bulk Write Operations — ordered vs unordered, sharded write guidance
  <https://www.mongodb.com/docs/manual/core/bulk-write-operations/>
- MongoDB throughput benchmarks — 102K writes/sec ceiling on dedicated hardware