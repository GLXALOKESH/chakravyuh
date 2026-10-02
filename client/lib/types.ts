// Shapes follow TRD section 8. Anything marked "mock-only" is not in the
// contract yet and needs the backend owner's agreement.

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
  amount?: number;
}

/** GET /rings/:id */
export interface RingDetail {
  id: string;
  risk: number;
  volume: number;
  nodes: RingNode[];
  edges: RingEdge[];
  victim_txn_ids: string[];
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
  /** mock-only on the socket: where an ATM withdrawal happened, for the map. */
  location?: GeoPoint;
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
  holder: string;
  bank: string;
  home: GeoPoint | null;
  opened_at: string;
  risk_v1: number;
  risk_v2: number;
  signals: Signal[];
  ring_id: string | null;
  role: Role | null;
  role_reason: string | null;
  linked_identifiers: Identifier[];
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
  pct_stopped: number;
  cached: boolean;
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
