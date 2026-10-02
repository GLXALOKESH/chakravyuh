/**
 * Live replay engine (F11, TRD section 8 socket table and section 9).
 *
 * The server loads the demo transactions in timestamp order and runs a replay
 * clock. Every REPLAY_TICK_MS (250 ms) it advances the clock by speed * 0.25
 * seconds and emits a `txn` event for every transaction that has become due,
 * plus an `alert` when the clock passes an alert's fired_at.
 *
 * The scoring is precomputed by the pipeline, not streamed. If a judge asks
 * whether detection is truly streaming, that is the honest answer and TRD
 * section 9 says to give it.
 *
 * The timer is injected so the engine can be driven by hand in a test with no
 * real waiting, and the script can be supplied directly so the engine's logic
 * is testable without a database.
 */
import { config } from '../configs/env.js';
import { REPLAY_EVENTS } from '../constants/index.js';
import { iso } from '../utilities/serialize.util.js';
import * as transactions from '../repositories/transactions.repository.js';
import * as alerts from '../repositories/alerts.repository.js';
import type { AlertWithRing, ReplayState, ReplayTxn } from '../interfaces/domain.interface.js';

export { REPLAY_EVENTS };

export type ReplayEmit = (event: string, payload?: unknown) => void;
type SetTimer = (fn: () => void, ms: number) => unknown;
type ClearTimer = (handle: unknown) => void;

/** A queued alert, paired with the time it becomes due. */
interface QueuedAlert {
  fired_at_ms: number;
  alert: AlertWithRing;
}

export interface ReplayScript {
  transactions: ReplayTxn[];
  alerts: AlertWithRing[];
}

export interface StartResult {
  ok: true;
  alreadyRunning?: boolean;
  speed?: number;
  queued?: number;
}

export interface StopResult {
  ok: true;
  alreadyStopped?: boolean;
}

/** What one tick produced. Returned so tests can assert on a single step. */
export interface TickResult {
  clockMs: number;
  emittedTxns: ReplayTxn[];
  emittedAlerts: AlertWithRing[];
  emittedClock: boolean;
  ended: boolean;
}

export interface ReplayEngineOptions {
  emit?: ReplayEmit;
  tickMs?: number;
  setTimer?: SetTimer;
  clearTimer?: ClearTimer;
  defaultSpeed?: number;
}

export class ReplayEngine {
  private readonly emit: ReplayEmit;
  private readonly tickMs: number;
  private readonly setTimer: SetTimer;
  private readonly clearTimer: ClearTimer;
  private readonly defaultSpeed: number;

  private queue: ReplayTxn[] = [];
  private queueIndex = 0;
  private alertQueue: QueuedAlert[] = [];
  private alertIndex = 0;

  private startTs: number | null = null;
  private clockMs = 0;
  private speed: number;
  private timer: unknown = null;
  private nextClockEmitMs = 0;
  private lastEmittedSecond = -1;

  constructor(options: ReplayEngineOptions = {}) {
    this.emit = options.emit ?? (() => {});
    this.tickMs = options.tickMs ?? config.replayTickMs;
    this.setTimer = options.setTimer ?? ((fn, ms) => setInterval(fn, ms));
    this.clearTimer = options.clearTimer ?? ((handle) => clearInterval(handle as NodeJS.Timeout));
    this.defaultSpeed = options.defaultSpeed ?? config.replayDefaultSpeed;
    this.speed = this.defaultSpeed;
  }

  /** Loads the replay script from the database. */
  async load(): Promise<{ transactions: number; alerts: number }> {
    const script = await this.loadScript();
    return { transactions: script.transactions.length, alerts: script.alerts.length };
  }

  /** Reads the script without installing it, so `load` stays one thin call. */
  private async loadScript(): Promise<ReplayScript> {
    return {
      transactions: await transactions.listOrdered(),
      alerts: await alerts.listWithRingByFiredAt(),
    };
  }

