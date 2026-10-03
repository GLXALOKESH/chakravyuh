// The server's replay over Socket.IO, attached behind the hub in lib/socket.ts.
//
// The server's engine has no pause and no reset: `replay:start` always plays
// from the first transaction, and `replay:stop` ends the run where it is.
// So the client's reset is a stop plus clearing its own views.

import { io } from "socket.io-client";
import { API_URL } from "../source";
import type { Dispatch, ReplayBackend } from "../socket";
import type { Alert, ReplayState, RingDetail, StreamSnapshot, StreamState, Txn } from "../types";
import { toAlert, toRing, type WireAlert, type WireRing } from "./api";

export function liveBackend(dispatch: Dispatch): ReplayBackend {
  const s = io(API_URL, { transports: ["websocket", "polling"] });

  s.on("connect", () => dispatch("connection", { connected: true }));
  s.on("disconnect", () => dispatch("connection", { connected: false }));
  s.on("connect_error", () => dispatch("connection", { connected: false }));

  s.on("txn", (t: Txn) => dispatch("txn", t));
  s.on("alert", (a: Parameters<typeof toAlert>[0]) => {
    const alert = toAlert(a);
    if (alert) dispatch("alert", alert);
  });
  s.on("replay:clock", (c: { ts: string }) => dispatch("replay:clock", c));
  s.on("replay:state", (state: ReplayState & { ok?: boolean }) => {
    // start and stop answer with a short result, not a full state; only a full one is passed on.
    if (typeof state.emitted === "number") dispatch("replay:state", state);
  });
  s.on("replay:end", () => dispatch("replay:end", undefined));
  s.on("error", (e: { error?: string }) => dispatch("replay:error", { error: e?.error ?? "The replay failed on the server." }));

  // Live mode. Rings and alerts go through the same mapping as the REST routes.
  const ring = (r: WireRing): RingDetail => ({ ...toRing(r), version: (r as WireRing & { version?: number }).version });
  const alert = (a: WireAlert & { before_cashout?: boolean }): Alert | null => {
    const mapped = toAlert(a);
    return mapped && { ...mapped, before_cashout: a.before_cashout };
  };
  s.on("stream:state", (state: StreamState & { ok?: boolean }) => {
    if (state.counts) dispatch("stream:state", state);
  });
  s.on("stream:snapshot", (snap: Omit<StreamSnapshot, "rings" | "alerts"> & { rings: WireRing[]; alerts: WireAlert[] }) =>
    dispatch("stream:snapshot", { ...snap, rings: snap.rings.filter(Boolean).map(ring), alerts: snap.alerts.flatMap((a) => alert(a) ?? []) }),
  );
  s.on("stream:txns", (p: { run_id: string; txns: Txn[] }) => dispatch("stream:txns", p));
  s.on("stream:scores", (p) => dispatch("stream:scores", p));
  s.on("stream:ring", (p: { run_id: string; version: number; ring: WireRing }) => {
    if (p.ring) dispatch("stream:ring", { run_id: p.run_id, version: p.version, ring: { ...ring(p.ring), version: p.version } });
  });
  s.on("stream:alert", (p: { run_id: string; alert: WireAlert & { before_cashout?: boolean } }) => {
    const a = alert(p.alert);
    if (a) dispatch("stream:alert", { run_id: p.run_id, alert: a });
  });
  s.on("stream:clock", (p) => dispatch("stream:clock", p));
  s.on("stream:end", (p) => dispatch("stream:end", p));
  s.on("stream:error", (p) => dispatch("stream:error", p));

  return {
    emit(event, payload) {
      if (event === "replay:reset") {
        s.emit("replay:stop");
        dispatch("replay:reset", undefined);
      } else {
        s.emit(event, payload);
      }
    },
  };
}
