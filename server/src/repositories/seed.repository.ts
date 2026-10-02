/**
 * Seeding support: clearing the domain tables and recording what was loaded.
 *
 * Truncate rather than delete, because the tables are small and the point of
 * the truncate is to guarantee no stale row survives, not to keep the old ones.
 */
import { prisma } from '../configs/prisma.js';
import { Prisma } from './prisma/client.js';
import type { Writer } from '../interfaces/repository.interface.js';

/**
 * Order matters only in that the whole statement is CASCADE, so this is a
 * single statement regardless. SeedMeta is included so a re-seed also clears the
 * record of the previous one.
 */
export const DOMAIN_TABLES = ['seed_meta', 'metrics', 'recruits', 'alerts', 'transactions', 'identifiers', 'accounts', 'rings'];

export const truncateAll = async (tx: Writer): Promise<void> => {
  await tx.$executeRawUnsafe(`TRUNCATE ${DOMAIN_TABLES.join(', ')} RESTART IDENTITY CASCADE;`);
};

export interface SeedRecord {
  source: string;
  profile: string;
  seeded_at: string;
  fixture_seed: number;
  counts?: Record<string, number>;
}

export const setLastSeed = async (value: SeedRecord, tx?: Writer): Promise<void> => {
  await (tx ?? prisma()).seedMeta.upsert({
    where: { key: 'last_seed' },
    create: { key: 'last_seed', value: value as unknown as Prisma.InputJsonValue },
    update: { value: value as unknown as Prisma.InputJsonValue },
  });
};

export const getLastSeed = async (): Promise<SeedRecord | null> => {
  const row = await prisma().seedMeta.findUnique({ where: { key: 'last_seed' } });
  return (row?.value as SeedRecord | null) ?? null;
};
