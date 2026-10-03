/**
 * Transactions (TRD section 6).
 *
 * `from` and `to` are the contract's own names. They are SQL keywords, which is
 * why the previous relational schema had to call them from_account and to_account
 * and map them back on every read; MongoDB has no such restriction, so the
 * document is stored exactly as TRD section 6 shows it.
 *
 * is_fraud is ground truth and is absent from every read projection in this
 * file: TRD section 6 states it is never sent to the dashboard, the domain
 * Transaction type has no field for it, and every query below names its columns
 * rather than reading the document whole.
 */
import { CASH_ACCOUNT_ID } from '../constants/index.js';
import { Transaction } from '../models/index.js';
import { logQuery } from '../utilities/db-log.util.js';
import { toReplayTxn, toTransaction, type TransactionRow } from '../mappers/row.mapper.js';
import { insertBatches } from './bulk.repository.js';
import type { TransactionWrite, Writer } from '../interfaces/repository.interface.js';
import type { Transaction as Txn } from '../interfaces/domain.interface.js';

/** Everything a read is allowed to return. is_fraud is not on this list. */
const PUBLIC = '_id from to amount ts channel location';

/** The `txn` socket payload of TRD section 8, and nothing more. */
const REPLAY_COLUMNS = '_id from to amount ts channel';

export const getById = async (id: string): Promise<Txn | null> => {
  const row = await logQuery(Transaction.findById(id).select(PUBLIC).lean());
  return row ? toTransaction(row as unknown as TransactionRow) : null;
};

/**
 * Every transaction in timestamp order. This is what the replay engine replays.
 *
 * Two things are deliberate here. The projection is the six columns TRD section
 * 8 puts in the `txn` socket event, so the replay query does not read `location`
 * for five thousand rows it will never place on a map. And the order is part of
 * the contract: ts, then _id as a tiebreak, because two transactions can share a
 * timestamp and the replay must still be deterministic.
 */
export const listOrdered = async (
  options: { asOf?: Date | null; fromId?: string | null; limit?: number | null } = {},
): Promise<ReturnType<typeof toReplayTxn>[]> => {
  const { asOf = null, fromId = null, limit = null } = options;
  const filter: Record<string, unknown> = {};

  if (asOf) filter.ts = { $lte: asOf };
  if (fromId) {
    // "Everything after this transaction" means strictly later than its own
    // timestamp. An unknown id simply contributes no cursor rather than
    // returning nothing, so a stale checkpoint cannot silently stall a caller.
    const anchor = await logQuery(Transaction.findById(fromId).select('ts').lean());
    if (anchor) {
      const after = { ts: { $gt: anchor.ts } };
      filter.ts = asOf ? { $and: [{ ts: { $lte: asOf } }, after] } : after;
    }
  }

  const query = Transaction.find(filter).select(REPLAY_COLUMNS).sort({ ts: 1, _id: 1 });
  if (limit) query.limit(limit);
  const rows = await logQuery(query.lean());
  return (rows as unknown as TransactionRow[]).map(toReplayTxn);
};

/**
 * Cash-out withdrawals by ring members, for the map tab.
 *
 * The member list is passed in rather than looked up, because a cash-out is a
 * transfer to the CASH sentinel, which is not an accounts document and so cannot
 * be reached through a reference.
 *
 * Rows without a location are filtered out here instead of in the query. In
 * MongoDB `location: { $ne: null }` also excludes missing fields, and it cannot
 * express "has a usable city", which is the actual requirement. The volume here
 * is small enough that the extra rows in memory do not matter.
 */
export const cashoutsForRing = async (memberIds: string[]): Promise<Txn[]> => {
  if (!memberIds.length) return [];
  const rows = await logQuery(Transaction.find({ channel: 'ATM', from: { $in: memberIds } })
    .select(PUBLIC)
    .sort({ ts: 1, _id: 1 })
    .lean());
  const located = (rows as unknown as TransactionRow[]).filter(
    (r) => r.location !== null && typeof r.location === 'object',
  );
  return located.map(toTransaction);
};

/** Most recent activity touching an account, for the entity panel. */
export const recentForAccount = async (accountId: string, limit = 10): Promise<Txn[]> => {
  const rows = await logQuery(Transaction.find({ $or: [{ from: accountId }, { to: accountId }] })
    .select(PUBLIC)
    .sort({ ts: -1, _id: -1 })
    .limit(limit)
    .lean());
  return (rows as unknown as TransactionRow[]).map(toTransaction);
};

// countDocuments rather than estimatedDocumentCount: the seed reports these
// counts and the tests assert them, so an estimate that may lag a write is not
// good enough.
export const count = async (): Promise<number> => logQuery(Transaction.countDocuments({}));

/**
 * A page of transactions, oldest first, for GET /api/transactions.
 *
 * The dashboard asked not to receive the whole ledger at once: the pipeline
 * writes several thousand rows and the frontend only ever renders a slice. This
 * is offset pagination rather than a cursor because the frontend pages a list a
 * human is scrolling, and needs a real page number to render "page 3 of 40".
 *
 * Sort is `{ ts: 1, _id: 1 }`, matching listOrdered, so a page boundary cannot
 * show the same transaction twice or skip one when several share a timestamp.
 * That tiebreak is why this cannot simply sort on `ts`.
 */
export const listPage = async (
  page = 1,
  limit = 50,
): Promise<{ rows: Txn[]; total: number; page: number; pages: number }> => {
  const [total, rows] = await Promise.all([
    logQuery(Transaction.countDocuments({})),
    logQuery(Transaction.find({})
      .select(PUBLIC)
      .sort({ ts: 1, _id: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean()),
  ]);

  return {
    rows: (rows as unknown as TransactionRow[]).map(toTransaction),
    total,
    page,
    pages: Math.ceil(total / limit),
  };
};

/** True when any transaction is a cash-out, used by the fixture invariants. */
export const isCashAccount = (id: string): boolean => id === CASH_ACCOUNT_ID;

export const insertMany = async (rows: TransactionWrite[], tx?: Writer): Promise<void> => {
  await insertBatches(
    Transaction,
    rows.map((t) => ({
      _id: t.id,
      from: t.from,
      to: t.to,
      amount: t.amount,
      ts: new Date(t.ts),
      channel: t.channel,
      location: (t.location ?? null) as TransactionRow['location'],
      // Ground truth. Written here, never read back out through a projection.
      is_fraud: Boolean(t.is_fraud),
    })),
    tx,
  );
};
