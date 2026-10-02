/**
 * Accounts (TRD section 6).
 *
 * Column names keep the snake_case of TRD section 6 (risk_v1, ring_id,
 * role_reason) so Member 2 codes one set of names, with the single documented
 * change that the Mongo `_id` is exposed as `id` everywhere.
 */
import { query, queryOne } from '../db/index.js';
import { iso, arr, toJsonb, parseJson } from '../lib/serialize.js';

const SELECT = `
  SELECT id, holder, bank, home, opened_at, opening_balance,
         features, risk_v1, risk_v2, signals, ring_id, role, role_reason
  FROM accounts
`;

export function toDomain(row) {
  if (!row) return null;
  return {
    id: row.id,
    holder: row.holder,
    bank: row.bank,
    home: parseJson(row.home, null),
    opened_at: iso(row.opened_at),
    opening_balance: row.opening_balance ?? 0,
    features: parseJson(row.features, {}),
    risk_v1: row.risk_v1,
    risk_v2: row.risk_v2,
    signals: arr(parseJson(row.signals, [])),
    ring_id: row.ring_id,
    role: row.role,
    role_reason: row.role_reason,
  };
}

export async function getById(id) {
  return toDomain(await queryOne(`${SELECT} WHERE id = $1`, [id]));
}

export async function listByIds(ids) {
  if (!ids?.length) return [];
  const rows = await query(`${SELECT} WHERE id = ANY($1::text[])`, [ids]);
  const byId = new Map(rows.map((r) => [r.id, toDomain(r)]));
  // Preserve the caller's order; ring member order is meaningful for the demo.
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

export async function listByRing(ringId) {
  return (await query(`${SELECT} WHERE ring_id = $1 ORDER BY id`, [ringId])).map(toDomain);
}

/** Node projection for the ring graph (TRD section 8). */
export async function graphNodesForRing(ringId) {
  return query(
    `SELECT id, role, risk_v2 FROM accounts WHERE ring_id = $1 ORDER BY id`,
    [ringId],
  );
}

export async function count() {
  return Number((await queryOne('SELECT count(*)::bigint AS n FROM accounts'))?.n ?? 0);
}

/** Upsert used by the seeder. `features`, `signals` and `home` are jsonb. */
export async function upsertMany(accounts, tx = { query }) {
  for (const a of accounts) {
    await tx.query(
      `INSERT INTO accounts
         (id, holder, bank, home, opened_at, opening_balance, features,
          risk_v1, risk_v2, signals, ring_id, role, role_reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (id) DO UPDATE SET
         holder = EXCLUDED.holder, bank = EXCLUDED.bank, home = EXCLUDED.home,
         opened_at = EXCLUDED.opened_at, opening_balance = EXCLUDED.opening_balance,
         features = EXCLUDED.features, risk_v1 = EXCLUDED.risk_v1,
         risk_v2 = EXCLUDED.risk_v2, signals = EXCLUDED.signals,
         ring_id = EXCLUDED.ring_id, role = EXCLUDED.role,
         role_reason = EXCLUDED.role_reason`,
      [
        a._id ?? a.id,
        a.holder ?? null,
        a.bank ?? null,
        toJsonb(a.home ?? null),
        a.opened_at ?? null,
        a.opening_balance ?? 0,
        toJsonb(a.features ?? {}),
        a.risk_v1 ?? null,
        a.risk_v2 ?? null,
        toJsonb(a.signals ?? []),
        a.ring_id ?? null,
        a.role ?? null,
        a.role_reason ?? null,
      ],
    );
  }
}