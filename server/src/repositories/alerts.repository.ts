/** Alerts (TRD section 6) and the alert list projection of TRD section 8. */
import { prisma } from '../configs/prisma.js';
import { iso } from '../utilities/serialize.util.js';
import type { Writer } from '../interfaces/repository.interface.js';
import type { AlertWithRing } from '../interfaces/domain.interface.js';

const writer = (tx?: Writer) => tx ?? prisma();

const shape = (row: {
  id: string;
  ringId: string | null;
  firedAt: Date;
  reason: string | null;
  ring: { risk: number | null; volume: number | null; memberIds: string[] } | null;
}): AlertWithRing => ({
  id: row.id,
  ring_id: row.ringId,
  fired_at: iso(row.firedAt),
  risk: row.ring?.risk ?? null,
  members: (row.ring?.memberIds ?? []).length,
  volume: row.ring?.volume ?? null,
  reason: row.reason,
});

const WITH_RING = {
  ring: { select: { risk: true, volume: true, memberIds: true } },
} as const;

/**
 * TRD section 8 GET /alerts.
 *
 * Risk, member count and volume are joined from the ring so the dashboard can
 * render the alert list without N follow-up calls. The ring is left-joined
 * because an alert can outlive the ring it points at.
 */
export const listWithRingSummary = async (): Promise<AlertWithRing[]> => {
  const rows = await prisma().alert.findMany({
    include: WITH_RING,
    orderBy: [{ firedAt: 'desc' }, { id: 'asc' }],
  });
  return rows.map(shape);
};

/**
 * The same rows in clock order, for the replay engine.
 *
 * Alerts fire as the replay clock passes fired_at, so the engine needs them
 * ascending regardless of how the alert list is displayed.
 */
export const listWithRingByFiredAt = async (): Promise<AlertWithRing[]> => {
  const rows = await prisma().alert.findMany({
    include: WITH_RING,
    orderBy: [{ firedAt: 'asc' }, { id: 'asc' }],
  });
  return rows.map(shape);
};

export const count = async (): Promise<number> => prisma().alert.count();

export const insertMany = async (
  rows: { id: string; ring_id: string | null; fired_at: string; reason: string | null }[],
  tx?: Writer,
): Promise<void> => {
  const db = writer(tx);
  if (!rows.length) return;
  await db.alert.createMany({
    skipDuplicates: true,
    data: rows.map((a) => ({
      id: a.id,
      ringId: a.ring_id,
      firedAt: new Date(a.fired_at),
      reason: a.reason,
    })),
  });
};
