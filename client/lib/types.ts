// Shapes follow the server's responses (docs/API_FOR_FRONTEND.md, TRD
// section 8). lib/live/api.ts maps the wire onto these: roles are normalised
// and an alert without a ring is dropped. Anything marked "mock-only" is not
// in the contract and only exists in the in-browser demo.

export type Role = "source" | "mule" | "relay" | "cashout" | "coordinator" | "member";

export interface Alert {
  id: string;
  ring_id: string;
  fired_at: string;
  risk: number;
  members: number;
  volume: number;
  reason: string;
  /** P2 (F13): estimated minutes until cash-out when the alert fired. */
  cashout_eta_min?: number;
  /** Live mode: whether the alert fired before any of the ring's cash was withdrawn. */
  before_cashout?: boolean;
}

/**
 * `victim` and `cash` are not in the API's ring graph: the client adds them
 * (see lib/ring.ts) so a formation has a centre and a rim.
 */
export type RingNodeType = "account" | "device" | "phone" | "ip" | "victim" | "cash";

export interface RingNode {
  id: string;
  type: RingNodeType;
  role?: Role;
  risk?: number;
}

export interface RingEdge {
  source: string;
  target: string;
  kind: "txn" | "identity";
  /** Only on `txn` edges. */
  amount?: number;
  /** How many transfers the edge stands for; only on `txn` edges. */
  count?: number;
}

/** GET /rings/:id */
export interface RingDetail {
  id: string;
  risk: number;
  volume: number;
  nodes: RingNode[];
  edges: RingEdge[];
  victim_txn_ids: string[];
  /** Live mode: rings grow as the run plays, and each change is a new version. */
  version?: number;
}

export interface GeoPoint {
  city: string;
  lat: number;
  lng: number;
}

export interface Txn {
  id: string;
  from: string;
  to: string;
  amount: number;
  ts: string;
  channel: "UPI" | "IMPS" | "NEFT" | "ATM";
  /**
   * Where an ATM withdrawal happened. The ledger (GET /transactions) has it;
   * the socket's `txn` event does not, so the replay fills it in from the ledger.
   */
  location?: GeoPoint | null;
}

export interface Signal {
  feature: string;
  /** The plain sentence shown to the investigator. */
  label: string;
  weight: number;
}

export interface Identifier {
  id: string;
  type: "device" | "phone" | "ip";
  account_ids: string[];
}

/** GET /accounts/:id */
export interface AccountDetail {
  id: string;
  holder: string | null;
  bank: string | null;
  home: GeoPoint | null;
  opened_at: string | null;
  opening_balance?: number;
  /** 17 model features today, free-form: render whatever is present. */
  features?: Record<string, number>;
  risk_v1: number | null;
  risk_v2: number | null;
  signals: Signal[];
  ring_id: string | null;
  role: Role | null;
  role_reason: string | null;
  linked_identifiers: Identifier[];
  /** Newest first, capped by the server. */
  recent_transactions?: Txn[];
}

/** GET /rings/:id/taint */
export interface TaintResult {
  victim_amount: number;
  as_of: string | null;
  cached: boolean;
  accounts: { id: string; balance: number; tainted: number; lien: number }[];
  lost_to_cash: number;
  links: { source: string; target: string; value: number }[];
}

/** POST /rings/:id/freeze */
export interface FreezeRequest {
  k: number;
  exclude: string[];
  txn?: string;
  as_of?: string;
}

export interface FreezeResult {
  freeze: string[];
  at_risk_before: number;
  secured: number;
  /** 0 to 1. */
  pct_stopped: number;
  cached: boolean;
  /** No tainted money has reached a cash-out point yet: a real state, not an error. */
  nothing_at_risk?: boolean;
}

/** POST /rings/:id/evidence. The answer is a PDF. */
export interface EvidenceRequest {
  /** The ring diagram as a base64 PNG data URL. */
  graph_png?: string;
  txn?: string;
  as_of?: string;
}

/** GET /replay/state, and the socket's `replay:state`. */
export interface ReplayState {
  running: boolean;
  speed: number;
  progress: number;
  emitted: number;
  queued: number;
  pending_alerts: number;
  clock: string | null;
}

/** GET /rings/:id/recruits */
export interface Recruit {
  id: string;
  probability: number;
  reasons: string[];
}

/** GET /rings/:id/geo */
export interface RingGeo {
  spread_km: number;
  cities: number;
  homes: ({ account_id: string } & GeoPoint)[];
  cashouts: ({ txn_id: string; account_id: string; amount: number; ts: string } & GeoPoint)[];
}

export interface MetricsRow {
  model: string;
  pr_auc: number | null;
  ring_recall: number | null;
  pattern_d_recall: number | null;
}

export interface Metrics {
  rows: MetricsRow[];
  note: string;
}

/** mock-only: the time span the replay covers, so the tick strip has a scale. */
export interface ReplayWindow {
  start: string;
  end: string;
}

export type ViewMode = "police" | "bank";

/** Where the data comes from: the Express server, or the demo built into the client. */
export type DataSource = "live" | "mock";

/**
 * What the dashboard plays: the stored, pre-analysed data replayed, or a live
 * run where the data is generated, scored and grouped into rings as it plays.
 */
export type PlayMode = "replay" | "live";

/** One account's latest score from the live predictor. */
export interface ScoreUpdate {
  id: string;
  risk: number;
  risk_v1: number;
  risk_v2: number;
  band: string;
  provisional: boolean;
  signals?: Signal[];
}

/** The server's live run, from `stream:state` (docs/STREAMING.md). */
export interface StreamState {
  mode: "live" | "idle";
  running: boolean;
  run_id: string | null;
  seed: number | null;
  rate: number | null;
  sim_start: string | null;
  sim_end: string | null;
  clock: string | null;
  ended: string | null;
  counts: { txns: number; accounts: number; scored: number; high_risk: number; rings: number; alerts: number };
  predictor: { status: "idle" | "starting" | "ok" | "lagging" | "down"; pending_txns: number; last_error: string | null; took_ms: number | null };
  generator: { status: "idle" | "running" | "exited" | "failed" | "external"; pid: number | null };
}

/** The live predictor scored against the generator's ground truth, which only the server holds. */
export interface LiveMetrics {
  planted: number;
  caught: number;
  missed: number;
  false_rings: number;
  median_minutes_to_alert: number | null;
  caught_before_cashout: number;
  flagged_accounts: number;
  flagged_in_rings: number;
  note: string;
}

/** `stream:snapshot`: the live run so far, sent to a dashboard that connects mid-run. */
export interface StreamSnapshot {
  state: StreamState;
  txns: Txn[];
  txns_total: number;
  scores: ScoreUpdate[];
  rings: RingDetail[];
  alerts: Alert[];
  metrics: LiveMetrics;
}
