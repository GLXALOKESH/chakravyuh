/**
 * Transactions (TRD section 6).
 *
 * `from` and `to` are SQL keywords, so they are stored as from_account and
 * to_account and mapped back on the way out. is_fraud is ground truth and is
 * deliberately absent from every projection in this file: TRD section 6 states
 * it is never sent to the dashboard.
 */
import { query, queryOne } from '../db/index.js';
import { iso, toJsonb, parseJson } from '../lib/serialize.js';

/** Columns safe to expose. No is_fraud. */
const PUBLIC = 'id, from_account, to_account, amount, ts, channel, location';

export function toDomain(row) {
  if (!row) return null;
  return {
    id: row.id,
    from: row.from_account,
    to: row.to_account,
    amount: row.amount,
    ts: iso(row.ts),
    channel: row.channel,
    location: parseJson(row.location, null),
  };
}

export async function getById(id) {
  return toDomain(await queryOne(`SELECT ${PUBLIC} FROM transactions WHERE id = $1`, [id]));
}

/** Every transaction in timestamp order. Used to build the replay script. */
export async function listOrdered({ asOf = null, fromId = null, limit = null } = {}) {
  const params = [];
  const where = [];
  if (asOf) {
    params.push(asOf);
    where.push(`ts <= $${params.length}`);
  }
  if (fromId) {
    params.push(fromId);
    where.push(`ts > (SELECT ts FROM transactions WHERE id = $${params.length})`);
  }
  params.push(limit ?? Number.MAX_SAFE_INTEGER);
  const sql = `
    SELECT ${PUBLIC} FROM transactions
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY ts, id
    LIMIT $${params.length}
  `;
  return (await query(sql, params)).map(toDomain);
}

/** Cash-out withdrawals by ring members, for the map tab (F18, P2). */
export async function cashoutsForRing(ringId) {
  return query(
    `SELECT t.id, t.from_account, t.amount, t.ts, t.location
     FROM transactions t
     WHERE t.channel = 'ATM'
       AND t.location IS NOT NULL
       AND t.from_account IN (SELECT unnest(member_ids) FROM rings WHERE id = $1)
     ORDER BY t.ts`,
    [ringId],
  );
}

/** Most recent activity touching an account, for the entity panel. */
export async function recentForAccount(accountId, limit = 10) {
  const rows = await query(
    `SELECT ${PUBLIC} FROM transactions
     WHERE from_account = $1 OR to_account = $1
     ORDER BY ts DESC
     LIMIT $2`,
    [accountId, limit],
  );
  return rows.map(toDomain);
}

export async function count() {
  return Number((await queryOne('SELECT count(*)::bigint AS n FROM transactions'))?.n ?? 0);
}

export async function upsertMany(transactions, tx = { query }) {
  for (const t of transactions) {
    await tx.query(
      `INSERT INTO transactions (id, from_account, to_account, amount, ts, channel, location, is_fraud)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE SET
         from_account = EXCLUDED.from_account, to_account = EXCLUDED.to_account,
         amount = EXCLUDED.amount, ts = EXCLUDED.ts, channel = EXCLUDED.channel,
         location = EXCLUDED.location, is_fraud = EXCLUDED.is_fraud`,
      [
        t._id ?? t.id,
        t.from,
        t.to,
        t.amount,
        t.ts,
        t.channel,
        toJsonb(t.location ?? null),
        Boolean(t.is_fraud ?? false),
      ],
    );
  }
}