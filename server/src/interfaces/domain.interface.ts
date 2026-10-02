/**
 * Domain and API types.
 *
 * Field names keep the snake_case of TRD section 6 so the dashboard team codes
 * one set of names end to end, with the one documented change that the document
 * store's `_id` is exposed as `id` everywhere.
 *
 * These are the shapes repositories return and controllers hand to mappers. They
 * are deliberately free of Prisma types, so a repository can change its query
 * strategy without touching a controller.
 */
import type { AccountRole, IdentifierTypeValue } from '../constants/index.js';

export interface GeoPoint {
  city: string;
  lat: number;
  lng: number;
}

export interface AccountFeatures {
  amount_in?: number;
  amount_out?: number;
  txn_in?: number;
  txn_out?: number;
  pass_through?: number;
  median_hold_min?: number;
  velocity_per_hr?: number;
  burst_10min?: number;
  counterparty_diversity?: number;
  in_degree?: number;
  out_degree?: number;
  account_age_days?: number;
  atm_share?: number;
  shared_device_n?: number;
  shared_phone_n?: number;
  shared_ip_n?: number;
  shared_any_new_n?: number;
  [key: string]: number | undefined;
}

/** One "why flagged" line in the entity panel, TRD section 6. */
export interface AccountSignal {
  feature: string;
  label: string;
  weight: number;
}

export interface Account {
  id: string;
  holder: string | null;
  bank: string | null;
  home: GeoPoint | null;
  opened_at: string | null;
  opening_balance: number;
  features: AccountFeatures;
  risk_v1: number | null;
  risk_v2: number | null;
  signals: AccountSignal[];
  ring_id: string | null;
  role: AccountRole;
  role_reason: string | null;
}

export interface Identifier {
  id: string;
  type: IdentifierTypeValue;
  account_ids: string[];
}

/**
 * A transaction. `is_fraud` is deliberately absent.
 *
 * TRD section 6 states the ground-truth label is never sent to the dashboard,
 * so it is not part of this interface at all, which is stronger than relying on
 * every mapper remembering to drop it. The write path uses a separate type.
 */
export interface Transaction {
  id: string;
  from: string;
  to: string;
  amount: number;
  ts: string;
  channel: string;
  location: GeoPoint | null;
}

/** Ground truth. Only the seeder and the fixture generator ever handle this. */
export interface TransactionRecord extends Transaction {
  is_fraud: boolean;
}

/**
 * The `txn` socket payload: exactly the six keys TRD section 8 names.
 *
 * Deliberately narrower than Transaction. The replay graph does not place
 * transactions geographically, so location is dropped rather than shipped and
 * ignored. A type that cannot carry the extra field makes the guarantee hold
 * instead of relying on the emitter remembering to strip it.
 */
export type ReplayTxn = Pick<Transaction, 'id' | 'from' | 'to' | 'amount' | 'ts' | 'channel'>;

export interface RingEdge {
  from: string;
  to: string;
  amount: number;
  count: number;
}

export interface RingIdentityLink {
  identifier: string;
  account_ids: string[];
}

export interface TaintAccount {
  id: string;
  balance: number;
  tainted: number;
  lien: number;
}

export interface TaintLink {
  source: string;
  target: string;
  value: number;
}

/** The taint payload of TRD section 8. */
export interface TaintPayload {
  victim_amount: number;
  as_of: string | null;
  cached: boolean;
  accounts: TaintAccount[];
  lost_to_cash: number;
  links: TaintLink[];
}

/** The freeze payload of TRD section 8. */
export interface FreezePayload {
  freeze: string[];
  at_risk_before: number;
  secured: number;
  pct_stopped: number;
  cached: boolean;
}

export interface Ring {
  id: string;
  member_ids: string[];
  edges: RingEdge[];
  identity_links: RingIdentityLink[];
  volume: number;
  risk: number;
  geo_spread_km: number;
  victim_txn_ids: string[];
  /** Cached Python responses, replayed when the ML service is unreachable. */
  default_taint: TaintPayload | null;
  default_freeze: FreezePayload | null;
}

export interface Alert {
  id: string;
  ring_id: string | null;
  fired_at: string | null;
  reason: string | null;
}

/** GET /alerts joins the ring so the list renders without N follow-up calls. */
export interface AlertWithRing extends Alert {
  risk: number | null;
  members: number;
  volume: number | null;
}

export interface Recruit {
  id: string;
  probability: number;
  reasons: string[];
}

export interface MetricRow {
  model: string;
  pr_auc: number;
  ring_recall: number;
  pattern_d_recall: number | null;
  [key: string]: unknown;
}

export interface Metrics {
  rows: MetricRow[];
  note: string;
}

/** GET /rings, the overview the dashboard graph opens with. */
export interface RingSummary {
  id: string;
  risk: number;
  volume: number;
  members: number;
}

export interface GraphNode {
  id: string;
  type: 'account' | 'device' | 'phone' | 'ip';
  role?: AccountRole;
  risk?: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  kind: 'txn' | 'identity';
  amount?: number;
  count?: number;
}

/** The ring graph payload, TRD section 8. */
export interface RingGraph {
  id: string;
  risk: number;
  volume: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
  victim_txn_ids: string[];
}

export interface GeoHome {
  account_id: string;
  city: string;
  lat: number;
  lng: number;
}

export interface GeoCashout {
  txn_id: string;
  account_id: string;
  city: string;
  lat: number;
  lng: number;
  amount: number;
  ts: string | null;
}

export interface RingGeo {
  spread_km: number;
  cities: number;
  homes: GeoHome[];
  cashouts: GeoCashout[];
}

/** GET /accounts/:id, the entity panel. */
export interface AccountDetail extends Account {
  linked_identifiers: Identifier[];
  recent_transactions: Transaction[];
}

export interface ReplayState {
  running: boolean;
  speed: number;
  progress: number;
  emitted: number;
  queued: number;
  pending_alerts: number;
  clock: string | null;
}

/** The ground-truth block the generator writes, logged by the seeder only. */
export interface GroundTruth {
  profile?: string;
  victim_txn_id?: string;
  account_e?: string;
  ring_members?: Record<string, string[]>;
}
