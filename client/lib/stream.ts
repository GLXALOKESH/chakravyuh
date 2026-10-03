// Live mode (docs/STREAMING.md): the dashboard while a run is generated,
// scored and grouped into rings as it plays.
//
// The server relays three things as they happen: transactions from the
// generator (`stream:txns`), and the predictor's answers about them, as
// account scores (`stream:scores`), rings that grow version by version
// (`stream:ring`) and alerts (`stream:alert`). Transactions go through the
// same `txn` channel the replay uses, so the graph, the map and the tick
// strip draw a live run exactly as they draw a replay.
//
// A live run has no known end, so the tick strip's window starts a few
// minutes of play wide and stretches as the clock reaches its edge.

import { getLiveMetrics } from "./live/api";
import { completeRing } from "./ring";
import { history, learnRing, rebin, countsNow } from "./replay";
import { socket } from "./socket";
import { useDashboard } from "./store";
import type { Alert, RingDetail, ScoreUpdate, StreamState } from "./types";

/** Real seconds of play the tick strip spans at first. */
const WINDOW_REAL_S = 180;
export const LIVE_RATES = [60, 300, 900] as const;

/** Latest live score per account. Not reactive: the graph reads it directly. */
export const riskOf = new Map<string, ScoreUpdate>();

let wired = false;
let currentRun: string | null = null;

const mine = (runId: string | undefined) => !!runId && runId === currentRun;

/** A new live run: everything on screen is from the last one, so it goes. */
function beginRun(state: StreamState) {
  currentRun = state.run_id;
  riskOf.clear();
  socket.dispatch("replay:reset", undefined);
  const start = state.sim_start ? Date.parse(state.sim_start) : Date.now();
  const span = (state.rate ?? 300) * WINDOW_REAL_S * 1000;
  useDashboard.setState({
    mode: "live",
    window: { start, end: start + span },
    clock: state.clock ? Date.parse(state.clock) : start,
    liveMetrics: null,
    liveNotice: null,
  });
}

function stretchWindow(clock: number) {
  const win = useDashboard.getState().window;
  if (!win || clock <= win.end - (win.end - win.start) * 0.04) return;
  // Grow by half again, so the strip is re-drawn now and then rather than every tick.
  useDashboard.setState({ window: { start: win.start, end: clock + (win.end - win.start) * 0.5 } });
  rebin();
}

function addRing(ring: RingDetail) {
  const victims = history.txns.filter((t) => ring.victim_txn_ids.includes(t.id));
  const complete = { ...completeRing(ring, victims), version: ring.version };
  learnRing(complete);
  // A live ring keeps growing after its alert, so its alert follows the ring's latest size and amount.
  const members = ring.nodes.filter((n) => n.type === "account").length;
  useDashboard.setState((s) => ({
    rings: { ...s.rings, [complete.id]: complete },
    alerts: s.alerts.map((a) => (a.ring_id === ring.id ? { ...a, members, volume: ring.volume, risk: ring.risk } : a)),
  }));
}

function addAlert(alert: Alert) {
  if (history.alerts.some((a) => a.id === alert.id)) return;
  history.alerts.push(alert);
  useDashboard.setState((s) => ({ alerts: [alert, ...s.alerts] }));
  void refreshMetrics();
}

async function refreshMetrics() {
  try {
    useDashboard.setState({ liveMetrics: await getLiveMetrics() });
  } catch {
    // Metrics are a nicety; the run goes on without them.
  }
}

function setScores(scores: ScoreUpdate[]) {
  for (const s of scores) riskOf.set(s.id, s);
}

/** Back to an empty dashboard: the run was cleared on the server. */
function emptyRun() {
  currentRun = null;
  riskOf.clear();
  socket.dispatch("replay:reset", undefined);
  useDashboard.setState({ status: "idle", window: null, clock: null, liveMetrics: null, liveNotice: null });
}

function applyState(state: StreamState) {
  if (!state.run_id && currentRun && useDashboard.getState().mode === "live") emptyRun();
  if (state.run_id && state.run_id !== currentRun && (state.running || useDashboard.getState().mode === "live")) beginRun(state);
  const { mode } = useDashboard.getState();
  const patch: Partial<ReturnType<typeof useDashboard.getState>> = { live: state };
  if (state.running && mode !== "live") Object.assign(patch, { mode: "live" });
  if (mine(state.run_id ?? undefined) || state.running) patch.status = state.running ? "playing" : state.ended ? "ended" : "idle";
  useDashboard.setState(patch);
}

export function wireStream() {
  if (wired) return;
  wired = true;

  socket.on("stream:state", applyState);

  socket.on("stream:snapshot", (snap) => {
    if (!snap.state.run_id) return;
    beginRun(snap.state);
    for (const t of snap.txns) socket.dispatch("txn", t);
    setScores(snap.scores);
    socket.dispatch("stream:scores", { run_id: snap.state.run_id, scores: snap.scores });
    for (const ring of snap.rings) addRing(ring);
    for (const alert of [...snap.alerts].reverse()) addAlert(alert);
    applyState(snap.state);
    useDashboard.setState({ liveMetrics: snap.metrics, counts: countsNow() });
  });

  socket.on("stream:txns", ({ run_id, txns }) => {
    if (!mine(run_id)) return;
    for (const t of txns) socket.dispatch("txn", t);
  });

  socket.on("stream:scores", ({ run_id, scores }) => {
    if (mine(run_id)) setScores(scores);
  });

  socket.on("stream:ring", ({ run_id, ring }) => {
    if (mine(run_id)) addRing(ring);
  });

  socket.on("stream:alert", ({ run_id, alert }) => {
    if (mine(run_id)) addAlert(alert);
  });

  socket.on("stream:clock", ({ run_id, ts }) => {
    if (!mine(run_id)) return;
    const clock = Date.parse(ts);
    stretchWindow(clock);
    useDashboard.setState({ clock, counts: countsNow() });
  });

  socket.on("stream:end", ({ run_id }) => {
    if (!mine(run_id)) return;
    useDashboard.setState({ status: "ended" });
    void refreshMetrics();
  });

  socket.on("stream:error", ({ error }) => useDashboard.setState({ liveNotice: error }));
}

/** Starts a fresh live run on the server: a new random seed unless one is given. */
export function startLive(rate: number, seed?: number) {
  useDashboard.setState({ mode: "live", liveNotice: null });
  socket.emit("stream:start", seed === undefined ? { rate } : { rate, seed });
}

export function stopLive() {
  socket.emit("stream:stop");
}

/** Stops the run if it is going and throws its data away, here and on the server. */
export function clearLive() {
  socket.emit("stream:clear");
  emptyRun();
}

/** Switches what the dashboard plays. Whatever was playing stops and the views start clean. */
export function setMode(mode: "replay" | "live") {
  const s = useDashboard.getState();
  if (s.mode === mode) return;
  if (s.mode === "live" && s.live?.running) stopLive();
  if (s.mode === "replay" && s.status === "playing") socket.emit("replay:stop");
  currentRun = null;
  riskOf.clear();
  socket.dispatch("replay:reset", undefined);
  useDashboard.setState({
    mode,
    status: "idle",
    window: mode === "replay" ? s.replayWindow : null,
    clock: mode === "replay" ? (s.replayWindow?.start ?? null) : null,
    liveMetrics: null,
    liveNotice: null,
  });
}
