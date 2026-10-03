/**
 * Live mode (docs/STREAMING.md).
 *
 *   ml/stream_generator.py ──NDJSON──► StreamService ──stream:* events──► dashboard
 *                                          │
 *                                          └─ POST /predict, ~1 s batches ─► ml/online.py
 *                                             ◄── scores, rings, alerts ──┘
 *
 * The generator makes up a bank's day as it happens. Every line is kept in
 * the LiveStore and queued for the predictor; transactions also go straight
 * to the dashboard, 250 ms at a time. The predictor is sent everything new
 * about once a second, one request at a time and numbered, and its answers
 * are relayed as they come back.
 *
 * Nothing waits on Python. If the predictor is slow or down, transactions
 * keep streaming, the state says so, and the unsent batches are delivered
 * when it answers again. Every event of the run is kept, so a predictor that
 * restarted mid-run is caught up from the beginning.
 *
 * Unlike the replay engine (replay.service.ts), nothing here is precomputed:
 * the scores, rings and alerts are worked out while the run plays.
 *
 * Timers, the predictor and the child process are all injected, so the tests
 * drive a whole run by hand with no Python and no waiting.
 */
import { config } from '../configs/env.js';
import { IDENTIFIER_TYPES, STREAM_EVENTS, type IdentifierTypeValue } from '../constants/index.js';
import { spawnGenerator, type GeneratorHandle, type SpawnGenerator } from './generator.process.js';
import { LiveStore, SALARY, type LiveAccount, type LiveScore, type LiveTxn } from './live.store.js';
import { createPredictorClient, PredictorError, type PredictorClient, type PredictRequest, type PredictResponse } from './predictor.client.js';
import type { Transaction } from '../interfaces/domain.interface.js';
import { ActivityLog } from './activity-log.service.js';
import { logEvent } from './logger.service.js';
import { withLogContext } from '../utilities/log-context.util.js';

export type StreamEmit = (event: string, payload?: unknown) => void;
type SetTimer = (fn: () => void, ms: number) => unknown;
type ClearTimer = (handle: unknown) => void;

export type PredictorStatus = 'idle' | 'starting' | 'ok' | 'lagging' | 'down';

export interface StreamState {
  mode: 'live' | 'idle';
  running: boolean;
  run_id: string | null;
  seed: number | null;
  rate: number | null;
  sim_start: string | null;
  sim_end: string | null;
  clock: string | null;
  ended: string | null;
  counts: { txns: number; accounts: number; scored: number; high_risk: number; rings: number; alerts: number };
  predictor: { status: PredictorStatus; pending_txns: number; last_error: string | null; took_ms: number | null; stats: Record<string, number> };
  generator: { status: 'idle' | 'running' | 'exited' | 'failed' | 'external'; pid: number | null };
}

export interface StreamStartResult {
  ok: true;
  alreadyRunning?: boolean;
  run_id?: string;
  rate?: number;
  seed?: number | null;
}

export interface StreamServiceOptions {
  emit?: StreamEmit;
  predictor?: PredictorClient;
  spawn?: SpawnGenerator;
  setTimer?: SetTimer;
  clearTimer?: ClearTimer;
  tickMs?: number;
  predictIntervalMs?: number;
  batchMax?: number;
  maxTxns?: number;
  now?: () => number;
  /** Called as a run starts, so replay can be stopped: one mode at a time. */
  onStart?: () => void;
}

interface QueueItem {
  kind: 'account' | 'identifier' | 'txn';
  data: Record<string, unknown>;
}

interface Batch {
  seq: number;
  end: number;
  body: PredictRequest;
}

/** Most transactions sent to the dashboard in one stream:txns event. */
const TXNS_PER_EMIT = 2000;
/** What a reconnecting dashboard is sent of the run so far. */
const SNAPSHOT_TXNS = 4000;
const BACKOFF_MIN_MS = 1000;
const BACKOFF_MAX_MS = 10_000;
const TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

const isIdentifierType = (value: unknown): value is IdentifierTypeValue => IDENTIFIER_TYPES.includes(value as IdentifierTypeValue);

