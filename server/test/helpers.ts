/**
 * Shared test helpers.
 *
 * The suite runs without a database by default: the pure files (generator
 * invariants, replay engine, mock contract, ML fallback, evidence PDF) always
 * run, and the two database-backed files skip themselves unless a connection
 * string is configured. That way `npm test` is useful both before and after
 * the string arrives, rather than failing for a reason that has nothing to do
 * with the code.
 */
import http from 'node:http';
import { once } from 'node:events';
import type { Express } from 'express';
import { prisma } from '../src/configs/prisma.js';
import { seed } from '../src/services/seed.service.js';
import { hasTestDatabase } from './db-url.js';

export { hasTestDatabase as hasDatabase };

export interface SeedSummary {
  source: string;
  profile: string;
  counts: Record<string, number>;
}

/** Migrates (already done by global setup) and seeds, then returns the summary. */
export const freshDb = async (profile = 'demo'): Promise<SeedSummary> => {
  const result = await seed(profile, { forceFixtures: true });
  return { source: result.source, profile: result.profile, counts: result.counts };
};

export const shutdown = async (): Promise<void> => {
  await prisma().$disconnect().catch(() => {});
};

export interface Response<T = any> {
  status: number;
  body: T;
  text: string;
  headers: Headers;
}

export interface TestClient {
  base: string;
  get<T = any>(path: string): Promise<Response<T>>;
  post<T = any>(path: string, payload?: unknown): Promise<Response<T>>;
  stop(): Promise<void>;
  server: http.Server;
}

/** Starts the app on an ephemeral port and returns a fetch-based client. */
export const startServer = async (app: Express): Promise<TestClient> => {
  const server = http.createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  const base = `http://127.0.0.1:${port}`;

  const read = async (res: globalThis.Response): Promise<Response> => {
    const text = await res.text();
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      // A PDF or a non-JSON error body. `text` is what assertions should use.
      body = null;
    }
    return { status: res.status, body, text, headers: res.headers };
  };

  const get = async (path: string) => {
    const res = await fetch(`${base}${path}`);
    return read(res);
  };

  const post = async (path: string, payload?: unknown) => {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload ?? {}),
    });
    return read(res);
  };

  const stop = async (): Promise<void> => {
    server.close();
    await once(server, 'close').catch(() => {});
  };

  return { base, get, post, stop, server };
};

/** Asserts a value has at least these keys (extra keys are allowed). */
export const hasKeys = (obj: unknown, keys: readonly string[], label = 'object'): void => {
  const record = (obj ?? {}) as Record<string, unknown>;
  for (const key of keys) {
    if (!(key in record)) {
      throw new Error(`${label} is missing "${key}": ${JSON.stringify(obj)?.slice(0, 200)}`);
    }
  }
};

/** Asserts a value is a finite number. */
export const isNumber = (value: unknown, label: string): void => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} should be a finite number, got ${JSON.stringify(value)}`);
  }
};

/** Second-precision ISO 8601, the timestamp format used across the contract. */
export const ISO_SECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
