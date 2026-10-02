// Connects the API and the socket to the store. It lives outside React so the
// replay keeps its state when the presenter opens a ring and comes back.

import { getAlerts, getMetrics, getReplayWindow, getRing } from "./api";
import { BASE_SPEED } from "./constants";
import { socket } from "./socket";
import { useDashboard } from "./store";
import type { Alert, Txn } from "./types";

export const BIN_COUNT = 320;

/** Transactions per slice of the replay window, for the tick strip. Not reactive. */
export const bins = {
  all: new Uint16Array(BIN_COUNT),
  byRing: {} as Record<string, Uint16Array>,
};

/** Everything streamed so far, so a remounted graph can catch up. */
export const history: { txns: Txn[]; alerts: Alert[] } = { txns: [], alerts: [] };

const ringOfAccount = new Map<string, string>();
const seenAccounts = new Set<string>();
let started = false;
let loading: Promise<void> | null = null;

function clearRun() {
  bins.all.fill(0);
  Object.values(bins.byRing).forEach((b) => b.fill(0));
  history.txns.length = 0;
  history.alerts.length = 0;
  seenAccounts.clear();
}

function wireSocket() {
  socket.on("txn", (txn) => {
    history.txns.push(txn);
    seenAccounts.add(txn.from);
    if (txn.to !== "CASH") seenAccounts.add(txn.to);

    const win = useDashboard.getState().window;
    if (!win) return;
    const at = (Date.parse(txn.ts) - win.start) / (win.end - win.start);
    const bin = Math.min(BIN_COUNT - 1, Math.max(0, Math.floor(at * BIN_COUNT)));
    bins.all[bin]++;
    const ring = ringOfAccount.get(txn.from) ?? ringOfAccount.get(txn.to);
    if (ring) bins.byRing[ring][bin]++;
  });

  socket.on("alert", (alert) => {
    history.alerts.push(alert);
    useDashboard.setState((s) => ({ alerts: [alert, ...s.alerts] }));
  });

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
    useDashboard.setState({ alerts: [], clock: win?.start ?? null, counts: { txns: 0, accounts: 0 }, focusRing: null });
  });
}

async function load() {
  const [alerts, metrics, win] = await Promise.all([getAlerts(), getMetrics(), getReplayWindow()]);
  // Ring layouts are needed before their alerts fire, so every account can
  // hold one fixed place on the stage for the whole replay.
  const rings = await Promise.all(alerts.map((a) => getRing(a.ring_id)));
  for (const ring of rings) {
    bins.byRing[ring.id] = new Uint16Array(BIN_COUNT);
    for (const node of ring.nodes) {
      if (node.type === "account" || node.type === "victim") ringOfAccount.set(node.id, ring.id);
    }
  }
  const start = Date.parse(win.start);
  useDashboard.setState({
    ready: true,
    error: null,
    metrics,
    rings: Object.fromEntries(rings.map((r) => [r.id, r])),
    window: { start, end: Date.parse(win.end) },
    clock: start,
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
