import { create } from "zustand";
import type { Alert, Metrics, RingDetail, ViewMode } from "./types";

export type ReplayStatus = "idle" | "playing" | "paused" | "ended";

interface DashboardState {
  ready: boolean;
  error: string | null;
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
  ready: false,
  error: null,
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
