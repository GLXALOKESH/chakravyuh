/**
 * Contract check, mocks (TRD section 13, Member 1).
 *
 * "Every endpoint returns the shapes in section 8, with mocks and with real
 * data." This is the mock half, mounted directly rather than through the
 * configured app so it does not depend on USE_MOCKS being set at import time.
 *
 * These tests are the reason the mocks are useful rather than misleading: if the
 * mock shapes ever drift from TRD section 8, Member 2's frontend builds against
 * something wrong and this fails.
 */
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mocksRouter } from '../src/mocks/mocks.routes.js';
import { hasKeys, startServer, type TestClient } from './helpers.js';

let api: TestClient;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', mocksRouter);
  api = await startServer(app);
});

afterAll(async () => {
  await api?.stop();
});

describe('mock contract', () => {
  it('GET /api/alerts', async () => {
    const { status, body } = await api.get('/api/alerts');
    expect(status).toBe(200);
    expect(body.length).toBeGreaterThan(0);
    for (const alert of body) {
      hasKeys(alert, ['id', 'ring_id', 'fired_at', 'risk', 'members', 'volume', 'reason'], 'alert');
    }
  });

  it('GET /api/rings/:id', async () => {
    const { status, body } = await api.get('/api/rings/RING01');
    expect(status).toBe(200);
    hasKeys(body, ['id', 'risk', 'volume', 'nodes', 'edges', 'victim_txn_ids'], 'ring');
    expect(body.nodes.some((n: { type: string }) => n.type === 'device'), 'expected identity nodes').toBe(true);
    expect(body.edges.some((e: { kind: string }) => e.kind === 'identity'), 'expected identity edges').toBe(true);
    expect(
      body.edges.some((e: { kind: string; amount: unknown }) => e.kind === 'txn' && typeof e.amount === 'number'),
    ).toBe(true);
  });

  it('an unknown ring id still returns something renderable', async () => {
    const { status, body } = await api.get('/api/rings/RING_NOPE');
    expect(status).toBe(200);
    expect(body.id).toBe('RING01');
  });

  it('GET /api/rings/:id/taint conserves the victim amount', async () => {
    const { status, body } = await api.get('/api/rings/RING01/taint');
    expect(status).toBe(200);
    hasKeys(body, ['victim_amount', 'as_of', 'cached', 'accounts', 'lost_to_cash', 'links'], 'taint');
    const sum = body.accounts.reduce((s: number, a: { tainted: number }) => s + a.tainted, 0) + body.lost_to_cash;
    // The mock has to conserve too, so the dashboard's totals maths behaves the
    // same against it as against real data.
    expect(sum).toBe(body.victim_amount);
  });

  it('POST /api/rings/:id/freeze responds to exclusion', async () => {
    const all = await api.post('/api/rings/RING01/freeze', { k: 3 });
    expect(all.status).toBe(200);
    hasKeys(all.body, ['freeze', 'at_risk_before', 'secured', 'pct_stopped', 'cached'], 'freeze');

    const excluded = await api.post('/api/rings/RING01/freeze', { k: 3, exclude: [all.body.freeze[0]] });
    expect(excluded.body.freeze).not.toContain(all.body.freeze[0]);
    expect(excluded.body.pct_stopped, 'the mock should respond to a toggle').toBeLessThan(all.body.pct_stopped);
  });

  it('GET /api/rings/:id/recruits', async () => {
    const { status, body } = await api.get('/api/rings/RING01/recruits');
    expect(status).toBe(200);
    for (const recruit of body) hasKeys(recruit, ['id', 'probability', 'reasons'], 'recruit');
  });

  it('GET /api/rings/:id/geo', async () => {
    const { status, body } = await api.get('/api/rings/RING01/geo');
    expect(status).toBe(200);
    hasKeys(body, ['spread_km', 'cities', 'homes', 'cashouts'], 'geo');
  });

  it('GET /api/accounts/:id', async () => {
    const { status, body } = await api.get('/api/accounts/ACC0042');
    expect(status).toBe(200);
    hasKeys(body, ['id', 'features', 'signals', 'linked_identifiers', 'role', 'role_reason'], 'account');
  });

  it('GET /api/metrics', async () => {
    const { status, body } = await api.get('/api/metrics');
    expect(status).toBe(200);
    expect(Array.isArray(body.rows)).toBe(true);
    expect(typeof body.note).toBe('string');
  });

  it('replay control is answerable so the dashboard can be built without a socket', async () => {
    expect((await api.post('/api/replay/start', {})).status).toBe(200);
    expect((await api.get('/api/replay/state')).status).toBe(200);
    expect((await api.post('/api/replay/stop', {})).status).toBe(200);
  });

  it('no mock leaks is_fraud', async () => {
    const paths = [
      '/api/alerts',
      '/api/rings/RING01',
      '/api/rings/RING01/taint',
      '/api/accounts/ACC0042',
      '/api/metrics',
    ];
    for (const path of paths) {
      const { text } = await api.get(path);
      expect(text.includes('is_fraud'), `${path} leaked is_fraud`).toBe(false);
    }
  });
});
