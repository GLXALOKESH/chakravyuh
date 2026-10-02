/**
 * Recruitment predictions (TRD section 7.8), stored so GET /rings/:id/recruits
 * can be answered from the database.
 *
 * TRD section 3 allows only taint and freeze to call Python live, and section 6
 * has no collection for this, so `recruits` is an addition the API needs. The
 * pipeline writes it; this route only ever reads.
 */
import { Recruit } from '../models/index.js';
import { toRecruit } from '../mappers/api.mapper.js';
import { recruitId } from '../models/recruit.model.js';
import { insertBatches } from './bulk.repository.js';
import type { Writer } from '../interfaces/repository.interface.js';
import type { Recruit as RecruitDomain } from '../interfaces/domain.interface.js';

/** Descending by probability so the dashboard renders the list as-is. */
export const listForRing = async (ringId: string): Promise<RecruitDomain[]> => {
  const rows = await Recruit.find({ ring_id: ringId })
    .select('_id account_id probability reasons')
    .sort({ probability: -1, account_id: 1 })
    .lean()
    .exec();
  return rows.map((r) =>
    toRecruit({
      account_id: r.account_id,
      probability: r.probability,
      reasons: r.reasons ?? [],
    }),
  );
};

export const insertMany = async (
  entries: { ring_id: string; recruits: { id: string; probability: number; reasons: string[] }[] }[],
  tx?: Writer,
): Promise<void> => {
  // The generator writes either `recruits` or `candidates` for the same idea.
  const rows = entries.flatMap((entry) =>
    (entry.recruits ?? []).map((r) => ({
      // Ring and account share one _id, which is the composite key this would
      // have been in a relational schema and what makes the insert idempotent.
      _id: recruitId(entry.ring_id, r.id),
      ring_id: entry.ring_id,
      account_id: r.id,
      probability: r.probability ?? 0,
      reasons: r.reasons ?? [],
    })),
  );
  await insertBatches(Recruit, rows, tx);
};