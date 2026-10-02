// Synthetic demo data for building the dashboard without a backend. It is all
// read from demo.json, which scripts/generate-demo.mjs writes; replace that
// file (same shapes) to run the dashboard on different data.

import type { Alert, GraphAccount, Metrics, ReplayWindow, RingDetail, Txn } from "../types";
import demo from "./demo.json";

export const mockAccounts = demo.accounts as GraphAccount[];

export const mockRings: Record<string, RingDetail> = Object.fromEntries(
  (demo.rings as RingDetail[]).map((r) => [r.id, r]),
);

export const mockAlerts = demo.alerts as Alert[];

export const mockTransactions = demo.transactions as Txn[];

export const mockWindow: ReplayWindow = demo.window;

// Invented for layout. PRODUCT.md: never present these as results.
export const mockMetrics: Metrics = demo.metrics;