export class StreamService {
  readonly store = new LiveStore();
  private readonly emit: StreamEmit;
  private readonly predictor: PredictorClient;
  private readonly spawn: SpawnGenerator;
  private readonly setTimer: SetTimer;
  private readonly clearTimer: ClearTimer;
  private readonly tickMs: number;
  private readonly predictIntervalMs: number;
  private readonly batchMax: number;
  private readonly maxTxns: number;
  private readonly now: () => number;
  private readonly onStart?: () => void;

  private running = false;
  /** The generator has finished but the predictor is still catching up. */
  private draining = false;
  private ended: string | null = null;
  private generator: GeneratorHandle | null = null;
  private generatorStatus: StreamState['generator']['status'] = 'idle';
  private tickTimer: unknown = null;
  private pumpTimer: unknown = null;
  private lastStateAt = 0;
  private lastClockSent: string | null = null;

  private queue: QueueItem[] = [];
  private outbox: Transaction[] = [];
  private cursor = 0;
  private seq = 0;
  private pending: Batch | null = null;
  private inFlight = false;
  private predictorReady = false;
  private predictorStatus: PredictorStatus = 'idle';
  private lastError: string | null = null;
  private tookMs: number | null = null;
  private predictorStats: Record<string, number> = {};
  private backoffMs = BACKOFF_MIN_MS;
  private retryAt = 0;
  private rejected = 0;
  private readonly activity: ActivityLog;
  private loggedPredictorStatus: PredictorStatus = 'idle';

  constructor(options: StreamServiceOptions = {}) {
    this.emit = options.emit ?? (() => {});
    this.predictor = options.predictor ?? createPredictorClient();
    this.spawn = options.spawn ?? spawnGenerator;
    this.setTimer = options.setTimer ?? ((fn, ms) => setInterval(fn, ms));
    this.clearTimer = options.clearTimer ?? ((handle) => clearInterval(handle as NodeJS.Timeout));
    this.tickMs = options.tickMs ?? config.stream.tickMs;
    this.predictIntervalMs = options.predictIntervalMs ?? config.stream.predictIntervalMs;
    this.batchMax = options.batchMax ?? config.stream.predictBatchMax;
    this.maxTxns = options.maxTxns ?? config.stream.maxTxns;
    this.now = options.now ?? Date.now;
    this.activity = new ActivityLog('stream', this.now);
    this.onStart = options.onStart;
  }

  get isRunning(): boolean {
    return this.running;
  }

  // ---- lifecycle -------------------------------------------------------------

  /**
   * Starts a run. With `external`, no generator is started and events are
   * expected on POST /api/stream/ingest instead (a generator on another machine).
   */
  start({ seed, rate = config.stream.defaultRate, external = false }: { seed?: number; rate?: number; external?: boolean } = {}): StreamStartResult {
    if (this.running || this.draining) return { ok: true, alreadyRunning: true, run_id: this.store.runId ?? undefined };
    this.onStart?.();

    const runId = `run-${this.now().toString(36)}`;
    this.activity.reset(runId);
    this.loggedPredictorStatus = 'idle';
    logEvent('info', 'stream.started', { run_id: runId, rate, seed, mode: external ? 'external' : 'generator', direction: 'internal' });
    this.store.reset(runId);
    this.store.rate = rate;
    this.queue = [];
    this.outbox = [];
    this.cursor = 0;
    this.seq = 0;
    this.pending = null;
    this.inFlight = false;
    this.predictorReady = false;
    this.predictorStatus = 'starting';
    this.lastError = null;
    this.tookMs = null;
    this.predictorStats = {};
    this.backoffMs = BACKOFF_MIN_MS;
    this.retryAt = 0;
    this.rejected = 0;
    this.ended = null;
    this.lastClockSent = null;
    this.running = true;
    this.draining = false;

    if (external) {
      this.generatorStatus = 'external';
    } else {
      this.generatorStatus = 'running';
      let exited = false;
      this.generator = withLogContext({ run_id: runId }, () => this.spawn({
        seed,
        rate,
        onEvent: (event) => {
          if (this.store.runId === runId) this.ingest([event]);
        },
        onExit: (code) => {
          if (exited || this.store.runId !== runId) return;
          exited = true;
          this.generator = null;
          if (this.running) {
            // Exited without an `end` line: the process failed or was killed from outside.
            this.generatorStatus = 'failed';
            this.emit(STREAM_EVENTS.ERROR, { error: `The data generator stopped unexpectedly (exit ${code ?? 'error'}).` });
            this.finish('generator stopped');
          } else if (this.generatorStatus === 'running') {
            this.generatorStatus = 'exited';
          }
        },
      }), { replace: true });
    }

    withLogContext({ run_id: runId }, () => {
      this.tickTimer = this.setTimer(() => this.tick(), this.tickMs);
      this.pumpTimer = this.setTimer(() => void this.pump(), this.predictIntervalMs);
    }, { replace: true });
    this.emitState(true);
    return { ok: true, run_id: runId, rate, seed: seed ?? null };
  }

