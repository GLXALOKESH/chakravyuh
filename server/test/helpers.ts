/**
 * Shared test helpers.
 *
 * Every file here has a database behind it. global-setup.ts points the suite at
 * MONGO_URL when one is configured and otherwise starts its own mongod, so
 * nothing in the suite skips itself: a repository that queries a field name the
 * schema does not have typechecks perfectly and then returns nothing, and only a
 * real server catches that.
 */
import http from 'node:http';
import { once } from 'node:events';
import type { Express } from 'express';
import { disconnect } from '../src/configs/mongoose.js';
import { seed } from '../src/services/seed.service.js';

export interface SeedSummary {
  source: string;
  profile: string;
  counts: Record<string, number>;
}

/** Indexed (by global setup) and seeded, then returns the summary. */
export const freshDb = async (profile = 'demo'): Promise<SeedSummary> => {
  const result = await seed(profile, { forceFixtures: true });
  return { source: result.source, profile: result.profile, counts: result.counts };
};

export const shutdown = async (): Promise<void> => {
  await disconnect().catch(() => {});
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
