/**
 * Rings (TRD section 6).
 *
 * `default_taint` and `default_freeze` are the cached Python responses that
 * GET /rings/:id/taint and POST /rings/:id/freeze serve when the ML service is
 * unreachable (TRD section 3). They are the fallback, not a second source of
 * truth: when Python answers, the live response wins.
 */
import { prisma } from '../configs/prisma.js';
import { Prisma } from './prisma/client.js';
import { INSERT_BATCH_SIZE } from '../constants/index.js';
import { chunk } from '../utilities/serialize.util.js';
import { toRing } from '../mappers/row.mapper.js';
import type { RingWrite, Writer } from '../interfaces/repository.interface.js';
import type { Ring, RingSummary } from '../interfaces/domain.interface.js';

const writer = (tx?: Writer) => tx ?? prisma();

export const getById = async (id: string): Promise<Ring | null> => {
  const row = await prisma().ring.findUnique({ where: { id } });
  return row ? toRing(row) : null;
};

export const list = async (): Promise<Ring[]> => {
  const rows = await prisma().ring.findMany({ orderBy: { id: 'asc' } });
  return rows.map(toRing);
};

/**
 * Compact projection for the alert list and the overview graph.
 *
 * memberIds comes back as an array from the scalar list column, so the member
 * count is just its length.
 */
export const listSummaries = async (): Promise<RingSummary[]> => {
  const rows = await prisma().ring.findMany({
    orderBy: { id: 'asc' },
    select: { id: true, risk: true, volume: true, memberIds: true },
  });
  return rows.map((r) => ({
    id: r.id,
    risk: r.risk ?? 0,
    volume: r.volume ?? 0,
    members: (r.memberIds ?? []).length,
  }));
};

export const count = async (): Promise<number> => prisma().ring.count();

export const insertMany = async (rows: RingWrite[], tx?: Writer): Promise<void> => {
  const db = writer(tx);
  for (const batch of chunk(rows, INSERT_BATCH_SIZE)) {
    if (!batch.length) continue;
    await db.ring.createMany({
      skipDuplicates: true,
      data: batch.map((r) => ({
        id: r.id,
        memberIds: r.member_ids ?? [],
        edges: (r.edges ?? []) as Prisma.InputJsonValue,
        identityLinks: (r.identity_links ?? []) as Prisma.InputJsonValue,
        volume: r.volume ?? 0,
        risk: r.risk ?? 0,
        geoSpreadKm: r.geo_spread_km ?? 0,
        victimTxnIds: r.victim_txn_ids ?? [],
        defaultTaint:
          r.default_taint === null || r.default_taint === undefined
            ? Prisma.DbNull
            : (r.default_taint as Prisma.InputJsonValue),
        defaultFreeze:
          r.default_freeze === null || r.default_freeze === undefined
            ? Prisma.DbNull
            : (r.default_freeze as Prisma.InputJsonValue),
      })),
    });
  }
};
