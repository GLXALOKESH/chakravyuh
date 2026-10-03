/**
 * Load and stress test for the API against Atlas.
 *
 * Deliberately out of `test/` because it is not a pass/fail gate — it measures
 * and prints. Running it in the normal suite would make the suite slow and
 * would mean a slow network failed the build, which is the wrong signal.
 *
 *   pnpm exec tsx src/bin/loadtest.ts
 *
 * Phases, each reported separately because they answer different questions:
 *
 *   warmup   one request per route, so connection setup is not in the numbers
 *   baseline 20 req/s for 15s — what one browser tab does
 *   load     50 req/s for 20s — a few tabs plus the frontend polling
 *   stress   100 req/s for 20s — more than the demo will ever produce
 *   spike    200 req/s for 10s — deliberately abusive
 *
 * Atlas free tier shares CPU across the cluster and caps concurrent
 * connections, so the interesting number is not peak throughput but where the
 * latency curve bends. A server that degrades gracefully under spike and
 * recovers is fine; one that stays slow afterwards is not.
 */
import { performance } from 'node:perf_hooks';

const BASE = process.env.LOADTEST_BASE ?? 'http://localhost:4000';
const CONCURRENCY = Number(process.env.LOADTEST_CONCURRENCY ?? 25);

/** Weighted toward what the dashboard actually hits. */
const ROUTES: { path: string; method: 'GET' | 'POST'; weight: number; body?: unknown }[] = [
  { path: '/api/rings', method: 'GET', weight: 18 },
  { path: '/api/rings/RING01', method: 'GET', weight: 22 },
  { path: '/api/alerts', method: 'GET', weight: 16 },
  { path: '/api/rings/RING01/geo', method: 'GET', weight: 10 },
  { path: '/api/rings/RING01/recruits', method: 'GET', weight: 6 },
  { path: '/api/accounts/ACC0311', method: 'GET', weight: 10 },
  { path: '/api/metrics', method: 'GET', weight: 4 },
  { path: '/api/rings/RING01/taint', method: 'GET', weight: 6 },
  { path: '/api/transactions?limit=50', method: 'GET', weight: 6 },
  { path: '/api/replay/state', method: 'GET', weight: 2 },
];

const EXPANDED: typeof ROUTES = ROUTES.flatMap((r) =>
  Array.from({ length: r.weight }, () => r),
);

interface Sample { ms: number; status: number; bytes: number }

interface PhaseResult {
  name: string;
  target: number;
  sent: number;
  ok: number;
  failed: number;
  statusCounts: Record<number, number>;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  rps: number;
  durationMs: number;
}

const pct = (sorted: number[], p: number): number =>
  sorted.length ? (sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0) : 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One request. Never throws — a failure is a sample with a bad status. */
const fire = async (route: (typeof ROUTES)[number], t0: number): Promise<Sample> => {
  const init: RequestInit = route.method === 'POST'
    ? {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(route.body ?? {}),
      }
    : {};

  try {
    const res = await fetch(`${BASE}${route.path}`, init);
    const text = await res.text();
    return { ms: performance.now() - t0, status: res.status, bytes: text.length };
  } catch (err) {
    // A connection reset is the interesting failure under load, so it is a
    // sample rather than an exception.
    return { ms: performance.now() - t0, status: 0, bytes: 0 };
  }
};

