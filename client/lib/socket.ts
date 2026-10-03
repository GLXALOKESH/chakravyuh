// The replay channel the rest of the client listens to. It is a hub: views
// subscribe here once, and whichever backend the page runs on (the server's
// Socket.IO, or the in-browser demo) is attached behind it when the data
// source is known. Events sent before then wait for it.
//
// Event names follow the server's socket (TRD section 8). Client-side only:
// `replay:reset`, which clears the views for a fresh run, and `connection`.

import type { Alert, LiveMetrics, ReplayState, RingDetail, ScoreUpdate, StreamSnapshot, StreamState, Txn } from "./types";

export interface ServerEvents {
  txn: Txn;
  alert: Alert;
  "replay:clock": { ts: string };
  "replay:state": ReplayState;
  "replay:end": undefined;
  "replay:error": { error: string };
  "replay:reset": undefined;
  connection: { connected: boolean };
  // Live mode (docs/STREAMING.md).
  "stream:state": StreamState;
  "stream:snapshot": StreamSnapshot;
  "stream:txns": { run_id: string; txns: Txn[] };
  "stream:scores": { run_id: string; scores: ScoreUpdate[] };
  "stream:ring": { run_id: string; version: number; ring: RingDetail };
  "stream:alert": { run_id: string; alert: Alert };
  "stream:clock": { run_id: string; ts: string };
  "stream:end": { run_id: string; reason: string };
  "stream:error": { error: string };
  "stream:metrics": LiveMetrics;
}

export interface ClientEvents {
  "replay:start": { speed: number };
  "replay:stop": undefined;
  "replay:reset": undefined;
  "stream:start": { seed?: number; rate: number };
  "stream:stop": undefined;
}

export type Dispatch = <K extends keyof ServerEvents>(event: K, payload: ServerEvents[K]) => void;

export interface ReplayBackend {
  emit<K extends keyof ClientEvents>(event: K, payload: ClientEvents[K]): void;
}

type Handler<T> = (payload: T) => void;

class ReplayHub {
  private handlers = new Map<string, Set<Handler<never>>>();
  private backend: ReplayBackend | null = null;
  private waiting: [keyof ClientEvents, unknown][] = [];

  on<K extends keyof ServerEvents>(event: K, handler: Handler<ServerEvents[K]>) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler as Handler<never>);
    return () => this.off(event, handler);
  }

  off<K extends keyof ServerEvents>(event: K, handler: Handler<ServerEvents[K]>) {
    this.handlers.get(event)?.delete(handler as Handler<never>);
  }

  emit<K extends keyof ClientEvents>(event: K, ...payload: ClientEvents[K] extends undefined ? [] : [ClientEvents[K]]) {
    if (this.backend) this.backend.emit(event, payload[0] as ClientEvents[K]);
    else this.waiting.push([event, payload[0]]);
  }

  readonly dispatch: Dispatch = (event, payload) => {
    this.handlers.get(event)?.forEach((h) => (h as Handler<typeof payload>)(payload));
  };

  attach(backend: ReplayBackend) {
    if (this.backend) return;
    this.backend = backend;
    for (const [event, payload] of this.waiting.splice(0)) backend.emit(event, payload as never);
  }
}

export const socket = new ReplayHub();
