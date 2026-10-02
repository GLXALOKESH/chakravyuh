/**
 * Shared test helpers.
 *
 * Every test file runs in its own process under `node --test`, and PGLITE_DIR
 * is set to :memory: by the npm test script, so each file gets a private
 * throwaway PostgreSQL with no setup and no files on disk.
 */
import http from 'node:http';
import { once } from 'node:events';
import { connect, close, migrate } from '../src/db/index.js';
import { seed } from '../src/seed.js';

/** Migrates and seeds the in-memory database, then returns the summary. */
export async function freshDb() {
  await connect();
  await migrate({ logger: null });
  return seed('demo', { forceFixtures: true });
}

export async function shutdown() {
  await close().catch(() => {});
}

/** Starts the app on an ephemeral port and returns a fetch-based client. */
export async function startServer(app) {
  const server = http.createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();

  const base = `http://127.0.0.1:${port}`;
  const get = async (path) => {
    const res = await fetch(`${base}${path}`);
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: res.status, body: json, text, headers: res.headers };
  };
  const post = async (path, payload) => {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload ?? {}),
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: res.status, body: json, text, headers: res.headers };
  };

  const stop = async () => {
    server.close();
    await once(server, 'close').catch(() => {});
  };

  return { base, get, post, stop, server };
}

/** Asserts a value has exactly these keys present (extra keys allowed). */
export const hasKeys = (obj, keys, label = 'object') => {
  for (const key of keys) {
    if (!(key in (obj ?? {}))) throw new Error(`${label} is missing "${key}": ${JSON.stringify(obj)?.slice(0, 200)}`);
  }
};

/** Asserts a value is a finite number. */
export const isNumber = (value, label) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} should be a finite number, got ${JSON.stringify(value)}`);
  }
};

/** Second-precision ISO 8601, the timestamp format used across the contract. */
export const ISO_SECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;