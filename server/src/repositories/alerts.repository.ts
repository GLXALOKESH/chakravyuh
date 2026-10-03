/** Alerts (TRD section 6) and the alert list projection of TRD section 8. */
import { Alert, Ring } from '../models/index.js';
import { logQuery } from '../utilities/db-log.util.js';
import { iso } from '../utilities/serialize.util.js';
import { insertBatches } from './bulk.repository.js';
import type { AlertRow } from '../mappers/row.mapper.js';
import type { Writer } from '../interfaces/repository.interface.js';
import type { AlertWithRing } from '../interfaces/domain.interface.js';

interface AlertJoinRow extends AlertRow {
  ring_id?: string | null;
}

interface RingSummaryRow {
  _id: string;
  risk: number | null;
  volume: number | null;
  member_ids?: string[] | null;
}

/**
 * Attaches risk, member count and volume from each alert's ring.
 *
 * Two queries and a lookup in memory, rather than a populate or a $lookup. The
 * number of alerts is three in the demo profile and forty-odd in the train
 * profile, so the second query is a handful of indexed lookups, and doing it
 * here keeps the join visible instead of hiding it behind a framework option.
 *
 * The ring is left-joined in effect: an alert can outlive the ring it points at,
 * and that case yields a null risk rather than dropping the alert.
 */
const joinRings = async (rows: AlertJoinRow[]): Promise<AlertWithRing[]> => {
  const ringIds = [...new Set(rows.map((r) => r.ring_id).filter((id): id is string => Boolean(id)))];
  const rings = ringIds.length
    ? await logQuery(Ring.find({ _id: { $in: ringIds } })
        .select('_id risk volume member_ids')
        .lean())
    : [];

  const byId = new Map((rings as unknown as RingSummaryRow[]).map((r) => [r._id, r]));

  return rows.map((row) => {
    const ring = row.ring_id ? byId.get(row.ring_id) : undefined;
    return {
      id: row._id,
      ring_id: row.ring_id ?? null,
      fired_at: iso(row.fired_at),
      risk: ring?.risk ?? null,
      members: (ring?.member_ids ?? []).length,
      volume: ring?.volume ?? null,
      reason: row.reason ?? null,
    };
  });
};

/** TRD section 8 GET /alerts, newest first. */
export const listWithRingSummary = async (): Promise<AlertWithRing[]> => {
  const rows = await logQuery(Alert.find().sort({ fired_at: -1, _id: 1 }).lean());
  return joinRings(rows as unknown as AlertJoinRow[]);
};

/**
 * The same rows in clock order, for the replay engine.
 *
 * Alerts fire as the replay clock passes fired_at, so the engine needs them
 * ascending regardless of how the alert list is displayed.
 */
export const listWithRingByFiredAt = async (): Promise<AlertWithRing[]> => {
  const rows = await logQuery(Alert.find().sort({ fired_at: 1, _id: 1 }).lean());
  return joinRings(rows as unknown as AlertJoinRow[]);
};

export const count = async (): Promise<number> => logQuery(Alert.countDocuments({}));

export const insertMany = async (
  rows: { id: string; ring_id: string | null; fired_at: string; reason: string | null }[],
  tx?: Writer,
): Promise<void> => {
  await insertBatches(
    Alert,
    rows.map((a) => ({
      _id: a.id,
      ring_id: a.ring_id,
      fired_at: new Date(a.fired_at),
      reason: a.reason,
    })),
    tx,
  );
};
