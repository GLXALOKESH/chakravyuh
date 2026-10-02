import { create } from "zustand";
import type { Alert, GraphAccount, Metrics, RingDetail, ViewMode } from "./types";

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
  /** Ordinary accounts for the overview graph. */
  accounts: GraphAccount[];
  metrics: Metrics | null;
  counts: { txns: number; accounts: number };
  /** Ring being pointed at; everything else on the stage dims. */
  focusRing: string | null;
  view: ViewMode;
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
  accounts: [],
  metrics: null,
  counts: { txns: 0, accounts: 0 },
  focusRing: null,
  view: "police",
  setFocusRing: (focusRing) => set({ focusRing }),
  setView: (view) => set({ view }),
}));
