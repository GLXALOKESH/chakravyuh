// Mock of the Socket.IO connection (TRD section 8, "Socket events"). It keeps
// the same `on` / `off` / `emit` surface, so the real client can replace it.
//
// mock-only additions: `replay:reset` (both directions) and `replay:stop`
// pausing in place instead of ending the run.

import { mockAlerts, mockTransactions, mockWindow } from "./mock/data";
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

class MockSocket {
  private handlers = new Map<string, Set<Handler<never>>>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private last = 0;
  private speed = 180;
  private clock = Date.parse(mockWindow.start);
  private txnCursor = 0;
  private alertCursor = 0;
  private readonly end = Date.parse(mockWindow.end);
  private readonly txnTimes = mockTransactions.map((t) => Date.parse(t.ts));
  private readonly alerts = [...mockAlerts].sort((a, b) => a.fired_at.localeCompare(b.fired_at));

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
      this.speed = (payload[0] as ClientEvents["replay:start"]).speed;
      if (this.clock >= this.end) this.reset();
      this.start();
    } else if (event === "replay:stop") {
      this.stop();
    } else {
      this.stop();
      this.reset();
    }
  }

  private dispatch<K extends keyof ServerEvents>(event: K, payload: ServerEvents[K]) {
    this.handlers.get(event)?.forEach((h) => (h as Handler<ServerEvents[K]>)(payload));
  }

  private start() {
    if (this.timer) return;
    this.last = performance.now();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  private stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private reset() {
    this.clock = Date.parse(mockWindow.start);
    this.txnCursor = 0;
    this.alertCursor = 0;
    this.dispatch("replay:reset", undefined);
  }

  private tick() {
    const now = performance.now();
    // Cap the step so a background tab does not dump minutes of data at once.
    const elapsed = Math.min(now - this.last, 250);
    this.last = now;
    this.clock = Math.min(this.clock + elapsed * this.speed, this.end);

    while (this.txnCursor < this.txnTimes.length && this.txnTimes[this.txnCursor] <= this.clock) {
      this.dispatch("txn", mockTransactions[this.txnCursor++]);
    }
    while (
      this.alertCursor < this.alerts.length &&
      Date.parse(this.alerts[this.alertCursor].fired_at) <= this.clock
    ) {
      this.dispatch("alert", this.alerts[this.alertCursor++]);
    }
    this.dispatch("replay:clock", { ts: new Date(this.clock).toISOString() });

    if (this.clock >= this.end) {
      this.stop();
      this.dispatch("replay:end", undefined);
    }
  }
}

export const socket = new MockSocket();