  /**
   * Installs a script directly.
   *
   * This is how the engine is tested without a database: the ordering, clock
   * cadence and end condition are engine behaviour, not query behaviour, so
   * they can be exercised against a hand-built script.
   *
   * Rows are re-projected on the way in, so a caller handing over a wider
   * Transaction (as the fixtures do) still ends up emitting exactly the six
   * keys TRD section 8 names.
   */
  setScript(script: ReplayScript): void {
    this.queue = script.transactions
      .map((t) => ({ id: t.id, from: t.from, to: t.to, amount: t.amount, ts: t.ts, channel: t.channel }))
      .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
    this.alertQueue = [...script.alerts]
      .map((alert) => ({ fired_at_ms: Date.parse(alert.fired_at ?? ''), alert }))
      // Ring alerts fire in clock order regardless of how the list came back.
      .sort((a, b) => a.fired_at_ms - b.fired_at_ms);
    this.queueIndex = 0;
    this.alertIndex = 0;
  }

  get running(): boolean {
    return this.timer !== null;
  }

  /**
   * Starts the replay. `speed` is replay seconds per real second, so 60
   * compresses a 7 day dataset into about 10 minutes and 3600 replays it fast.
   */
  start({ speed = this.defaultSpeed }: { speed?: number } = {}): StartResult {
    if (this.running) return { ok: true, alreadyRunning: true };
    if (!this.queue.length) throw new Error('replay script is empty; call load() first');

    this.speed = Number.isFinite(speed) && speed > 0 ? speed : this.defaultSpeed;
    this.startTs = Date.parse(this.queue[0]!.ts);
    this.clockMs = 0;
    this.queueIndex = 0;
    this.alertIndex = 0;
    this.lastEmittedSecond = -1;

    this.timer = this.setTimer(() => this.tick(), this.tickMs);
    return { ok: true, speed: this.speed, queued: this.queue.length };
  }

  stop(): StopResult {
    if (!this.running) return { ok: true, alreadyStopped: true };
    this.clearTimer(this.timer);
    this.timer = null;
    return { ok: true };
  }

  /** Advances the clock and flushes everything now due. */
  tick(): TickResult | null {
    if (!this.running) return null;

    const stepMs = this.tickMs * this.speed;
    this.clockMs += stepMs;
    const clockMs = (this.startTs ?? 0) + this.clockMs;

    const emittedTxns: ReplayTxn[] = [];
    while (this.queueIndex < this.queue.length) {
      const txn = this.queue[this.queueIndex]!;
      if (Date.parse(txn.ts) > clockMs) break;
      this.queueIndex += 1;
      emittedTxns.push(txn);
      this.emit(REPLAY_EVENTS.TXN, txn);
    }

    const emittedAlerts: AlertWithRing[] = [];
    while (this.alertIndex < this.alertQueue.length) {
      const entry = this.alertQueue[this.alertIndex]!;
      if (entry.fired_at_ms > clockMs) break;
      this.alertIndex += 1;
      emittedAlerts.push(entry.alert);
      this.emit(REPLAY_EVENTS.ALERT, entry.alert);
    }

    // replay:clock goes out once per replay second, not once per tick, and is
    // not gated on transactions having fired: at a high speed the clock can
    // advance through a quiet stretch and the dashboard should still show it
    // moving.
    const second = Math.floor(this.clockMs / 1000);
    let emittedClock = false;
    if (second !== this.lastEmittedSecond) {
      this.lastEmittedSecond = second;
      emittedClock = true;
      this.emit(REPLAY_EVENTS.CLOCK, { ts: iso(new Date(clockMs)) });
    }

    let ended = false;
    if (this.queueIndex >= this.queue.length) {
      this.stop();
      ended = true;
      this.emit(REPLAY_EVENTS.END);
    }

    return { clockMs: this.clockMs, emittedTxns, emittedAlerts, emittedClock, ended };
  }

  /** Snapshot for GET /replay/state and for the replay bar. */
  state(): ReplayState {
    const started = this.startTs !== null;
    return {
      running: this.running,
      speed: this.speed,
      progress: this.queue.length ? this.queueIndex / this.queue.length : 0,
      emitted: this.queueIndex,
      queued: this.queue.length,
      pending_alerts: Math.max(0, this.alertQueue.length - this.alertIndex),
      clock: started ? iso(new Date((this.startTs ?? 0) + this.clockMs)) : null,
    };
  }
}
