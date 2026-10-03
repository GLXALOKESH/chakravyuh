// Which data the client runs on.
//
// NEXT_PUBLIC_DATA_SOURCE picks it: "live" always uses the Express server,
// "mock" always uses the demo built into the client, and "auto" (the default)
// asks the server's /health and falls back to the demo if it does not answer,
// so the dashboard still works at a venue where the server is not running.
//
// A server started with USE_MOCKS=true counts as not answering: it has no
// replay and no ledger, so the dashboard could not stream from it.

import type { DataSource } from "./types";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");
const CHOICE = process.env.NEXT_PUBLIC_DATA_SOURCE ?? "auto";
const HEALTH_TIMEOUT_MS = 2000;

let resolved: Promise<DataSource> | null = null;

export interface ServerHealth {
  ok?: boolean;
  mocks?: boolean;
  /** Started with STREAM_ONLY: live mode works, there is no stored data to replay. */
  stream_only?: boolean;
}
let health: ServerHealth | null = null;

async function ask(): Promise<DataSource> {
  if (CHOICE === "mock") return "mock";
  try {
    const res = await fetch(`${API_URL}/health`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
    health = (await res.json()) as ServerHealth;
    if (CHOICE === "live") return "live";
    return res.ok && health.ok && !health.mocks ? "live" : "mock";
  } catch {
    return CHOICE === "live" ? "live" : "mock";
  }
}

/** What the server said about itself when the source was decided. */
export const serverHealth = () => health;

/** Decided once per page load. */
export function dataSource(): Promise<DataSource> {
  resolved ??= ask();
  return resolved;
}
