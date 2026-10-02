/** Shared identifiers: devices, phones and IPs (TRD section 6). */
import { query, queryOne } from '../db/index.js';

export const IDENTIFIER_TYPES = ['device', 'phone', 'ip'];

export function toDomain(row) {
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    account_ids: row.account_ids ?? [],
  };
}

export async function getById(id) {
  return toDomain(await queryOne('SELECT * FROM identifiers WHERE id = $1', [id]));
}

/** Every identifier touching any of the given accounts, for the entity panel. */
export async function listForAccounts(accountIds) {
  if (!accountIds?.length) return [];
  return (await query('SELECT * FROM identifiers WHERE account_ids && $1::text[] ORDER BY id', [accountIds])).map(
    toDomain,
  );
}

/** Identifier ids linked to one account, used to label a recruit's reasons. */
export async function listForAccount(accountId) {
  return (
    await query('SELECT * FROM identifiers WHERE $1 = ANY(account_ids) ORDER BY id', [accountId])
  ).map(toDomain);
}

export async function count() {
  return Number((await queryOne('SELECT count(*)::bigint AS n FROM identifiers'))?.n ?? 0);
}

export async function upsertMany(identifiers, tx = { query }) {
  for (const i of identifiers) {
    await tx.query(
      `INSERT INTO identifiers (id, type, account_ids)
       VALUES ($1,$2,$3)
       ON CONFLICT (id) DO UPDATE SET type = EXCLUDED.type, account_ids = EXCLUDED.account_ids`,
      [i._id ?? i.id, i.type, i.account_ids ?? []],
    );
  }
}