/**
 * Database access.
 *
 * Two drivers, one interface:
 *   - DATABASE_URL set  -> node-postgres Pool against your Postgres.
 *   - DATABASE_URL unset -> PGlite, an in-process build of real PostgreSQL.
 *
 * The SQL in this directory is plain PostgreSQL and is not branched on, so the
 * same statements, constraints and types run in both modes. That matters for a
 * demo laptop: nothing has to be installed for `npm run dev` to work.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';
import { config } from '../config.js';

let driver = null;
let ready = null;

function isMemory() {
  return config.pgliteInMemory;
}

/** Builds the underlying handle. Not exported; use connect(). */
async function build() {
  if (config.databaseUrl) {
    const pool = new pg.Pool({
      connectionString: config.databaseUrl,
      max: 10,
      // PGlite and node-postgres both hand back Date objects for timestamptz, so
      // there is nothing to parse here. Kept explicit so nobody "fixes" it later.
      types: { getTypeParser: () => (value) => value },
    });
    return {
      name: 'postgres',
      query: async (text, params = []) => (await pool.query(text, params)).rows,
      exec: async (sql) => {
        // No params means node-postgres uses the simple query protocol, which
        // accepts a multi-statement string.
        await pool.query(sql);
      },
      transaction: async (fn) => {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const out = await fn({
            query: async (t, p = []) => (await client.query(t, p)).rows,
            // No params selects the simple query protocol, which allows
            // multiple statements separated by semicolons.
            exec: async (sql) => {
              await client.query(sql);
            },
          });
          await client.query('COMMIT');
          return out;
        } catch (err) {
          await client.query('ROLLBACK').catch(() => {});
          throw err;
        } finally {
          client.release();
        }
      },
      close: async () => {
        await pool.end();
      },
    };
  }

  const handle = isMemory() ? await PGlite.create() : await PGlite.create({ dataDir: config.pgliteDir });
  return {
    name: 'pglite',
    query: async (text, params = []) => (await handle.query(text, params)).rows,
    exec: async (sql) => {
      await handle.exec(sql);
    },
    transaction: async (fn) =>
      handle.transaction((tx) =>
        fn({
          query: async (t, p = []) => (await tx.query(t, p)).rows,
          exec: async (sql) => {
            await tx.exec(sql);
          },
        }),
      ),
    close: async () => {
      await handle.close();
    },
  };
}

/** Connects on first use and reuses the handle afterwards. */
export function connect() {
  if (!ready) {
    ready = build().then((d) => {
      driver = d;
      return d;
    });
  }
  return ready;
}

export function getDriverName() {
  return driver?.name ?? null;
}

async function handle() {
  return driver ?? (await connect());
}

/** @returns {Promise<any[]>} rows */
export async function query(text, params = []) {
  const d = await handle();
  return d.query(text, params);
}

/** @returns {Promise<any|null>} the first row, or null */
export async function queryOne(text, params = []) {
  const rows = await query(text, params);
  return rows[0] ?? null;
}

/** Multi-statement DDL. No parameters allowed. */
export async function exec(sql) {
  const d = await handle();
  return d.exec(sql);
}

/**
 * Runs fn inside a transaction. fn receives a tx exposing query(sql, params)
 * and exec(sql) for multi-statement DDL.
 * @template T
 * @param {(tx: { query: (sql: string, params?: any[]) => Promise<any[]>, exec: (sql: string) => Promise<void> }) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function transaction(fn) {
  const d = await handle();
  return d.transaction(fn);
}

export async function close() {
  if (ready) {
    const d = await ready;
    await d.close();
    ready = null;
    driver = null;
  }
}

/** Applies every sql/*.sql file that has not run yet, in filename order. */
export async function migrate({ logger = console } = {}) {
  const d = await handle();
  await d.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  const files = (await fs.readdir(config.sqlDir)).filter((f) => f.endsWith('.sql')).sort();
  const applied = new Set((await query('SELECT filename FROM schema_migrations')).map((r) => r.filename));

  const fresh = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await fs.readFile(path.join(config.sqlDir, file), 'utf8');
    logger.info?.(`migrate: applying ${file}`);
    await d.transaction(async (tx) => {
      await tx.exec(sql);
      await tx.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
    });
    fresh.push(file);
  }

  if (!fresh.length) logger.info?.('migrate: already up to date');
  return fresh;
}

/** Drops every domain table. Used by tests and by a full reseed. */
export async function dropAll() {
  await exec(`
    DROP TABLE IF EXISTS seed_meta      CASCADE;
    DROP TABLE IF EXISTS metrics        CASCADE;
    DROP TABLE IF EXISTS recruits       CASCADE;
    DROP TABLE IF EXISTS alerts         CASCADE;
    DROP TABLE IF EXISTS transactions   CASCADE;
    DROP TABLE IF EXISTS identifiers    CASCADE;
    DROP TABLE IF EXISTS accounts       CASCADE;
    DROP TABLE IF EXISTS rings          CASCADE;
    DROP TABLE IF EXISTS schema_migrations CASCADE;
  `);
}