// The Express server's REST API (docs/API_FOR_FRONTEND.md). Each function is
// one endpoint, and maps the wire shape onto lib/types.ts at the boundary, so
// the views never see a null they did not expect.

import { toRole } from "../role";
import { API_URL } from "../source";
import type {
  AccountDetail,
  Alert,
  EvidenceRequest,
  FreezeRequest,
  FreezeResult,
  Metrics,
  Recruit,
  ReplayState,
  RingDetail,
  RingGeo,
  RingNode,
  LiveMetrics,
  StreamState,
  TaintResult,
  Txn,
} from "../types";

/** An error from the API, with the field messages a 400 carries. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly fields?: Record<string, string[]>,
  ) {
    super(message);
  }
}

async function call(path: string, init?: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...init?.headers },
    });
  } catch {
    throw new ApiError("The server could not be reached.", 0);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; fields?: Record<string, string[]> };
    throw new ApiError(body.error ?? res.statusText, res.status, body.fields);
  }
  return res;
}

const json = async <T>(path: string, init?: RequestInit) => (await call(path, init)).json() as Promise<T>;

const query = (params: Record<string, string | undefined>) => {
  const q = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1]));
  return q.size ? `?${q}` : "";
};

// ---- wire shapes, as the server sends them --------------------------------

export interface WireAlert {
  id: string;
  ring_id: string | null;
  fired_at: string | null;
  reason: string | null;
  risk: number | null;
  members: number;
  volume: number | null;
}

interface WireNode {
  id: string;
  type: "account" | "device" | "phone" | "ip";
  role?: string;
  risk?: number;
}

export interface WireRing {
  id: string;
  risk: number;
  volume: number;
  nodes: WireNode[];
  edges: { source: string; target: string; kind: "txn" | "identity"; amount?: number; count?: number }[];
  victim_txn_ids: string[];
}

type WireAccount = Omit<AccountDetail, "role"> & { role: string | null };

// ---- mapping -------------------------------------------------------------

/** An alert that names no ring has nothing to open, so it is left out. */
export function toAlert(a: WireAlert): Alert | null {
  if (!a.ring_id) return null;
  return {
    id: a.id,
    ring_id: a.ring_id,
    fired_at: a.fired_at ?? new Date(0).toISOString(),
    reason: a.reason ?? "",
    risk: a.risk ?? 0,
    members: a.members,
    volume: a.volume ?? 0,
  };
}

export function toRing(r: WireRing): RingDetail {
  return {
    id: r.id,
    risk: r.risk,
    volume: r.volume,
    nodes: r.nodes.map(
      (n): RingNode => (n.type === "account" ? { id: n.id, type: "account", role: toRole(n.role), risk: n.risk ?? 0 } : { id: n.id, type: n.type }),
    ),
    edges: r.edges.map((e) =>
      e.kind === "txn"
        ? { source: e.source, target: e.target, kind: "txn" as const, amount: e.amount ?? 0, count: e.count ?? 1 }
        : { source: e.source, target: e.target, kind: "identity" as const },
    ),
    victim_txn_ids: r.victim_txn_ids ?? [],
  };
}

// ---- endpoints -----------------------------------------------------------

/**
 * A live run's rings are served under /api/live (docs/STREAMING.md), in the
 * same shapes. Their ids say so; accounts and the ledger are asked for by the
 * caller, since an account id alone cannot tell a live run from the stored data.
 */
export const isLiveId = (id: string) => id.startsWith("LIVE-");
const base = (live: boolean) => (live ? "/api/live" : "/api");
const ringPath = (id: string) => `${base(isLiveId(id))}/rings/${encodeURIComponent(id)}`;

/** GET /api/alerts, newest first. Every alert, fired or not: the replay decides which to show. */
export async function getAlerts(): Promise<Alert[]> {
  return (await json<WireAlert[]>("/api/alerts")).flatMap((a) => toAlert(a) ?? []);
}

export async function getRing(id: string): Promise<RingDetail> {
  const r = await json<WireRing & { version?: number }>(ringPath(id));
  return { ...toRing(r), version: r.version };
}

export async function getAccount(id: string, live = false): Promise<AccountDetail> {
  const a = await json<WireAccount>(`${base(live)}/accounts/${encodeURIComponent(id)}`);
  return { ...a, role: a.ring_id ? toRole(a.role) : null };
}

export function getTaint(id: string, q: { txn?: string; as_of?: string } = {}): Promise<TaintResult> {
  return json<TaintResult>(`${ringPath(id)}/taint${query(q)}`);
}

export function postFreeze(id: string, body: FreezeRequest): Promise<FreezeResult> {
  return json<FreezeResult>(`${ringPath(id)}/freeze`, { method: "POST", body: JSON.stringify(body) });
}

export function getRecruits(id: string): Promise<Recruit[]> {
  return json<Recruit[]>(`${ringPath(id)}/recruits`);
}

export function getRingGeo(id: string): Promise<RingGeo> {
  return json<RingGeo>(`${ringPath(id)}/geo`);
}

export function getMetrics(): Promise<Metrics> {
  return json<Metrics>("/api/metrics");
}

export function getReplayState(): Promise<ReplayState> {
  return json<ReplayState>("/api/replay/state");
}

/** POST /api/rings/:id/evidence: the evidence pack as a PDF. */
export async function postEvidence(id: string, body: EvidenceRequest): Promise<Blob> {
  return (await call(`/api/rings/${encodeURIComponent(id)}/evidence`, { method: "POST", body: JSON.stringify(body) })).blob();
}

const PAGE = 500;

/**
 * The whole ledger, oldest first, from GET /api/transactions in pages of 500.
 * The replay uses it for three things the socket does not carry: the time
 * span it covers, where each ATM withdrawal happened, and the transactions a
 * presenter missed by reloading mid-replay.
 */
export async function getLedger(live = false): Promise<Txn[]> {
  type Page = { rows: Txn[]; total: number; page: number; pages: number };
  const first = await json<Page>(`${base(live)}/transactions?page=1&limit=${PAGE}`);
  const rest = await Promise.all(
    Array.from({ length: Math.max(0, first.pages - 1) }, (_, i) => json<Page>(`${base(live)}/transactions?page=${i + 2}&limit=${PAGE}`)),
  );
  return [first, ...rest].flatMap((p) => p.rows);
}

/** GET /api/stream/state: the server's live run, if any. */
export function getStreamState(): Promise<StreamState> {
  return json<StreamState>("/api/stream/state");
}

/** GET /api/live/metrics: the live predictor scored against the generator's ground truth. */
export function getLiveMetrics(): Promise<LiveMetrics> {
  return json<LiveMetrics>("/api/live/metrics");
}
