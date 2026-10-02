/**
 * Prisma row -> domain object.
 *
 * Mappers are the only place that knows both shapes. Keeping the conversion
 * here means TRD section 6's rule that `is_fraud` never reaches the dashboard
 * is enforced by construction: the transaction mapper has no way to include it,
 * because the domain Transaction type has no such field.
 */
import type { Account as AccountModel, Alert as AlertModel, Ring as RingModel } from '../repositories/prisma/client.js';
import { toAccountRole } from '../constants/index.js';
import { asArray, asRecord, iso } from '../utilities/serialize.util.js';
import type { Account, Alert, ReplayTxn, Ring, RingEdge, RingIdentityLink, TaintPayload, FreezePayload } from '../interfaces/domain.interface.js';

export const toAccount = (row: AccountModel): Account => ({
  id: row.id,
  holder: row.holder,
  bank: row.bank,
  home: asRecord<Account['home']>(row.home, null),
  opened_at: iso(row.openedAt),
  opening_balance: row.openingBalance ?? 0,
  features: asRecord<Account['features']>(row.features, {}),
  risk_v1: row.riskV1,
  risk_v2: row.riskV2,
  signals: asArray(row.signals),
  ring_id: row.ringId,
  role: toAccountRole(row.role),
  role_reason: row.roleReason,
});

export const toTransaction = (row: {
  id: string;
  fromAccount: string;
  toAccount: string;
  amount: number;
  ts: Date;
  channel: string;
  location: unknown;
}) => ({
  id: row.id,
  from: row.fromAccount,
  to: row.toAccount,
  amount: row.amount,
  ts: iso(row.ts) ?? '',
  channel: String(row.channel),
  location: asRecord(row.location, null),
});

/**
 * The `txn` socket payload, TRD section 8.
 *
 * Returns only the six named keys, so the projection is a compiler-enforced
 * consequence of the return type rather than a thing the emitter has to
 * remember: location and is_fraud cannot appear here because ReplayTxn has
 * nowhere to put them.
 */
export const toReplayTxn = (row: {
  id: string;
  fromAccount: string;
  toAccount: string;
  amount: number;
  ts: Date;
  channel: string;
}): ReplayTxn => ({
  id: row.id,
  from: row.fromAccount,
  to: row.toAccount,
  amount: row.amount,
  ts: iso(row.ts) ?? '',
  channel: String(row.channel),
});

export const toIdentifier = (row: { id: string; type: string; accountIds: string[] }) => ({
  id: row.id,
  type: row.type as 'device' | 'phone' | 'ip',
  account_ids: row.accountIds ?? [],
});

export const toAlert = (row: AlertModel): Alert => ({
  id: row.id,
  ring_id: row.ringId,
  fired_at: iso(row.firedAt),
  reason: row.reason,
});

export const toRing = (row: RingModel): Ring => ({
  id: row.id,
  member_ids: row.memberIds ?? [],
  edges: asArray<RingEdge>(row.edges, []),
  identity_links: asArray<RingIdentityLink>(row.identityLinks, []),
  volume: row.volume ?? 0,
  risk: row.risk ?? 0,
  geo_spread_km: row.geoSpreadKm ?? 0,
  victim_txn_ids: row.victimTxnIds ?? [],
  default_taint: asRecord<TaintPayload | null>(row.defaultTaint, null),
  default_freeze: asRecord<FreezePayload | null>(row.defaultFreeze, null),
});
