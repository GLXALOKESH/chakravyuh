// Connects the API and the replay socket to the store. It lives outside React
// so the replay keeps its state when the presenter opens a ring and comes back.
//
// Nothing about the rings is known before the replay runs. An alert arrives on
// the socket, the ring it names is fetched, and only then does the dashboard
// learn who is in it.
//
// Against the server, the ledger (GET /transactions) is also read once: it
// gives the span the replay covers, where each ATM withdrawal happened (the
// socket's `txn` has no location), and, after a reload mid-replay, the
// transactions that were sent before this page was open.

import { getAlerts, getLedger, getMetrics, getRing } from "./api";
import { BASE_SPEED } from "./constants";
import { completeRing } from "./ring";
import { socket } from "./socket";
import { dataSource, serverHealth } from "./source";
import { useDashboard } from "./store";
import type { Alert, ReplayState, RingDetail, Txn } from "./types";

export const BIN_COUNT = 320;
/** Against the server, how long a whole replay takes at 1x, in seconds. */
const LIVE_PLAY_SECONDS = 150;

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
/** Replay seconds per real second at 1x. */
let baseSpeed = BASE_SPEED;

// ---- the ledger ------------------------------------------------------------

let ledger: Txn[] = [];
const ledgerById = new Map<string, Txn>();
let ledgerLoad: Promise<void> | null = null;

/** Reads the ledger once per page; later calls share the first. */
export function ensureLedger(): Promise<void> {
  ledgerLoad ??= getLedger()
    .then((rows) => {
      ledger = rows;
      for (const t of rows) ledgerById.set(t.id, t);
    })
    .catch((e: unknown) => {
      ledgerLoad = null;
      throw e;
    });
  return ledgerLoad;
}

/** A ring's victim transactions, so its diagram can start at the victim's real account. */
export async function victimTxnsFor(ring: RingDetail): Promise<Txn[]> {
  const streamed = new Map(history.txns.map((t) => [t.id, t]));
  if (ring.id.startsWith("LIVE-")) {
    // A live ring opened on its own page: the live run's ledger has its victims.
    const missing = ring.victim_txn_ids.filter((id) => !streamed.has(id));
    if (missing.length) {
      const live = await getLedger(true).catch(() => [] as Txn[]);
      for (const t of live) if (missing.includes(t.id)) streamed.set(t.id, t);
    }
    return ring.victim_txn_ids.flatMap((id) => streamed.get(id) ?? []);
  }
  await ensureLedger().catch(() => undefined);
  return ring.victim_txn_ids.flatMap((id) => ledgerById.get(id) ?? streamed.get(id) ?? []);
}

// ---- streaming -------------------------------------------------------------

