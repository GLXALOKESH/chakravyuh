/** Alerts (TRD section 6) and the alert list projection of TRD section 8. */
import { query, queryOne } from '../db/index.js';
import { iso } from '../lib/serialize.js';

export function toDomain(row) {
  if (!row) return null;
  return {
    id: row.id,
    ring_id: row.ring_id,
    fired_at: iso(row.fired_at),
    reason: row.reason,
  };
}

/**
 * TRD section 8 GET /alerts. Risk, member count and volume are joined from the
 * ring so the dashboard can render the alert list without N follow-up calls.
 * Rings are left-joined because an alert can outlive its ring.
 */
export async function listWithRingSummary() {
  const rows = await query(
    `SELECT a.id, a.ring_id, a.fired_at, a.reason,
            r.risk, COALESCE(array_length(r.member_ids, 1), 0) AS members, r.volume
     FROM alerts a
     LEFT JOIN rings r ON r.id = a.ring_id
     ORDER BY a.fired_at DESC, a.id`,
  );
  return rows.map((row) => ({
    id: row.id,
    ring_id: row.ring_id,
    fired_at: iso(row.fired_at),
    risk: row.risk ?? null,
    members: Number(row.members ?? 0),
    volume: row.volume ?? null,
    reason: row.reason,
  }));
}

export async function count() {
  return Number((await queryOne('SELECT count(*)::bigint AS n FROM alerts'))?.n ?? 0);
}

export async function upsertMany(alerts, tx = { query }) {
  for (const a of alerts) {
    await tx.query(
      `INSERT INTO alerts (id, ring_id, fired_at, reason)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (id) DO UPDATE SET ring_id = EXCLUDED.ring_id,
                                      fired_at = EXCLUDED.fired_at,
                                      reason = EXCLUDED.reason`,
      [a._id ?? a.id, a.ring_id ?? null, a.fired_at, a.reason ?? null],
    );
  }
}