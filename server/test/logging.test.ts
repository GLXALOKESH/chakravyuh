import http from 'node:http';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestLog } from '../src/middlewares/request-log.middleware.js';
import { asyncHandler, errorHandler, notFoundHandler } from '../src/middlewares/error.middleware.js';
import { ActivityLog } from '../src/services/activity-log.service.js';
import { errorFields, logEvent } from '../src/services/logger.service.js';
import { taint } from '../src/services/ml.service.js';
import { createPredictorClient } from '../src/services/predictor.client.js';
import { withMlLog } from '../src/utilities/ml-log.util.js';
import { currentLogContext, withLogContext } from '../src/utilities/log-context.util.js';
import { withDbLog } from '../src/utilities/db-log.util.js';
import { startServer, type TestClient } from './helpers.js';
import { captureLogs } from './logging.helpers.js';

let server: TestClient | undefined;
afterEach(async () => { vi.restoreAllMocks(); if (server) await server.stop(); server = undefined; });

const appWithLogs = (logs: ReturnType<typeof captureLogs>) => {
  const app = express();
  app.use((_req, _res, next) => logs.run(next));
  app.use(requestLog);
  return app;
};

describe('structured HTTP and ML logging', () => {
  it('correlates concurrent HTTP, database and ML work without logging input/output payloads', async () => {
    const logs = captureLogs();
    const app = appWithLogs(logs);
    app.use(express.json());
    app.post('/work/:id', asyncHandler(async (req, res) => {
      await withDbLog({ collection: 'rings', operation: 'findOne' }, async () => ({ secret: 'DOCUMENT_SECRET' }));
      await withMlLog({ path: '/taint', method: 'POST', timeout_ms: 100 }, async (status) => {
        await new Promise((resolve) => setTimeout(resolve, req.params.id === 'one' ? 15 : 1));
        status(200);
        return { accounts: [{ secret: 'ML_SECRET' }] };
      });
      res.json({ result: req.params.id, secret: 'RESPONSE_SECRET' });
    }));
    server = await startServer(app);
    const results = await Promise.all(['one', 'two'].map((id) => fetch(`${server!.base}/work/${id}?token=QUERY_SECRET`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer AUTH_SECRET', cookie: 'COOKIE_SECRET' },
      body: JSON.stringify({ graph_png: 'PNG_SECRET', secret: 'BODY_SECRET' }),
    })));
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(await results[0]!.json()).toMatchObject({ result: 'one', secret: 'RESPONSE_SECRET' });
    const requests = logs.of('http.request');
    expect(requests).toHaveLength(2);
    expect(new Set(requests.map((r) => r.request_id)).size).toBe(2);
    for (const request of requests) {
      const group = logs.records.filter((r) => r.request_id === request.request_id);
      expect(group.map((r) => r.event)).toEqual(['http.request', 'db.operation', 'db.result', 'ml.request', 'ml.response', 'http.response']);
      expect(group.at(-1)).toMatchObject({ status_code: 200, route: '/work/:id' });
      expect(group[1]!.operation_id).toBe(group[2]!.operation_id);
      expect(group[3]!.call_id).toBe(group[4]!.call_id);
    }
    expect(JSON.stringify(logs.records)).not.toMatch(/(?:QUERY|AUTH|COOKIE|PNG|BODY|DOCUMENT|ML|RESPONSE)_SECRET/);
  });

  it('captures parser failures, 404s and preflight without duplicate completion events', async () => {
    const logs = captureLogs();
    const app = appWithLogs(logs);
    app.use(express.json({ limit: '32b' }));
    app.options('/thing', (_req, res) => { res.sendStatus(204); });
    app.use(notFoundHandler);
    app.use(errorHandler);
    server = await startServer(app);
    const malformed = await fetch(`${server.base}/thing`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' });
    const oversized = await server.post('/thing', { value: 'x'.repeat(100) });
    const missing = await server.get('/missing');
    const preflight = await fetch(`${server.base}/thing`, { method: 'OPTIONS' });
    expect([malformed.status, oversized.status, missing.status, preflight.status]).toEqual([400, 413, 404, 204]);
    expect(logs.of('http.request')).toHaveLength(4);
    expect(logs.of('http.response')).toHaveLength(4);
    expect(logs.of('http.aborted')).toHaveLength(0);
    expect(logs.of('http.response').find((r) => r.status_code === 204)!.level).toBe(20);
  });

  it('logs a premature disconnect as an abort, not a successful response', async () => {
    const logs = captureLogs();
    const app = appWithLogs(logs);
    let arrived!: () => void;
    const waiting = new Promise<void>((resolve) => { arrived = resolve; });
    app.get('/hold', (_req, _res) => { arrived(); });
    server = await startServer(app);
    const request = http.get(`${server.base}/hold`);
    request.on('error', () => {});
    await waiting;
    request.destroy();
    await vi.waitFor(() => expect(logs.of('http.aborted')).toHaveLength(1));
    expect(logs.of('http.response')).toHaveLength(0);
    expect(logs.of('http.aborted')[0]).not.toHaveProperty('status_code');
  });

  it('shows a Python timeout and the HTTP 200 fallback under the same request id', async () => {
    const logs = captureLogs();
    // Keep the HTTP test client real; only Python's fetch is replaced.
    const realFetch = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      if (String(input).endsWith('/taint')) return Promise.reject(new DOMException('SENSITIVE_TEXT', 'TimeoutError'));
      return realFetch(input, init);
    });
    const app = appWithLogs(logs);
    app.get('/trace', asyncHandler(async (_req, res) => {
      const result = await taint({ ring_id: 'RING01', victim_txn_id: null, as_of: null }, null);
      res.json(result.payload);
    }));
    server = await startServer(app);
    const result = await server.get('/trace');
    expect(result.status).toBe(200);
    expect(result.body.cached).toBe(true);
    expect(logs.of('ml.timeout')).toHaveLength(1);
    expect(logs.of('ml.fallback')[0]).toMatchObject({ cached: true, fallback_source: 'empty' });
    expect(logs.of('http.response')[0]).toMatchObject({ status_code: 200, cached: true });
    expect(new Set(logs.records.map((r) => r.request_id)).size).toBe(1);
    expect(JSON.stringify(logs.records)).not.toContain('SENSITIVE_TEXT');
  });

  it('identifies a live cached fallback without changing the cached result', async () => {
    const logs = captureLogs();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
    const fallback = { victim_amount: 100, as_of: null, accounts: [], lost_to_cash: 100, links: [], cached: false };
    const result = await logs.run(() => taint({ ring_id: 'LIVE-R01', run_id: 'run-1', victim_txn_id: null, as_of: null }, fallback));
    expect(result.payload).toEqual({ ...fallback, cached: true });
    expect(logs.of('ml.fallback')[0]!.fallback_source).toBe('live_cache');
  });

  it.each([
    ['http', 'ml.http_error'], ['decode', 'ml.invalid_response'], ['network', 'ml.unreachable'],
  ])('classifies %s ML failures and preserves the original rejection', async (kind, expected) => {
    const logs = captureLogs();
    const failure = new Error('DO_NOT_LOG');
    await expect(logs.run(() => withMlLog({ path: '/mincut', method: 'POST', timeout_ms: 100 }, async (status) => {
      if (kind !== 'network') status(kind === 'http' ? 503 : 200);
      throw failure;
    }))).rejects.toBe(failure);
    expect(logs.of(expected)).toHaveLength(1);
    expect(logs.of('ml.response')).toHaveLength(0);
  });

  it('gives retried predictor attempts distinct call ids and preserves applied=false', async () => {
    const logs = captureLogs();
    const client = createPredictorClient({ fetchImpl: vi.fn(async () => new Response(JSON.stringify({ seq: 1, applied: false, took_ms: 2, scores: [], rings: [], alerts: [] }))) });
    const input = { run_id: 'run-1', seq: 1, clock: null, accounts: [], identifiers: [], txns: [] };
    await logs.run(async () => { await client.predict(input); await client.predict(input); });
    expect(new Set(logs.of('ml.request').map((r) => r.call_id)).size).toBe(2);
    expect(logs.of('ml.response').every((r) => r.applied === false && r.run_id === 'run-1' && r.seq === 1)).toBe(true);
  });

  it('classifies predictor timeouts even after wrapping in PredictorError', async () => {
    const logs = captureLogs();
    const client = createPredictorClient({ fetchImpl: vi.fn(async () => { throw new DOMException('timeout', 'TimeoutError'); }) });
    await expect(logs.run(() => client.reset('run-1', null))).rejects.toThrow('predictor unreachable');
    expect(logs.of('ml.timeout')).toHaveLength(1);
  });

  it('omits raw objects and error messages and masks credential-bearing URLs', () => {
    const logs = captureLogs();
    logs.run(() => logEvent('error', 'test.error', {
      ...errorFields(Object.assign(new Error('PASSWORD document=PRIVATE'), { code: 11000 })),
      host: 'mongodb://user:PASSWORD@example.test/db', authorization: 'Bearer SECRET',
      graph_png: 'PNG', is_fraud: true, document: { holder: 'PRIVATE' },
    }));
    expect(logs.records[0]).toMatchObject({ error_name: 'Error', error_code: 11000, host: '[URL omitted]' });
    expect(JSON.stringify(logs.records)).not.toMatch(/PASSWORD|PRIVATE|SECRET|graph_png|is_fraud/);
  });

  it('aggregates stream activity and detaches it from the request that started the run', () => {
    const logs = captureLogs();
    let time = 0;
    const activity = new ActivityLog('stream', () => time);
    logs.run(() => {
      activity.reset('run-1');
      for (let i = 0; i < 10_000; i++) activity.count('received_txns');
      activity.flush();
      expect(logs.records).toHaveLength(0);
      time = 1000;
      activity.flush();
      activity.count('emitted_txns', 10);
      activity.flush(true);
      activity.flush(true);
    }, { request_id: 'starter' });
    expect(logs.of('stream.summary')).toHaveLength(2);
    expect(logs.records[0]).toMatchObject({ run_id: 'run-1', counts: { received_txns: 10_000 } });
    expect(logs.records[0]).not.toHaveProperty('request_id');
    expect(logs.records[1]!.counts).toEqual({ emitted_txns: 10 });
  });

  it('restores the parent context after a detached background operation', async () => {
    const logs = captureLogs();
    await logs.run(async () => {
      await withLogContext({ run_id: 'run-1' }, async () => {
        await Promise.resolve();
        expect(currentLogContext()).toEqual({ run_id: 'run-1' });
      }, { replace: true });
      expect(currentLogContext().request_id).toBe('http-1');
    }, { request_id: 'http-1' });
  });
});
