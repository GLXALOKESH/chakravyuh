/** Rings (TRD section 6). */
import { query, queryOne } from '../db/index.js';
import { arr, toJsonb, parseJson } from '../lib/serialize.js';

export function toDomain(row) {
  if (!row) return null;
  return {
    id: row.id,
    member_ids: arr(row.member_ids),
    edges: arr(parseJson(row.edges, [])),
    identity_links: arr(parseJson(row.identity_links, [])),
    volume: row.volume ?? 0,
    risk: row.risk ?? 0,
    geo_spread_km: row.geo_spread_km ?? 0,
    victim_txn_ids: arr(row.victim_txn_ids),
    // Cached Python responses, replayed when the ML service is unreachable
    // (TRD section 3).
    default_taint: parseJson(row.default_taint, null),
    default_freeze: parseJson(row.default_freeze, null),
  };
}

export async function getById(id) {
  return toDomain(await queryOne('SELECT * FROM rings WHERE id = $1', [id]));
}

export async function list() {
  return (await query('SELECT * FROM rings ORDER BY id')).map(toDomain);
}

/** Compact projection for the alert list and overview graph. */
export async function listSummaries() {
  return query(
    `SELECT id, risk, volume, COALESCE(array_length(member_ids, 1), 0) AS members
     FROM rings ORDER BY id`,
  );
}

export async function count() {
  return Number((await queryOne('SELECT count(*)::bigint AS n FROM rings'))?.n ?? 0);
}

export async function upsertMany(rings, tx = { query }) {
  for (const r of rings) {
    await tx.query(
      `INSERT INTO rings
         (id, member_ids, edges, identity_links, volume, risk, geo_spread_km,
          victim_txn_ids, default_taint, default_freeze)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (id) DO UPDATE SET
         member_ids = EXCLUDED.member_ids, edges = EXCLUDED.edges,
         identity_links = EXCLUDED.identity_links, volume = EXCLUDED.volume,
         risk = EXCLUDED.risk, geo_spread_km = EXCLUDED.geo_spread_km,
         victim_txn_ids = EXCLUDED.victim_txn_ids,
         default_taint = EXCLUDED.default_taint,
         default_freeze = EXCLUDED.default_freeze`,
      [
        r._id ?? r.id,
        r.member_ids ?? [],
        toJsonb(r.edges ?? []),
        toJsonb(r.identity_links ?? []),
        r.volume ?? 0,
        r.risk ?? 0,
        r.geo_spread_km ?? 0,
        r.victim_txn_ids ?? [],
        toJsonb(r.default_taint ?? null),
        toJsonb(r.default_freeze ?? null),
      ],
    );
  }
}