const runPhase = async (name: string, targetRps: number, seconds: number): Promise<PhaseResult> => {
  const samples: Sample[] = [];
  const started = performance.now();
  const intervalMs = 1000 / targetRps;
  const end = started + seconds * 1000;

  // Fixed-step scheduling: each tick fires one request regardless of whether the
  // previous one finished. That is what generates real queueing when the server
  // falls behind, which is the behaviour under test.
  const inFlight = new Set<Promise<void>>();

  for (let t = started; t < end; t += intervalMs) {
    const wait = t - performance.now();
    if (wait > 0) await sleep(wait);

    const route = EXPANDED[Math.floor(Math.random() * EXPANDED.length)];
    if (!route) { await sleep(intervalMs); continue; }
    const p = fire(route, performance.now()).then((s) => { samples.push(s); });
    inFlight.add(p);
    void p.finally(() => inFlight.delete(p));
  }

  await Promise.allSettled([...inFlight]);

  const durationMs = performance.now() - started;
  const times = samples.map((s) => s.ms).sort((a, b) => a - b);
  const statusCounts: Record<number, number> = {};
  for (const s of samples) statusCounts[s.status] = (statusCounts[s.status] ?? 0) + 1;

  const ok = samples.filter((s) => s.status >= 200 && s.status < 400).length;

  return {
    name,
    target: targetRps,
    sent: samples.length,
    ok,
    failed: samples.length - ok,
    statusCounts,
    p50: pct(times, 50),
    p95: pct(times, 95),
    p99: pct(times, 99),
    max: times[times.length - 1] ?? 0,
    rps: samples.length / (durationMs / 1000),
    durationMs,
  };
};

const report = (r: PhaseResult): void => {
  console.log(`\n── ${r.name}  (target ${r.target} req/s, ${(r.durationMs / 1000).toFixed(0)}s)`);
  console.log(`   sent ${r.sent}  ok ${r.ok}  failed ${r.failed}  achieved ${r.rps.toFixed(1)} req/s`);
  console.log(`   p50 ${r.p50.toFixed(0)}ms   p95 ${r.p95.toFixed(0)}ms   p99 ${r.p99.toFixed(0)}ms   max ${r.max.toFixed(0)}ms`);
  const statuses = Object.entries(r.statusCounts)
    .sort((a, b) => Number(b[0]) - Number(a[0]))
    .map(([code, n]) => `${code}:${n}`)
    .join('  ');
  console.log(`   statuses  ${statuses}`);
};

const main = async (): Promise<void> => {
  console.log(`load test against ${BASE}`);
  console.log(`concurrency ${CONCURRENCY}, ${ROUTES.length} routes weighted by dashboard usage`);

  // Warmup: one pass so DNS, TLS and the Mongoose pool are warm. Otherwise the
  // first phase measures connection setup, which is not the question.
  console.log('\nwarming up…');
  for (const r of ROUTES) await fire(r, performance.now());

  const phases: [string, number, number][] = [
    ['baseline', 20, 15],
    ['load', 50, 20],
    ['stress', 100, 20],
    ['spike', 200, 10],
  ];

  const results: PhaseResult[] = [];
  for (const [name, rps, secs] of phases) {
    const r = await runPhase(name, rps, secs);
    results.push(r);
    report(r);
    // Let connections drain and Atlas's shared CPU settle between phases, so a
    // slow phase is not just the previous one still finishing.
    await sleep(3000);
  }

  console.log('\n── recovery (10 req/s for 5s after the spike)');
  const rec = await runPhase('recovery', 10, 5);
  report(rec);

  console.log('\n══ SUMMARY ══');
  console.log('phase      target  achieved   p50    p95    p99    max   failed');
  for (const r of [...results, rec]) {
    console.log(
      `${r.name.padEnd(10)} ${String(r.target).padStart(5)}  ${r.rps.toFixed(1).padStart(8)}  ` +
      `${r.p50.toFixed(0).padStart(5)}  ${r.p95.toFixed(0).padStart(5)}  ` +
      `${r.p99.toFixed(0).padStart(5)}  ${r.max.toFixed(0).padStart(5)}  ${String(r.failed).padStart(6)}`,
    );
  }

  const spike = results[results.length - 1]!;
  const degraded = rec.p95 > spike.p95 * 3 && rec.p95 > 1000;
  console.log(
    degraded
      ? '\nRECOVERY POOR: p95 after the spike is far worse than during it.'
      : '\nrecovery looks normal.',
  );
};

void main().then(() => process.exit(0));