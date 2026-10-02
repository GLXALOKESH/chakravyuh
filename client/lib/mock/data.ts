// The demo dataset behind the mock API and the mock socket. It is read from
// demo.json, which scripts/import-pipeline.mjs builds from the ML pipeline's
// output; re-run that script to refresh it.

import type { Alert, GeoPoint, Identifier, Metrics, Recruit, ReplayWindow, Signal, Txn } from "../types";
import demo from "./demo.json";

export interface MockAccount {
  id: string;
  holder: string;
  bank: string;
  home: GeoPoint | null;
  opened_at: string;
  opening_balance: number;
  risk_v1: number;
  risk_v2: number;
  signals: Signal[];
  ring_id: string | null;
  role: string | null;
  role_reason: string | null;
}

export interface MockRing {
  id: string;
  risk: number;
  volume: number;
  geo_spread_km: number;
  member_ids: string[];
  edges: { from: string; to: string; amount: number; count: number }[];
  identity_links: { identifier: string; type: string; account_ids: string[] }[];
  victim_txn_ids: string[];
}

export const mockAccounts = new Map((demo.accounts as MockAccount[]).map((a) => [a.id, a]));
export const mockRings = new Map((demo.rings as MockRing[]).map((r) => [r.id, r]));
export const mockIdentifiers = demo.identifiers as Identifier[];
export const mockAlerts = (demo.alerts as Alert[]).slice().sort((a, b) => a.fired_at.localeCompare(b.fired_at));
export const mockTransactions = demo.transactions as Txn[];
export const mockRecruits = demo.recruits as Record<string, Recruit[]>;
export const mockWindow: ReplayWindow = demo.window;
export const mockMetrics: Metrics = demo.metrics;
