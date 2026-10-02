// Connects the API and the socket to the store. It lives outside React so the
// replay keeps its state when the presenter opens a ring and comes back.
//
// Nothing about the rings is known before the replay runs. An alert arrives on
// the socket, the ring it names is fetched, and only then does the dashboard
// learn who is in it.

import { getMetrics, getReplayWindow, getRing } from "./api";
import { BASE_SPEED } from "./constants";
import { completeRing } from "./ring";
import { socket } from "./socket";
import { useDashboard } from "./store";
import type { Alert, RingDetail, Txn } from "./types";

export const BIN_COUNT = 320;

/** Transactions per slice of the replay window, for the tick strip. Not reactive. */
export const bins = {
  all: new Uint16Array(BIN_COUNT),
  byRing: {} as Record<string, Uint16Array>,
};

/** Everything streamed so far, so a view that mounts later can catch up. */
export const history: { txns: Txn[]; alerts: Alert[] } = { txns: [], alerts: [] };

const ringOfAccount = new Map<string, string>();
const seenAccounts = new Set<string>();
let started = false;
let loading: Promise<void> | null = null;
/** Bumped on every reset, so a ring fetched for an earlier run is not added to this one. */
let run = 0;

function binOf(txn: Txn) {
  const win = useDashboard.getState().window;
  if (!win) return -1;
  const at = (Date.parse(txn.ts) - win.start) / (win.end - win.start);
  return Math.min(BIN_COUNT - 1, Math.max(0, Math.floor(at * BIN_COUNT)));
}

function clearRun() {
  run++;
  bins.all.fill(0);
  bins.byRing = {};
  history.txns.length = 0;
  history.alerts.length = 0;
  seenAccounts.clear();
  ringOfAccount.clear();
}

/** A ring has just become known: mark its accounts and go back over what has already streamed. */
function learnRing(ring: RingDetail) {
  const strip = new Uint16Array(BIN_COUNT);
  bins.byRing[ring.id] = strip;
  for (const node of ring.nodes) {
    if (node.type === "account" || node.type === "victim") ringOfAccount.set(node.id, ring.id);
  }
  for (const txn of history.txns) {
    if (ringOfAccount.get(txn.from) !== ring.id && ringOfAccount.get(txn.to) !== ring.id) continue;
    const bin = binOf(txn);
    if (bin >= 0) strip[bin]++;
  }
}

async function onAlert(alert: Alert) {
  const mine = run;
  history.alerts.push(alert);
  useDashboard.setState((s) => ({ alerts: [alert, ...s.alerts] }));
  try {
    const detail = await getRing(alert.ring_id);
    if (mine !== run) return;
    const victims = history.txns.filter((t) => detail.victim_txn_ids.includes(t.id));
    const ring = completeRing(detail, victims);
    learnRing(ring);
    useDashboard.setState((s) => ({ rings: { ...s.rings, [ring.id]: ring } }));
  } catch (e) {
    useDashboard.setState({ error: e instanceof Error ? e.message : "A ring could not be loaded." });
  }
}

function wireSocket() {
  socket.on("txn", (txn) => {
    history.txns.push(txn);
    seenAccounts.add(txn.from);
    seenAccounts.add(txn.to);
    const bin = binOf(txn);
    if (bin < 0) return;
    bins.all[bin]++;
    const ring = ringOfAccount.get(txn.from) ?? ringOfAccount.get(txn.to);
    if (ring) bins.byRing[ring][bin]++;
  });

  socket.on("alert", (alert) => void onAlert(alert));

  socket.on("replay:clock", ({ ts }) => {
    useDashboard.setState({
      clock: Date.parse(ts),
      counts: { txns: history.txns.length, accounts: seenAccounts.size },
    });
  });

  socket.on("replay:end", () => useDashboard.setState({ status: "ended" }));

  socket.on("replay:reset", () => {
    clearRun();
    const win = useDashboard.getState().window;
    useDashboard.setState({
      alerts: [],
      rings: {},
      clock: win?.start ?? null,
      counts: { txns: 0, accounts: 0 },
      focusRing: null,
    });
  });
}

async function load() {
  const [metrics, win] = await Promise.all([getMetrics(), getReplayWindow()]);
  const start = Date.parse(win.start);
  useDashboard.setState({
    ready: true,
    error: null,
    metrics,
    window: { start, end: Date.parse(win.end) },
    clock: useDashboard.getState().clock ?? start,
  });
}

export function initDashboard() {
  if (!started) {
    started = true;
    wireSocket();
  }
  if (useDashboard.getState().ready || loading) return;
  loading = load()
    .catch((e: unknown) => {
      useDashboard.setState({ error: e instanceof Error ? e.message : "The data could not be loaded." });
    })
    .finally(() => {
      loading = null;
    });
}

export function play() {
  const { speed, ready } = useDashboard.getState();
  if (!ready) return;
  socket.emit("replay:start", { speed: speed * BASE_SPEED });
  useDashboard.setState({ status: "playing" });
}

/** Starts the replay once the case data has loaded, unless it is already under way. */
export function playWhenReady() {
  const start = () => {
    if (useDashboard.getState().status === "idle") play();
  };
  if (useDashboard.getState().ready) return start();
  const stop = useDashboard.subscribe((s) => {
    if (!s.ready) return;
    stop();
    start();
  });
}

export function pause() {
  socket.emit("replay:stop");
  useDashboard.setState({ status: "paused" });
}

export function restart() {
  socket.emit("replay:reset");
  useDashboard.setState({ status: "idle" });
}

export function setSpeed(speed: number) {
  useDashboard.setState({ speed });
  if (useDashboard.getState().status === "playing") socket.emit("replay:start", { speed: speed * BASE_SPEED });
}
