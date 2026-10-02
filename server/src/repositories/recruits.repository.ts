/**
 * Recruitment predictions (TRD section 7.8), stored so GET /rings/:id/recruits
 * can be answered from the database.
 *
 * TRD section 3 allows only taint and freeze to call Python live, and section 6
 * has no collection for this, so `recruits` is an addition the API needs. The
 * pipeline writes it; this route only ever reads.
 */
import { prisma } from '../configs/prisma.js';
import { Prisma } from './prisma/client.js';
import { toRecruit } from '../mappers/api.mapper.js';
import type { Writer } from '../interfaces/repository.interface.js';
import type { Recruit } from '../interfaces/domain.interface.js';

const writer = (tx?: Writer) => tx ?? prisma();

/** Descending by probability so the dashboard renders the list as-is. */
export const listForRing = async (ringId: string): Promise<Recruit[]> => {
  const rows = await prisma().recruit.findMany({
    where: { ringId },
    orderBy: [{ probability: 'desc' }, { accountId: 'asc' }],
  });
  return rows.map(toRecruit);
};

export const insertMany = async (
  entries: { ring_id: string; recruits: { id: string; probability: number; reasons: string[] }[] }[],
  tx?: Writer,
): Promise<void> => {
  const db = writer(tx);
  // The generator writes either `recruits` or `candidates` for the same idea.
  const rows = entries.flatMap((entry) =>
    (entry.recruits ?? []).map((r) => ({
      ringId: entry.ring_id,
      accountId: r.id,
      probability: r.probability ?? 0,
      reasons: (r.reasons ?? []) as Prisma.InputJsonValue,
    })),
  );
  if (!rows.length) return;
  await db.recruit.createMany({ skipDuplicates: true, data: rows });
};
