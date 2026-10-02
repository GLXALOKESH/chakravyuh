/**
 * Rings (TRD section 6).
 *
 * `default_taint` and `default_freeze` are the cached Python responses that
 * GET /rings/:id/taint and POST /rings/:id/freeze serve when the ML service is
 * unreachable (TRD section 3). They are the fallback, not a second source of
 * truth: when Python answers, the live response wins.
 */
import { Ring } from '../models/index.js';
import { toRing, type RingRow } from '../mappers/row.mapper.js';
import { insertBatches } from './bulk.repository.js';
import type { RingWrite, Writer } from '../interfaces/repository.interface.js';
import type { Ring as RingDomain, RingSummary } from '../interfaces/domain.interface.js';

export const getById = async (id: string): Promise<RingDomain | null> => {
  const row = await Ring.findById(id).lean().exec();
  return row ? toRing(row as unknown as RingRow) : null;
};

export const list = async (): Promise<RingDomain[]> => {
  const rows = await Ring.find().sort({ _id: 1 }).lean().exec();
  return (rows as unknown as RingRow[]).map(toRing);
};

/**
 * Compact projection for the alert list and the overview graph.
 *
 * member_ids comes back as an array from the document, so the member count is
 * just its length.
 */
export const listSummaries = async (): Promise<RingSummary[]> => {
  const rows = await Ring.find()
    .select('_id risk volume member_ids')
    .sort({ _id: 1 })
    .lean()
    .exec();
  return (rows as { _id: string; risk: number | null; volume: number | null; member_ids: string[] }[]).map((r) => ({
    id: r._id,
    risk: r.risk ?? 0,
    volume: r.volume ?? 0,
    members: (r.member_ids ?? []).length,
  }));
};

export const count = async (): Promise<number> => Ring.countDocuments({}).exec();

export const insertMany = async (rows: RingWrite[], tx?: Writer): Promise<void> => {
  await insertBatches(
    Ring,
    rows.map((r) => ({
      _id: r.id,
      member_ids: r.member_ids ?? [],
      edges: (r.edges ?? []) as RingRow['edges'],
      identity_links: (r.identity_links ?? []) as RingRow['identity_links'],
      volume: r.volume ?? 0,
      risk: r.risk ?? 0,
      geo_spread_km: r.geo_spread_km ?? 0,
      victim_txn_ids: r.victim_txn_ids ?? [],
      default_taint: r.default_taint ?? null,
      default_freeze: r.default_freeze ?? null,
    })),
    tx,
  );
};