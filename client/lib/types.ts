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

/** mock-only: an ordinary account and, when known, where it stands in the overview graph. */
export interface GraphAccount {
  id: string;
  pos?: [x: number, y: number];
}

export interface RingDetail {
  id: string;
  risk: number;
  volume: number;
  /** mock-only: centre and radius of the ring's formation in the overview graph. */
  site?: { x: number; y: number; r: number };
  nodes: RingNode[];
  edges: RingEdge[];
  victim_txn_ids: string[];
}

export interface Txn {
  id: string;
  from: string;
  to: string;
  amount: number;
  ts: string;
  channel: "UPI" | "IMPS" | "NEFT" | "ATM";
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
