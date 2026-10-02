/**
 * Accounts (TRD section 6).
 *
 * Field names keep the snake_case of the document (risk_v1, ring_id,
 * role_reason), so the dashboard team codes one set of names and the stored
 * document is the API response with `_id` renamed to `id`.
 */
import { Account } from '../models/index.js';
import { toAccount, type AccountRow } from '../mappers/row.mapper.js';
import { insertBatches } from './bulk.repository.js';
import type { AccountWrite, Writer } from '../interfaces/repository.interface.js';
import type { Account as AccountDomain } from '../interfaces/domain.interface.js';

export const getById = async (id: string): Promise<AccountDomain | null> => {
  const row = await Account.findById(id).lean().exec();
  return row ? toAccount(row as unknown as AccountRow) : null;
};

/**
 * Fetches many accounts at once, preserving the caller's order.
 *
 * Ring member order is meaningful for the demo, and a lookup by id has no
 * inherent order, so the ordering is applied here rather than asked of the
 * database.
 */
export const listByIds = async (ids: string[]): Promise<AccountDomain[]> => {
  if (!ids.length) return [];
  const rows = await Account.find({ _id: { $in: ids } }).lean().exec();
  const byId = new Map((rows as unknown as AccountRow[]).map((r) => [r._id, toAccount(r)]));
  return ids.map((id) => byId.get(id)).filter((a): a is AccountDomain => Boolean(a));
};

export const listByRing = async (ringId: string): Promise<AccountDomain[]> => {
  const rows = await Account.find({ ring_id: ringId }).sort({ _id: 1 }).lean().exec();
  return (rows as unknown as AccountRow[]).map(toAccount);
};

/** Node projection for the ring graph (TRD section 8). */
export const graphNodesForRing = async (ringId: string) => {
  const rows = await Account.find({ ring_id: ringId })
    .select('_id role risk_v2')
    .sort({ _id: 1 })
    .lean()
    .exec();
  return (rows as { _id: string; role: string | null; risk_v2: number | null }[]).map((r) => ({
    id: r._id,
    role: r.role,
    risk_v2: r.risk_v2,
  }));
};

export const count = async (): Promise<number> => Account.countDocuments({}).exec();

/** Bulk insert, used by the seeder. See insertBatches for the batch semantics. */
export const insertMany = async (rows: AccountWrite[], tx?: Writer): Promise<void> => {
  await insertBatches(
    Account,
    rows.map((a) => ({
      _id: a.id,
      holder: a.holder,
      bank: a.bank,
      home: (a.home ?? null) as AccountRow['home'],
      opened_at: a.opened_at ? new Date(a.opened_at) : null,
      opening_balance: a.opening_balance,
      features: a.features ?? {},
      risk_v1: a.risk_v1,
      risk_v2: a.risk_v2,
      signals: (a.signals ?? []) as AccountRow['signals'],
      ring_id: a.ring_id,
      role: a.role,
      role_reason: a.role_reason,
    })),
    tx,
  );
};