  /** Ends the run now. Its data stays readable until the next run starts. */
  stop(reason = 'stopped'): { ok: true; alreadyStopped?: boolean } {
    if (!this.running && !this.draining) return { ok: true, alreadyStopped: true };
    this.killGenerator();
    this.draining = false;
    this.end(reason);
    return { ok: true };
  }

  /**
   * Throws the run away: stops it if it is going, then empties everything it
   * left behind, so a dashboard that reloads finds nothing to restore. The
   * predictor is left alone; the next run resets it.
   */
  clear(): { ok: true } {
    logEvent('info', 'stream.cleared', { run_id: this.store.runId, direction: 'internal' });
    if (this.running || this.draining) this.stop('cleared');
    this.store.reset(null);
    this.queue = [];
    this.outbox = [];
    this.cursor = 0;
    this.seq = 0;
    this.pending = null;
    this.predictorReady = false;
    this.predictorStatus = 'idle';
    this.lastError = null;
    this.tookMs = null;
    this.predictorStats = {};
    this.ended = null;
    this.lastClockSent = null;
    this.generatorStatus = 'idle';
    this.emitState(true);
    return { ok: true };
  }

  /** The generator is done: deliver what the predictor has not seen yet, then end. */
  private finish(reason: string): void {
    logEvent('info', 'stream.draining', { run_id: this.store.runId, direction: 'internal' });
    this.killGenerator();
    this.running = false;
    this.draining = true;
    this.ended = reason;
    this.emitState(true);
  }

  private end(reason: string): void {
    this.running = false;
    this.draining = false;
    this.ended = reason;
    if (this.tickTimer) this.clearTimer(this.tickTimer);
    if (this.pumpTimer) this.clearTimer(this.pumpTimer);
    this.tickTimer = this.pumpTimer = null;
    this.flush();
    this.activity.flush(true);
    // The reason can arrive from an external generator: only known reasons are logged.
    logEvent('info', 'stream.ended', { run_id: this.store.runId, direction: 'internal',
      reason: ['stopped', 'cleared', 'duration', 'capacity', 'replay started', 'generator stopped', 'server shutting down'].includes(reason) ? reason : 'generator ended' });
    this.emit(STREAM_EVENTS.END, { run_id: this.store.runId, reason });
    this.emitState(true);
  }

  private killGenerator(): void {
    if (this.generator) {
      if (this.generatorStatus === 'running') this.generatorStatus = 'exited';
      this.generator.kill();
      this.generator = null;
    }
  }

  // ---- what the generator sends ------------------------------------------------

  /** Takes generator lines, from the child process or from POST /api/stream/ingest. */
  ingest(events: Record<string, unknown>[]): { accepted: number; rejected: number } {
    let accepted = 0;
    let rejected = 0;
    for (const event of events) {
      if (!this.running) break;
      if (this.take(event)) accepted += 1;
      else rejected += 1;
    }
    this.rejected += rejected;
    if (rejected) this.activity.count('rejected_events', rejected);
    return { accepted, rejected };
  }

