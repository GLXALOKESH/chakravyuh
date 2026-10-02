// The only module that fetches data. Swap the mock bodies for real `fetch`
// calls to the Express API (TRD section 8) and nothing else has to change.

import { mockAccounts, mockAlerts, mockMetrics, mockRings, mockWindow } from "./mock/data";
import type { Alert, GraphAccount, Metrics, ReplayWindow, RingDetail } from "./types";

const MOCK_DELAY_MS = 300;

function respond<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(structuredClone(value)), MOCK_DELAY_MS));
}

/** mock-only: the accounts drawn in the overview graph, not in the TRD contract yet. */
export function getAccounts(): Promise<GraphAccount[]> {
  // Read-only and large, so it is handed over without a copy.
  return new Promise((resolve) => setTimeout(() => resolve(mockAccounts), MOCK_DELAY_MS));
}

/** GET /alerts */
export function getAlerts(): Promise<Alert[]> {
  return respond(mockAlerts);
}

/** GET /rings/:id */
export function getRing(id: string): Promise<RingDetail> {
  const ring = mockRings[id];
  if (!ring) return Promise.reject(new Error(`Ring ${id} was not found`));
  return respond(ring);
}

/** GET /metrics */
export function getMetrics(): Promise<Metrics> {
  return respond(mockMetrics);
}

/** mock-only: not in the TRD contract yet. */
export function getReplayWindow(): Promise<ReplayWindow> {
  return respond(mockWindow);
}
