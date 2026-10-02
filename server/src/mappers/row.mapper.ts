/**
 * Stored document -> domain object.
 *
 * Mappers are the only place that knows both shapes, and repositories cast their
 * lean results to the `*Row` types declared here at the one boundary where a
 * query becomes an object. Keeping the conversion here means TRD section 6's
 * rule that is_fraud never reaches the dashboard is enforced by construction: the
 * transaction mapper has no way to include it, because the domain Transaction
 * type has no such field and the Row type it reads from does not either.
 *
 * Two things every row needs and MongoDB hands over as something else: the
 * string _id becomes `id`, and a BSON date becomes the contract's second-
 * precision ISO string.
 */
import { toAccountRole } from '../constants/index.js';
import { asArray, asRecord, iso } from '../utilities/serialize.util.js';
import type {
  Account,
  Alert,
  FreezePayload,
  GeoPoint,
  Identifier,
  ReplayTxn,
  Ring,
  RingEdge,
  RingIdentityLink,
  TaintPayload,
  Transaction,
} from '../interfaces/domain.interface.js';
import type { IdentifierTypeValue } from '../constants/index.js';

/** A lean account document, restricted to what the mapper reads. */
export interface AccountRow {
  _id: string;
  holder?: string | null;
  bank?: string | null;
  home?: GeoPoint | null;
  opened_at?: Date | string | null;
  opening_balance?: number | null;
  features?: unknown;
  risk_v1?: number | null;
  risk_v2?: number | null;
  signals?: unknown;
  ring_id?: string | null;
  role?: string | null;
  role_reason?: string | null;
}

/** A lean transaction document. is_fraud is absent by design. */
export interface TransactionRow {
  _id: string;
  from: string;
  to: string;
  amount: number;
  ts: Date | string;
  channel: string;
  location?: GeoPoint | null;
}

export interface IdentifierRow {
  _id: string;
  type: string;
  account_ids?: string[] | null;
}

export interface AlertRow {
  _id: string;
  ring_id?: string | null;
  fired_at?: Date | string | null;
  reason?: string | null;
}

export interface RingRow {
  _id: string;
  member_ids?: string[] | null;
  edges?: unknown;
  identity_links?: unknown;
  volume?: number | null;
  risk?: number | null;
  geo_spread_km?: number | null;
  victim_txn_ids?: string[] | null;
  default_taint?: unknown;
  default_freeze?: unknown;
}

export const toAccount = (row: AccountRow): Account => ({
  id: row._id,
  holder: row.holder ?? null,
  bank: row.bank ?? null,
  home: asRecord<Account['home']>(row.home, null),
  opened_at: iso(row.opened_at),
  opening_balance: row.opening_balance ?? 0,
  features: asRecord<Account['features']>(row.features, {}),
  risk_v1: row.risk_v1 ?? null,
  risk_v2: row.risk_v2 ?? null,
  signals: asArray<Account['signals'][number]>(row.signals),
  ring_id: row.ring_id ?? null,
  role: toAccountRole(row.role),
  role_reason: row.role_reason ?? null,
});

export const toTransaction = (row: TransactionRow): Transaction => ({
  id: row._id,
  from: row.from,
  to: row.to,
  amount: row.amount,
  ts: iso(row.ts) ?? '',
  channel: String(row.channel),
  location: asRecord<Transaction['location']>(row.location, null),
});

/**
 * The `txn` socket payload, TRD section 8.
 *
 * Returns only the six named keys, so the projection is a compiler-enforced
 * consequence of the return type rather than a thing the emitter has to
 * remember: location cannot appear here because ReplayTxn has nowhere to put it.
 */
export const toReplayTxn = (row: TransactionRow): ReplayTxn => ({
  id: row._id,
  from: row.from,
  to: row.to,
  amount: row.amount,
  ts: iso(row.ts) ?? '',
  channel: String(row.channel),
});

export const toIdentifier = (row: IdentifierRow): Identifier => ({
  id: row._id,
  type: row.type as IdentifierTypeValue,
  account_ids: row.account_ids ?? [],
});

export const toAlert = (row: AlertRow): Alert => ({
  id: row._id,
  ring_id: row.ring_id ?? null,
  fired_at: iso(row.fired_at),
  reason: row.reason ?? null,
});

export const toRing = (row: RingRow): Ring => ({
  id: row._id,
  member_ids: row.member_ids ?? [],
  edges: asArray<RingEdge>(row.edges, []),
  identity_links: asArray<RingIdentityLink>(row.identity_links, []),
  volume: row.volume ?? 0,
  risk: row.risk ?? 0,
  geo_spread_km: row.geo_spread_km ?? 0,
  victim_txn_ids: row.victim_txn_ids ?? [],
  default_taint: asRecord<TaintPayload | null>(row.default_taint, null),
  default_freeze: asRecord<FreezePayload | null>(row.default_freeze, null),
});