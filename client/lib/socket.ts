// Mock of the Socket.IO connection (TRD section 8, "Socket events"). It keeps
// the same `on` / `off` / `emit` surface, so the real client can replace it.
//
// mock-only additions: `replay:reset` (both directions), `replay:stop` pausing
// in place instead of ending the run, and `location` on an ATM `txn`.
//
// Pacing: the data covers days, and a ring does its work in minutes. Played at
// one steady rate, every ring would flash past in a fraction of a second. So
// the replay runs the quiet stretches fast and gives each ring transfer and
// each alert a moment of its own. The real replay service needs the same idea.

import { mockAlerts, mockRings, mockTransactions, mockWindow } from "./mock/data";
import type { Alert, Txn } from "./types";

export interface ServerEvents {
  txn: Txn;
  alert: Alert;
  "replay:clock": { ts: string };
  "replay:end": undefined;
  "replay:reset": undefined;
}

export interface ClientEvents {
  "replay:start": { speed: number };
  "replay:stop": undefined;
  "replay:reset": undefined;
}

type Handler<T> = (payload: T) => void;

const TICK_MS = 50;
/** Seconds of play, at 1x, given to all the ordinary traffic together. */
const QUIET_SECONDS = 34;
/** Extra seconds of play after each ring transfer or alert. */
const BEAT_SECONDS = 0.55;

interface Step {
  /** Seconds of play at 1x when this happens. */
  at: number;
  ts: number;
  txn?: Txn;
  alert?: Alert;
}

function schedule(): Step[] {
  const start = Date.parse(mockWindow.start);
  const span = Date.parse(mockWindow.end) - start || 1;
  const ringAccounts = new Set([...mockRings.values()].flatMap((r) => r.member_ids));
  const events: Omit<Step, "at">[] = [
    ...mockTransactions.map((txn) => ({ ts: Date.parse(txn.ts), txn })),
    ...mockAlerts.map((alert) => ({ ts: Date.parse(alert.fired_at), alert })),
  ].sort((a, b) => a.ts - b.ts);

  let beats = 0;
  return events.map((e) => {
    const at = ((e.ts - start) / span) * QUIET_SECONDS + beats * BEAT_SECONDS;
    if (e.alert || (e.txn && (ringAccounts.has(e.txn.from) || ringAccounts.has(e.txn.to)))) beats++;
    return { ...e, at };
  });
}

class MockSocket {
  private handlers = new Map<string, Set<Handler<never>>>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private last = 0;
  /** Play seconds per real second. */
  private rate = 1;
  /** Seconds of play so far. */
  private played = 0;
  private cursor = 0;
  private readonly steps = schedule();
  private readonly start = Date.parse(mockWindow.start);
  private readonly end = Date.parse(mockWindow.end);
  private readonly length = (this.steps.at(-1)?.at ?? 0) + BEAT_SECONDS;

  on<K extends keyof ServerEvents>(event: K, handler: Handler<ServerEvents[K]>) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler as Handler<never>);
    return () => this.off(event, handler);
  }

  off<K extends keyof ServerEvents>(event: K, handler: Handler<ServerEvents[K]>) {
    this.handlers.get(event)?.delete(handler as Handler<never>);
  }

  emit<K extends keyof ClientEvents>(event: K, ...payload: ClientEvents[K] extends undefined ? [] : [ClientEvents[K]]) {
    if (event === "replay:start") {
      // TRD: `speed` is replay seconds per real second, 60 being the default pace.
      this.rate = (payload[0] as ClientEvents["replay:start"]).speed / 60;
      if (this.played >= this.length) this.reset();
      this.begin();
    } else if (event === "replay:stop") {
      this.halt();
    } else {
      this.halt();
      this.reset();
    }
  }

  /** Where the replay clock stands, in data time. */
  clock() {
    const next = this.steps[this.cursor];
    const before = this.steps[this.cursor - 1];
    if (!next) return this.played >= this.length ? this.end : (before?.ts ?? this.start);
    const from = before ?? { at: 0, ts: this.start };
    const share = next.at > from.at ? (this.played - from.at) / (next.at - from.at) : 1;
    return from.ts + (next.ts - from.ts) * Math.min(1, Math.max(0, share));
  }

  private dispatch<K extends keyof ServerEvents>(event: K, payload: ServerEvents[K]) {
    this.handlers.get(event)?.forEach((h) => (h as Handler<ServerEvents[K]>)(payload));
  }

  private begin() {
    if (this.timer) return;
    this.last = performance.now();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  private halt() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private reset() {
    this.played = 0;
    this.cursor = 0;
    this.dispatch("replay:reset", undefined);
  }

  private tick() {
    const now = performance.now();
    // Cap the step so a background tab does not dump a day of data at once.
    const elapsed = Math.min(now - this.last, 250);
    this.last = now;
    this.played = Math.min(this.played + (elapsed / 1000) * this.rate, this.length);

    while (this.cursor < this.steps.length && this.steps[this.cursor].at <= this.played) {
      const step = this.steps[this.cursor++];
      if (step.txn) this.dispatch("txn", step.txn);
      else if (step.alert) this.dispatch("alert", step.alert);
    }
    this.dispatch("replay:clock", { ts: new Date(this.clock()).toISOString() });

    if (this.played >= this.length) {
      this.halt();
      this.dispatch("replay:end", undefined);
    }
  }
}

export const socket = new MockSocket();
