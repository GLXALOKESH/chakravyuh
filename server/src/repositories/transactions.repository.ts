/**
 * Transactions (TRD section 6).
 *
 * `from` and `to` are SQL keywords, so they are stored as from_account and
 * to_account and mapped back on the way out.
 *
 * is_fraud is ground truth and is absent from every read projection in this
 * file: TRD section 6 states it is never sent to the dashboard, and the
 * Transaction domain type has no field for it, so the mapper cannot leak it.
 */
import { prisma } from '../configs/prisma.js';
import { Prisma } from './prisma/client.js';
import { CASH_ACCOUNT_ID, INSERT_BATCH_SIZE } from '../constants/index.js';
import { chunk } from '../utilities/serialize.util.js';
import { toReplayTxn, toTransaction } from '../mappers/row.mapper.js';
import type { TransactionWrite, Writer } from '../interfaces/repository.interface.js';
import type { ReplayTxn, Transaction } from '../interfaces/domain.interface.js';

const writer = (tx?: Writer) => tx ?? prisma();

/** Everything a read is allowed to return. is_fraud is not on this list. */
const PUBLIC = {
  id: true,
  fromAccount: true,
  toAccount: true,
  amount: true,
  ts: true,
  channel: true,
  location: true,
} as const;

/** The `txn` socket payload of TRD section 8, and nothing more. */
const REPLAY_COLUMNS = {
  id: true,
  fromAccount: true,
  toAccount: true,
  amount: true,
  ts: true,
  channel: true,
} as const;

export const getById = async (id: string): Promise<Transaction | null> => {
  const row = await prisma().transaction.findUnique({ where: { id }, select: PUBLIC });
  return row ? toTransaction(row) : null;
};

/**
 * Every transaction in timestamp order. This is what the replay engine replays.
 *
 * Two things are deliberate here. The projection is the six columns TRD section
 * 8 puts in the `txn` socket event, so the replay query does not read `location`
 * for five thousand rows it will never place on a map. And the order is part of
 * the contract: ts, then id as a tiebreak, because two transactions can share a
 * timestamp and the replay must still be deterministic.
 */
export const listOrdered = async (
  options: { asOf?: Date | null; fromId?: string | null; limit?: number | null } = {},
): Promise<ReplayTxn[]> => {
  const { asOf = null, fromId = null, limit = null } = options;
  const where: Prisma.TransactionWhereInput = {};
  if (asOf) where.ts = { lte: asOf };
  if (fromId) {
    // "Everything after this transaction" means strictly later than its own
    // timestamp. An unknown id simply contributes no cursor rather than
    // returning nothing, so a stale checkpoint cannot silently stall a caller.
    const anchor = await prisma().transaction.findUnique({ where: { id: fromId }, select: { ts: true } });
    if (anchor) {
      where.AND = where.ts ? [{ ts: { lte: asOf as Date } }, { ts: { gt: anchor.ts } }] : [{ ts: { gt: anchor.ts } }];
      delete where.ts;
    }
  }
  const rows = await prisma().transaction.findMany({
    where,
    select: REPLAY_COLUMNS,
    orderBy: [{ ts: 'asc' }, { id: 'asc' }],
    ...(limit ? { take: limit } : {}),
  });
  return rows.map(toReplayTxn);
};

/**
 * Cash-out withdrawals by ring members, for the map tab.
 *
 * The member list is passed in rather than looked up, because a cash-out is a
 * transfer to the CASH sentinel, which is not a row in accounts and so cannot
 * be reached through a relation.
 *
 * Rows without a location are filtered out here instead of in the query: Prisma's
 * Json null is a distinct sentinel from SQL NULL, and the ATM location column
 * is only meaningful when it is a real object. The volume here is small enough
 * that the extra rows in memory do not matter.
 */
export const cashoutsForRing = async (memberIds: string[]): Promise<Transaction[]> => {
  if (!memberIds.length) return [];
  const rows = await prisma().transaction.findMany({
    where: { channel: 'ATM', fromAccount: { in: memberIds } },
    select: PUBLIC,
    orderBy: [{ ts: 'asc' }, { id: 'asc' }],
  });
  return rows.filter((r) => r.location !== null && typeof r.location === 'object').map(toTransaction);
};

/** Most recent activity touching an account, for the entity panel. */
export const recentForAccount = async (accountId: string, limit = 10): Promise<Transaction[]> => {
  const rows = await prisma().transaction.findMany({
    where: { OR: [{ fromAccount: accountId }, { toAccount: accountId }] },
    select: PUBLIC,
    orderBy: [{ ts: 'desc' }, { id: 'desc' }],
    take: limit,
  });
  return rows.map(toTransaction);
};

export const count = async (): Promise<number> => prisma().transaction.count();

/** True when any transaction is a cash-out, used by the fixture invariants. */
export const isCashAccount = (id: string): boolean => id === CASH_ACCOUNT_ID;

export const insertMany = async (rows: TransactionWrite[], tx?: Writer): Promise<void> => {
  const db = writer(tx);
  for (const batch of chunk(rows, INSERT_BATCH_SIZE)) {
    if (!batch.length) continue;
    await db.transaction.createMany({
      skipDuplicates: true,
      data: batch.map((t) => ({
        id: t.id,
        fromAccount: t.from,
        toAccount: t.to,
        amount: t.amount,
        ts: new Date(t.ts),
        channel: t.channel as Prisma.TransactionCreateManyInput['channel'],
        location:
          t.location === null || t.location === undefined ? Prisma.DbNull : (t.location as Prisma.InputJsonValue),
        // Ground truth. Written here, never read back out through a projection.
        isFraud: Boolean(t.is_fraud),
      })),
    });
  }
};