function binOf(txn: Txn) {
  const win = useDashboard.getState().window;
  if (!win) return -1;
  const at = (Date.parse(txn.ts) - win.start) / (win.end - win.start || 1);
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
export function learnRing(ring: RingDetail) {
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

function ingest(raw: Txn) {
  // The socket's transaction has no location; the ledger's copy does.
  const txn = raw.location === undefined ? { ...raw, location: ledgerById.get(raw.id)?.location ?? null } : raw;
  history.txns.push(txn);
  seenAccounts.add(txn.from);
  seenAccounts.add(txn.to);
  const bin = binOf(txn);
  if (bin < 0) return;
  bins.all[bin]++;
  const ring = ringOfAccount.get(txn.from) ?? ringOfAccount.get(txn.to);
  if (ring) bins.byRing[ring][bin]++;
}

async function onAlert(alert: Alert) {
  const mine = run;
  if (history.alerts.some((a) => a.id === alert.id)) return;
  history.alerts.push(alert);
  useDashboard.setState((s) => ({ alerts: [alert, ...s.alerts] }));
  try {
    const detail = await getRing(alert.ring_id);
    const ring = completeRing(detail, await victimTxnsFor(detail));
    if (mine !== run) return;
    learnRing(ring);
    useDashboard.setState((s) => ({ rings: { ...s.rings, [ring.id]: ring } }));
  } catch (e) {
    useDashboard.setState({ error: e instanceof Error ? e.message : "A ring could not be loaded." });
  }
}

export const countsNow = () => ({ txns: history.txns.length, accounts: seenAccounts.size });

/** Recounts the tick strip after its window changes (live mode stretches it). */
export function rebin() {
  bins.all.fill(0);
  for (const id of Object.keys(bins.byRing)) bins.byRing[id].fill(0);
  for (const txn of history.txns) {
    const bin = binOf(txn);
    if (bin < 0) continue;
    bins.all[bin]++;
    const ring = ringOfAccount.get(txn.from) ?? ringOfAccount.get(txn.to);
    if (ring && bins.byRing[ring]) bins.byRing[ring][bin]++;
  }
}

/** Brings the views up to a server replay that was already under way, from the ledger. */
async function catchUp(state: ReplayState) {
  for (let i = history.txns.length; i < Math.min(state.emitted, ledger.length); i++) ingest(ledger[i]);
  const clock = state.clock ? Date.parse(state.clock) : null;
  if (clock !== null) {
    const fired = (await getAlerts())
      .filter((a) => Date.parse(a.fired_at) <= clock)
      .sort((a, b) => Date.parse(a.fired_at) - Date.parse(b.fired_at));
    await Promise.all(fired.map(onAlert));
  }
  useDashboard.setState({ clock, counts: countsNow() });
}

function wireSocket() {
  socket.on("txn", (txn) => {
    ingest(txn);
    // Someone else (another tab, or a curl) started the server's replay.
    if (useDashboard.getState().status !== "playing") useDashboard.setState({ status: "playing" });
  });

  socket.on("alert", (alert) => {
    if (useDashboard.getState().mode === "replay") void onAlert(alert);
  });

  socket.on("replay:clock", ({ ts }) => {
    if (useDashboard.getState().mode !== "replay") return;
    useDashboard.setState({ clock: Date.parse(ts), counts: countsNow() });
  });

  socket.on("replay:state", (state) => {
    const { status, mode } = useDashboard.getState();
    if (mode !== "replay") return;
    if (state.running) {
      // On (re)connecting: anything sent while the socket was away is in the ledger.
      if (state.emitted > history.txns.length) void catchUp(state);
      if (status !== "playing") useDashboard.setState({ status: "playing" });
    } else if (status === "playing") {
      useDashboard.setState({ status: state.emitted >= state.queued ? "ended" : "paused" });
    }
  });

  socket.on("replay:end", () => {
    if (useDashboard.getState().mode === "replay") useDashboard.setState({ status: "ended" });
  });

  socket.on("replay:error", ({ error }) => useDashboard.setState({ error }));

  socket.on("connection", ({ connected }) => useDashboard.setState({ connected }));

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
  const source = await dataSource();
  if (source === "live") {
    const [{ getReplayState, getStreamState }, { liveBackend }, { wireStream }] = await Promise.all([
      import("./live/api"),
      import("./live/socket"),
      import("./stream"),
    ]);
    wireStream();
    const health = serverHealth();
    const replayAvailable = !health?.stream_only;
    const live = await getStreamState().catch(() => null);
    useDashboard.setState({ source, replayAvailable, liveAvailable: true, live });
    if (replayAvailable) {
      const [metrics, state] = await Promise.all([getMetrics(), getReplayState(), ensureLedger()]);
      const start = Date.parse(ledger[0]?.ts ?? new Date().toISOString());
      const end = Date.parse(ledger.at(-1)?.ts ?? new Date().toISOString());
      baseSpeed = Math.max(1, Math.round((end - start) / 1000 / LIVE_PLAY_SECONDS));
      const replayWindow = { start, end: Math.max(end, start + 1) };
      useDashboard.setState({ metrics, replayWindow, window: replayWindow, clock: start });
      // Catch up before listening, so what was sent earlier lands before what comes next.
      if (state.emitted > 0) {
        await catchUp(state);
        useDashboard.setState({ status: state.running ? "playing" : state.emitted >= state.queued ? "ended" : "paused" });
      }
    }
    // A server with no stored data, or one already in a live run, opens in live mode;
    // the run itself arrives as a snapshot once the socket connects.
    if (!replayAvailable || live?.running) useDashboard.setState({ mode: "live", window: null, clock: null });
    socket.attach(liveBackend(socket.dispatch));
  } else {
    const [{ getReplayWindow }, { mockBackend }] = await Promise.all([import("./mock/api"), import("./mock/socket")]);
    const [metrics, win] = await Promise.all([getMetrics(), getReplayWindow()]);
    baseSpeed = BASE_SPEED;
    socket.attach(mockBackend(socket.dispatch));
    const start = Date.parse(win.start);
    useDashboard.setState({
      source,
      metrics,
      replayAvailable: true,
      liveAvailable: false,
      replayWindow: { start, end: Date.parse(win.end) },
      window: { start, end: Date.parse(win.end) },
      clock: useDashboard.getState().clock ?? start,
    });
  }
  useDashboard.setState({ ready: true, error: null });
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
  const { speed, ready, status, source, mode, replayAvailable } = useDashboard.getState();
  if (!ready || status === "playing" || mode !== "replay" || !replayAvailable) return;
  // The server always plays from the first transaction, so the views start over too.
  if (source === "live" && status !== "idle") socket.dispatch("replay:reset", undefined);
  socket.emit("replay:start", { speed: Math.max(1, Math.round(speed * baseSpeed)) });
  useDashboard.setState({ status: "playing" });
}

/** Starts the replay once the case data has loaded, unless it is already under way. */
export function playWhenReady() {
  const start = () => {
    const s = useDashboard.getState();
    if (s.status !== "idle") return;
    // In live mode that means a fresh live run, unless one is already going.
    if (s.mode === "live") {
      if (!s.live?.running) void import("./stream").then(({ startLive }) => startLive(s.liveRate));
    } else {
      play();
    }
  };
  if (useDashboard.getState().ready) return start();
  const stop = useDashboard.subscribe((s) => {
    if (!s.ready) return;
    stop();
    start();
  });
}

/** In the demo this pauses; the server has no pause, so there it stops the run. */
export function pause() {
  socket.emit("replay:stop");
  useDashboard.setState({ status: "paused" });
}

export function restart() {
  socket.emit("replay:reset");
  useDashboard.setState({ status: "idle" });
}

/** The server's speed is set when a run starts, so live it can only change between runs. */
export function setSpeed(speed: number) {
  const { status, source } = useDashboard.getState();
  if (source === "live" && status === "playing") return;
  useDashboard.setState({ speed });
  if (status === "playing") socket.emit("replay:start", { speed: Math.round(speed * baseSpeed) });
}
