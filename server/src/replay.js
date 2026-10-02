/**
 * Live replay engine (F11, TRD section 9).
 *
 * Express loads the demo transactions in timestamp order and runs a replay
 * clock. Every REPLAY_TICK_MS (250 ms) it advances the clock by speed * 0.25
 * seconds and emits a `txn` event for every transaction that has become due,
 * plus an `alert` when the clock passes an alert's fired_at.
 *
 * The scoring is precomputed by the pipeline, not streamed. If a judge asks
 * whether detection is truly streaming, that is the honest answer and TRD
 * section 9 says to give it.
 *
 * Tick and clock injection keep the engine testable without real timers.
 */
import { config } from './config.js';
import * as transactions from './models/transactions.js';
import * as alerts from './models/alerts.js';

export const REPLAY_EVENTS = {
  TXN: 'txn',
  ALERT: 'alert',
  CLOCK: 'replay:clock',
  END: 'replay:end',
  START: 'replay:start',
  STOP: 'replay:stop',
};

export class ReplayEngine {
  /**
   * @param {object} opts
   * @param {(event: string, payload?: unknown) => void} opts.emit
   * @param {number} [opts.tickMs]
   * @param {typeof setInterval} [opts.setTimer]
   * @param {typeof clearInterval} [opts.clearTimer]
   */
  constructor({ emit, tickMs = config.replayTickMs, setTimer = setInterval, clearTimer = clearInterval } = {}) {
    this.emit = emit ?? (() => {});
    this.tickMs = tickMs;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;

    /** @type {{ts: string, id: string, from: string, to: string, amount: number, channel: string}[]} */
    this.queue = [];
    this.queueIndex = 0;
    /** @type {{fired_at: string, alert: object}[]} */
    this.alertQueue = [];
    this.alertIndex = 0;

    this.startTs = null;
    this.clockMs = null;
    this.speed = config.replayDefaultSpeed;
    this.timer = null;
    this.nextClockEmitMs = 0;
    this.lastEmittedSecond = -1;
  }

  /** Loads the replay script from the database. */
  async load() {
    this.queue = await transactions.listOrdered();
    this.alertQueue = (await alerts.listWithRingSummary()).map((alert) => ({
      fired_at: alert.fired_at,
      alert,
    }));
    // Ring alerts fire in clock order regardless of how the list came back.
    this.alertQueue.sort((a, b) => Date.parse(a.fired_at) - Date.parse(b.fired_at));
    return { transactions: this.queue.length, alerts: this.alertQueue.length };
  }

  get running() {
    return this.timer !== null;
  }

  /**
   * Starts the replay. `speed` is replay seconds per real second, so 60
   * compresses a 7 day dataset into about 10 minutes and 3600 replays it fast.
   */
  start({ speed = config.replayDefaultSpeed } = {}) {
    if (this.running) return { ok: true, alreadyRunning: true };

    if (!this.queue.length) throw new Error('replay script is empty; call load() first');

    this.speed = Number.isFinite(speed) && speed > 0 ? speed : config.replayDefaultSpeed;
    this.startTs = Date.parse(this.queue[0].ts);
    this.clockMs = 0;
    this.queueIndex = 0;
    this.alertIndex = 0;
    this.lastEmittedSecond = -1;

    this.timer = this.setTimer(() => this.tick(), this.tickMs);
    return { ok: true, speed: this.speed, queued: this.queue.length };
  }

  stop() {
    if (!this.running) return { ok: true, alreadyStopped: true };
    this.clearTimer(this.timer);
    this.timer = null;
    return { ok: true };
  }

  /** Advances the clock and flushes everything now due. Exported for tests. */
  tick() {
    if (!this.running) return null;

    const stepMs = this.tickMs * this.speed;
    this.clockMs += stepMs;
    const clock = new Date(this.startTs + this.clockMs);

    const emittedTxns = [];
    while (this.queueIndex < this.queue.length) {
      const txn = this.queue[this.queueIndex];
      if (Date.parse(txn.ts) > clock.getTime()) break;
      this.queueIndex += 1;
      // The socket payload for `txn` (TRD section 8): no is_fraud.
      emittedTxns.push({ id: txn.id, from: txn.from, to: txn.to, amount: txn.amount, ts: txn.ts, channel: txn.channel });
      this.emit(REPLAY_EVENTS.TXN, emittedTxns[emittedTxns.length - 1]);
    }

    const emittedAlerts = [];
    while (this.alertIndex < this.alertQueue.length) {
      const entry = this.alertQueue[this.alertIndex];
      if (Date.parse(entry.fired_at) > clock.getTime()) break;
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
      this.emit(REPLAY_EVENTS.CLOCK, { ts: new Date(this.startTs + this.clockMs).toISOString().replace(/\.\d{3}Z$/, 'Z') });
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
  state() {
    const started = this.clockMs !== null;
    return {
      running: this.running,
      speed: this.speed,
      progress: this.queue.length ? this.queueIndex / this.queue.length : 0,
      emitted: this.queueIndex,
      queued: this.queue.length,
      pending_alerts: Math.max(0, this.alertQueue.length - this.alertIndex),
      clock: started && this.startTs !== null
        ? new Date(this.startTs + this.clockMs).toISOString().replace(/\.\d{3}Z$/, 'Z')
        : null,
    };
  }
}