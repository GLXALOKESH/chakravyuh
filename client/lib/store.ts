import { create } from "zustand";
import type { Alert, DataSource, LiveMetrics, Metrics, PlayMode, RingDetail, StreamState, ViewMode } from "./types";

export type ReplayStatus = "idle" | "playing" | "paused" | "ended";

interface DashboardState {
  /** The server, or the demo built into the client; null until decided. */
  source: DataSource | null;
  /** Whether the server's replay socket is connected; null in the demo or before it tries. */
  connected: boolean | null;
  ready: boolean;
  error: string | null;
  /** Replay of the stored data, or a live run (lib/stream.ts). */
  mode: PlayMode;
  /** Whether the server has stored data to replay (not when it runs STREAM_ONLY, nor in the demo). */
  replayAvailable: boolean;
  /** Whether the server can run live mode (not in the built-in demo). */
  liveAvailable: boolean;
  /** The replay's window, kept while live mode borrows `window`. */
  replayWindow: { start: number; end: number } | null;
  /** The server's live run. */
  live: StreamState | null;
  liveMetrics: LiveMetrics | null;
  /** A problem with the live run worth showing, short of an error. */
  liveNotice: string | null;
  /** Rate (simulated seconds per real second) for the next live run. */
  liveRate: number;
  status: ReplayStatus;
  speed: number;
  window: { start: number; end: number } | null;
  clock: number | null;
  /** Alerts that have fired so far in this replay, newest first. */
  alerts: Alert[];
  rings: Record<string, RingDetail>;
  metrics: Metrics | null;
  counts: { txns: number; accounts: number };
  /** Ring being pointed at; everything else on the stage dims. */
  focusRing: string | null;
  view: ViewMode;
  /** What the dashboard stage shows. */
  stage: "graph" | "map";
  setStage: (stage: "graph" | "map") => void;
  setFocusRing: (id: string | null) => void;
  setView: (view: ViewMode) => void;
}

export const useDashboard = create<DashboardState>((set) => ({
  source: null,
  connected: null,
  ready: false,
  error: null,
  mode: "replay",
  replayAvailable: true,
  liveAvailable: false,
  replayWindow: null,
  live: null,
  liveMetrics: null,
  liveNotice: null,
  liveRate: 300,
  status: "idle",
  speed: 1,
  window: null,
  clock: null,
  alerts: [],
  rings: {},
  metrics: null,
  counts: { txns: 0, accounts: 0 },
  focusRing: null,
  view: "police",
  stage: "graph",
  setStage: (stage) => set({ stage }),
  setFocusRing: (focusRing) => set({ focusRing }),
  setView: (view) => set({ view }),
}));