  private take(event: Record<string, unknown>): boolean {
    const store = this.store;
    switch (event.type) {
      case 'run': {
        store.seed = typeof event.seed === 'number' ? event.seed : null;
        if (typeof event.rate === 'number') store.rate = event.rate;
        store.simStart = typeof event.sim_start === 'string' ? event.sim_start : null;
        store.simEnd = typeof event.sim_end === 'string' ? event.sim_end : null;
        store.clock = store.simStart;
        this.emitState(true);
        return true;
      }
      case 'account': {
        const a = event.account as Record<string, unknown> | undefined;
        if (!a || typeof a.id !== 'string') return false;
        const account: LiveAccount = {
          id: a.id,
          holder: typeof a.holder === 'string' ? a.holder : null,
          bank: typeof a.bank === 'string' ? a.bank : null,
          home: (a.home as LiveAccount['home']) ?? null,
          opened_at: typeof a.opened_at === 'string' ? a.opened_at : null,
          opening_balance_paise: Number.isInteger(a.opening_balance_paise) ? (a.opening_balance_paise as number) : 0,
        };
        store.addAccount(account);
        this.queue.push({ kind: 'account', data: { ...account } });
        return true;
      }
      case 'identifier': {
        if (typeof event.id !== 'string' || typeof event.account_id !== 'string' || !isIdentifierType(event.kind)) return false;
        store.addIdentifier(event.id, event.kind, event.account_id);
        this.queue.push({ kind: 'identifier', data: { id: event.id, kind: event.kind, account_id: event.account_id } });
        return true;
      }
      case 'txn': {
        const t = event.txn as Record<string, unknown> | undefined;
        if (
          !t ||
          typeof t.id !== 'string' ||
          typeof t.from !== 'string' ||
          typeof t.to !== 'string' ||
          !Number.isInteger(t.amount_paise) ||
          (t.amount_paise as number) < 0 ||
          typeof t.ts !== 'string' ||
          !TS.test(t.ts) ||
          !['UPI', 'IMPS', 'NEFT', 'ATM'].includes(t.channel as string)
        ) {
          return false;
        }
        const txn: LiveTxn = {
          id: t.id,
          from: t.from,
          to: t.to,
          amount_paise: t.amount_paise as number,
          ts: t.ts,
          channel: t.channel as string,
          location: (t.location as LiveTxn['location']) ?? null,
        };
        const gt = event.gt as { is_fraud?: boolean } | undefined;
        store.addTxn(txn, Boolean(gt?.is_fraud));
        this.activity.count('received_txns');
        // The label stops here: the predictor gets the transaction alone.
        this.queue.push({ kind: 'txn', data: { ...txn } });
        // Salary credits feed the model's features but are not shown.
        if (txn.from !== SALARY) this.outbox.push(store.clientTxn(txn));
        if (store.txns.length >= this.maxTxns) {
          this.emit(STREAM_EVENTS.ERROR, { error: `The run reached ${this.maxTxns.toLocaleString('en-IN')} transactions and was ended.` });
          this.finish('capacity');
        }
        return true;
      }
      case 'truth': {
        if (typeof event.ring !== 'string' || !Array.isArray(event.member_ids)) return false;
        store.truth.set(event.ring, {
          ring: event.ring,
          pattern: String(event.pattern ?? ''),
          member_ids: event.member_ids as string[],
          victim_txn_id: String(event.victim_txn_id ?? ''),
          victim_amount_paise: Number(event.victim_amount_paise ?? 0),
          planted_at: String(event.planted_at ?? ''),
        });
        return true;
      }
      case 'clock': {
        if (typeof event.ts !== 'string' || !TS.test(event.ts)) return false;
        store.clock = event.ts;
        return true;
      }
      case 'end': {
        this.finish(typeof event.reason === 'string' ? event.reason : 'duration');
        return true;
      }
      default:
        return false;
    }
  }

  // ---- to the dashboard ------------------------------------------------------------

