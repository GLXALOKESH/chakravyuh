/**
 * Shared identifiers: devices, phones and IPs (TRD section 6).
 *
 * An identifier is one row holding an array of linked accounts rather than a row
 * per link, because the interesting question is never "who is this device" but
 * "which accounts share this device".
 */
import { prisma } from '../configs/prisma.js';
import { toIdentifier } from '../mappers/row.mapper.js';
import type { Writer } from '../interfaces/repository.interface.js';
import type { Identifier } from '../interfaces/domain.interface.js';

const writer = (tx?: Writer) => tx ?? prisma();

export const getById = async (id: string): Promise<Identifier | null> => {
  const row = await prisma().identifier.findUnique({ where: { id } });
  return row ? toIdentifier(row) : null;
};

/**
 * Every identifier touching any of the given accounts, for the entity panel.
 *
 * `hasSome` is the array-overlap operator, so this is one indexed lookup rather
 * than a query per account.
 */
export const listForAccounts = async (accountIds: string[]): Promise<Identifier[]> => {
  if (!accountIds.length) return [];
  const rows = await prisma().identifier.findMany({
    where: { accountIds: { hasSome: accountIds } },
    orderBy: { id: 'asc' },
  });
  return rows.map(toIdentifier);
};

/** Identifier ids linked to one account. */
export const listForAccount = async (accountId: string): Promise<Identifier[]> => {
  const rows = await prisma().identifier.findMany({
    where: { accountIds: { has: accountId } },
    orderBy: { id: 'asc' },
  });
  return rows.map(toIdentifier);
};

export const count = async (): Promise<number> => prisma().identifier.count();

export const insertMany = async (
  rows: { id: string; type: string; account_ids: string[] }[],
  tx?: Writer,
): Promise<void> => {
  const db = writer(tx);
  if (!rows.length) return;
  await db.identifier.createMany({
    skipDuplicates: true,
    data: rows.map((i) => ({
      id: i.id,
      type: i.type as 'device' | 'phone' | 'ip',
      accountIds: i.account_ids ?? [],
    })),
  });
};
