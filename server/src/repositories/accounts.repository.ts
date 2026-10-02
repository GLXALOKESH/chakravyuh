/**
 * Accounts (TRD section 6).
 *
 * Column names keep the snake_case of the document (risk_v1, ring_id,
 * role_reason) so the dashboard team codes one set of names, with the single
 * documented change that the document store's `_id` is exposed as `id`.
 */
import { prisma } from '../configs/prisma.js';
import { Prisma } from './prisma/client.js';
import { INSERT_BATCH_SIZE } from '../constants/index.js';
import { chunk } from '../utilities/serialize.util.js';
import { toAccount } from '../mappers/row.mapper.js';
import type { AccountWrite, Writer } from '../interfaces/repository.interface.js';
import type { Account } from '../interfaces/domain.interface.js';

const writer = (tx?: Writer) => tx ?? prisma();

export const getById = async (id: string): Promise<Account | null> => {
  const row = await prisma().account.findUnique({ where: { id } });
  return row ? toAccount(row) : null;
};

/**
 * Fetches many accounts at once, preserving the caller's order.
 *
 * Ring member order is meaningful for the demo, and a relational lookup by id
 * has no inherent order, so the ordering is applied here rather than asked of
 * the database.
 */
export const listByIds = async (ids: string[]): Promise<Account[]> => {
  if (!ids.length) return [];
  const rows = await prisma().account.findMany({ where: { id: { in: ids } } });
  const byId = new Map(rows.map((r) => [r.id, toAccount(r)]));
  return ids.map((id) => byId.get(id)).filter((a): a is Account => Boolean(a));
};

export const listByRing = async (ringId: string): Promise<Account[]> => {
  const rows = await prisma().account.findMany({ where: { ringId }, orderBy: { id: 'asc' } });
  return rows.map(toAccount);
};

/** Node projection for the ring graph (TRD section 8). */
export const graphNodesForRing = async (ringId: string) => {
  const rows = await prisma().account.findMany({
    where: { ringId },
    orderBy: { id: 'asc' },
    select: { id: true, role: true, riskV2: true },
  });
  return rows.map((r) => ({ id: r.id, role: r.role, risk_v2: r.riskV2 }));
};

export const count = async (): Promise<number> => prisma().account.count();

/**
 * Bulk insert, used by the seeder.
 *
 * createMany rather than a loop of upserts: the seeder truncates first, so
 * there is nothing to merge, and one statement per thousand rows keeps the
 * statement under Postgres's 65535 bind-parameter ceiling.
 *
 * `skipDuplicates` makes a re-run a no-op rather than an error, which is what
 * TRD section 9 asks for.
 */
export const insertMany = async (rows: AccountWrite[], tx?: Writer): Promise<void> => {
  const db = writer(tx);
  for (const batch of chunk(rows, INSERT_BATCH_SIZE)) {
    if (!batch.length) continue;
    await db.account.createMany({
      skipDuplicates: true,
      data: batch.map((a) => ({
        id: a.id,
        holder: a.holder,
        bank: a.bank,
        // DbNull is SQL NULL. Plain null on a Json column is ambiguous between
        // SQL NULL and JSON null, and home is nullable, so it is explicit.
        home: a.home === null || a.home === undefined ? Prisma.DbNull : (a.home as Prisma.InputJsonValue),
        openedAt: a.opened_at ? new Date(a.opened_at) : null,
        openingBalance: a.opening_balance,
        features: (a.features ?? {}) as Prisma.InputJsonValue,
        riskV1: a.risk_v1,
        riskV2: a.risk_v2,
        signals: (a.signals ?? []) as Prisma.InputJsonValue,
        ringId: a.ring_id,
        role: a.role,
        roleReason: a.role_reason,
      })),
    });
  }
};
