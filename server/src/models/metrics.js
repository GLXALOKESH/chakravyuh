/** The single metrics document (TRD section 6, "metrics (single document)"). */
import { queryOne } from '../db/index.js';
import { arr, toJsonb, parseJson } from '../lib/serialize.js';

export async function get() {
  const row = await queryOne('SELECT rows, note FROM metrics WHERE key = $1', ['main']);
  return {
    rows: arr(parseJson(row?.rows, [])),
    note: row?.note ?? 'Synthetic data, rings planted by the team',
  };
}

export async function set({ rows = [], note = 'Synthetic data, rings planted by the team' } = {}, tx = { query }) {
  await tx.query(
    `INSERT INTO metrics (key, rows, note) VALUES ('main', $1, $2)
     ON CONFLICT (key) DO UPDATE SET rows = EXCLUDED.rows, note = EXCLUDED.note`,
    [toJsonb(rows), note],
  );
}