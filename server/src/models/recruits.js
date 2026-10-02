/**
 * Recruitment predictions (TRD section 7.8), stored so GET /rings/:id/recruits
 * can be answered from the database. TRD section 3 allows only taint and freeze
 * to call Python live, and section 6 has no collection for this, so `recruits`
 * is an addition the API needs.
 */
import { query } from '../db/index.js';
import { toJsonb, arr, parseJson } from '../lib/serialize.js';

export async function listForRing(ringId) {
  const rows = await query(
    'SELECT account_id, probability, reasons FROM recruits WHERE ring_id = $1 ORDER BY probability DESC, account_id',
    [ringId],
  );
  return rows.map((row) => ({
    id: row.account_id,
    probability: row.probability ?? 0,
    reasons: arr(parseJson(row.reasons, [])),
  }));
}

export async function upsertMany(recruits, tx = { query }) {
  for (const entry of recruits) {
    for (const r of entry.recruits ?? entry.candidates ?? []) {
      await tx.query(
        `INSERT INTO recruits (ring_id, account_id, probability, reasons)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (ring_id, account_id) DO UPDATE SET
           probability = EXCLUDED.probability, reasons = EXCLUDED.reasons`,
        [entry.ring_id ?? entry.ringId, r.id ?? r.account_id, r.probability ?? 0, toJsonb(r.reasons ?? [])],
      );
    }
  }
}