  /** Every tick: new transactions, the clock, and now and then the state. */
  tick(): void {
    this.flush();
    this.activity.flush();
    if (this.store.clock && this.store.clock !== this.lastClockSent) {
      this.lastClockSent = this.store.clock;
      this.emit(STREAM_EVENTS.CLOCK, { run_id: this.store.runId, ts: this.store.clock });
    }
    this.emitState(false);
  }

  private flush(): void {
    while (this.outbox.length) {
      const txns = this.outbox.splice(0, TXNS_PER_EMIT);
      this.activity.count('emitted_txns', txns.length);
      this.emit(STREAM_EVENTS.TXNS, { run_id: this.store.runId, txns });
    }
  }

  private emitState(force: boolean): void {
    if (this.predictorStatus !== this.loggedPredictorStatus) {
      this.loggedPredictorStatus = this.predictorStatus;
      logEvent(this.predictorStatus === 'down' || this.predictorStatus === 'lagging' ? 'warn' : 'info', 'stream.predictor_status', {
        run_id: this.store.runId, predictor_status: this.predictorStatus, direction: 'internal',
      });
    }
    const at = this.now();
    if (!force && at - this.lastStateAt < 1000) return;
    this.lastStateAt = at;
    this.emit(STREAM_EVENTS.STATE, this.state());
  }

  // ---- to and from the predictor ----------------------------------------------------

  private pendingTxns(): number {
    let n = 0;
    for (let i = this.pending?.end ?? this.cursor; i < this.queue.length; i++) if (this.queue[i]!.kind === 'txn') n += 1;
    return n;
  }

  private build(): Batch | null {
    if (this.cursor >= this.queue.length) return null;
    const accounts: unknown[] = [];
    const identifiers: unknown[] = [];
    const txns: unknown[] = [];
    let i = this.cursor;
    while (i < this.queue.length && txns.length < this.batchMax) {
      const item = this.queue[i]!;
      (item.kind === 'account' ? accounts : item.kind === 'identifier' ? identifiers : txns).push(item.data);
      i += 1;
    }
    const truncated = i < this.queue.length;
    const last = txns.at(-1) as { ts?: string } | undefined;
    const seq = this.seq + 1;
    return {
      seq,
      end: i,
      body: {
        run_id: this.store.runId!,
        seq,
        // A batch cut short stops at its last transaction, not at the generator's clock.
        clock: truncated ? (last?.ts ?? this.store.clock) : this.store.clock,
        accounts,
        identifiers,
        txns,
      },
    };
  }

  /** One step of the predictor exchange. Called on a timer; never more than one request at a time. */
  async pump(): Promise<void> {
    if ((!this.running && !this.draining) || this.inFlight || this.now() < this.retryAt) return;
    const runId = this.store.runId;
    this.inFlight = true;
    try {
      if (!this.predictorReady) {
        logEvent('info', 'stream.predictor_reset', { run_id: runId, direction: 'out', peer: 'ml' });
        await this.predictor.reset(runId!, this.store.simStart);
        if (this.store.runId !== runId) return;
        this.predictorReady = true;
      }
      const batch = this.pending ?? this.build();
      if (!batch) {
        if (this.draining) this.end(this.ended ?? 'duration');
        return;
      }
      this.pending = batch;
      const answer = await this.predictor.predict(batch.body);
      if (this.store.runId !== runId) return;
      this.cursor = batch.end;
      this.seq = batch.seq;
      this.pending = null;
      this.backoffMs = BACKOFF_MIN_MS;
      this.lastError = null;
      this.apply(answer);
      this.activity.count('predictor_batches');
      this.activity.count('predictor_txns_acknowledged', batch.body.txns.length);
      this.predictorStatus = this.pendingTxns() > this.batchMax * 2 ? 'lagging' : 'ok';
      if (this.draining && this.cursor >= this.queue.length) this.end(this.ended ?? 'duration');
    } catch (err) {
      if (this.store.runId !== runId) return;
      if (err instanceof PredictorError && err.status === 409) {
        // The predictor is not on this run: it restarted, or lost a batch. Start
        // it over and send the whole run again; nothing has been thrown away.
        this.predictorReady = false;
        this.seq = 0;
        this.cursor = 0;
        this.pending = null;
        for (const ring of this.store.rings.values()) ring.version = 0;
        this.lastError = 'The predictor restarted; resending the run so far.';
        logEvent('warn', 'stream.predictor_resync', { run_id: runId, seq: this.seq, direction: 'internal', status_code: 409 });
      } else {
        this.predictorStatus = 'down';
        this.lastError = (err as Error).message;
        this.retryAt = this.now() + this.backoffMs;
        logEvent('warn', 'stream.predictor_backoff', { run_id: runId, seq: this.pending?.seq, retry_ms: this.backoffMs, direction: 'internal' });
        this.backoffMs = Math.min(BACKOFF_MAX_MS, this.backoffMs * 2);
      }
      this.emitState(true);
    } finally {
      this.inFlight = false;
    }
  }

  private apply(answer: PredictResponse): void {
    const runId = this.store.runId;
    this.tookMs = answer.took_ms;
    this.predictorStats = answer.stats ?? {};
    if (answer.scores?.length) {
      const scores: LiveScore[] = answer.scores.map((s) => ({
        id: s.id,
        risk: s.risk,
        risk_v1: s.risk_v1,
        risk_v2: s.risk_v2,
        band: s.band,
        provisional: Boolean(s.provisional),
        ...(s.signals ? { signals: s.signals } : {}),
      }));
      this.store.setScores(scores);
      this.activity.count('emitted_scores', scores.length);
      this.emit(STREAM_EVENTS.SCORES, { run_id: runId, scores });
    }
    for (const ring of answer.rings ?? []) {
      if (!this.store.upsertRing(ring)) continue;
      logEvent('info', 'stream.ring', { run_id: runId, ring_id: ring.id, version: ring.version, direction: 'out', peer: 'client' });
      this.emit(STREAM_EVENTS.RING, { run_id: runId, version: ring.version, ring: this.store.ringGraph(ring.id) });
    }
    for (const alert of answer.alerts ?? []) {
      const live = this.store.addAlert(alert);
      if (live) {
        logEvent('info', 'stream.alert', { run_id: runId, ring_id: live.ring_id, alert_id: live.id, direction: 'out', peer: 'client' });
        this.emit(STREAM_EVENTS.ALERT, { run_id: runId, alert: live });
      }
    }
  }

  // ---- read-outs ---------------------------------------------------------------------

  state(): StreamState {
    const store = this.store;
    let highRisk = 0;
    for (const s of store.scores.values()) if (s.risk_v2 >= 0.5) highRisk += 1;
    return {
      mode: this.running || this.draining ? 'live' : 'idle',
      running: this.running,
      run_id: store.runId,
      seed: store.seed,
      rate: store.rate,
      sim_start: store.simStart,
      sim_end: store.simEnd,
      clock: store.clock,
      ended: this.ended,
      counts: {
        txns: store.txns.filter((t) => t.from !== SALARY).length,
        accounts: store.seen.size,
        scored: store.scores.size,
        high_risk: highRisk,
        rings: store.rings.size,
        alerts: store.alerts.length,
      },
      predictor: {
        status: this.running || this.draining ? this.predictorStatus : 'idle',
        pending_txns: this.pendingTxns(),
        last_error: this.lastError,
        took_ms: this.tookMs,
        stats: this.predictorStats,
      },
      generator: { status: this.generatorStatus, pid: this.generator?.pid ?? null },
    };
  }

  /** What a dashboard that connects mid-run needs to draw the run so far. */
  snapshot(): Record<string, unknown> {
    const store = this.store;
    const shown = store.txns.filter((t) => t.from !== SALARY);
    return {
      state: this.state(),
      txns: shown.slice(-SNAPSHOT_TXNS).map((t) => store.clientTxn(t)),
      txns_total: shown.length,
      scores: [...store.scores.values()],
      rings: [...store.rings.keys()].map((id) => store.ringGraph(id)),
      alerts: store.alerts,
      metrics: store.liveMetrics(),
    };
  }
}
