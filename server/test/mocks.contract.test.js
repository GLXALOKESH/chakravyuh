/**
 * Contract check, mocks (TRD section 13, Member 1).
 *
 * "Every endpoint returns the shapes in section 8, with mocks and with real
 * data." This is the mock half, run in its own process so USE_MOCKS can be set
 * before the config module is imported.
 *
 * These tests are the reason the mocks are useful rather than misleading: if the
 * mock shapes ever drift from TRD section 8, Member 2's frontend builds against
 * something wrong and this fails.
 */
process.env.USE_MOCKS = 'true';

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

let api;

before(async () => {
  const { default: mocksRouter } = await import('../src/mocks/router.js');
  const { default: express } = await import('express');
  const app = express();
  app.use(express.json());
  app.use('/api', mocksRouter);
  api = await startServer(app);
});

after(async () => {
  await api?.stop();
});

test('GET /api/alerts', async () => {
  const { status, body } = await api.get('/api/alerts');
  assert.equal(status, 200);
  assert.ok(body.length > 0);
  for (const alert of body) {
    for (const key of ['id', 'ring_id', 'fired_at', 'risk', 'members', 'volume', 'reason']) {
      assert.ok(key in alert, `alert missing ${key}`);
    }
  }
});

test('GET /api/rings/:id', async () => {
  const { status, body } = await api.get('/api/rings/RING01');
  assert.equal(status, 200);
  for (const key of ['id', 'risk', 'volume', 'nodes', 'edges', 'victim_txn_ids']) {
    assert.ok(key in body, `ring missing ${key}`);
  }
  assert.ok(body.nodes.some((n) => n.type === 'device'), 'expected identity nodes');
  assert.ok(body.edges.some((e) => e.kind === 'identity'), 'expected identity edges');
  assert.ok(body.edges.some((e) => e.kind === 'txn' && typeof e.amount === 'number'));
});

test('GET /api/rings/:id/taint', async () => {
  const { status, body } = await api.get('/api/rings/RING01/taint');
  assert.equal(status, 200);
  for (const key of ['victim_amount', 'as_of', 'cached', 'accounts', 'lost_to_cash', 'links']) {
    assert.ok(key in body, `taint missing ${key}`);
  }
  const sum = body.accounts.reduce((s, a) => s + a.tainted, 0) + body.lost_to_cash;
  assert.equal(sum, body.victim_amount, 'the mock taint should conserve too, so the UI maths is the same');
});

test('POST /api/rings/:id/freeze and exclusion', async () => {
  const all = await api.post('/api/rings/RING01/freeze', { k: 3 });
  assert.equal(all.status, 200);
  for (const key of ['freeze', 'at_risk_before', 'secured', 'pct_stopped', 'cached']) {
    assert.ok(key in all.body, `freeze missing ${key}`);
  }

  const excluded = await api.post('/api/rings/RING01/freeze', { k: 3, exclude: [all.body.freeze[0]] });
  assert.ok(!excluded.body.freeze.includes(all.body.freeze[0]));
  assert.ok(excluded.body.pct_stopped < all.body.pct_stopped, 'the mock should respond to a toggle');
});

test('GET /api/rings/:id/recruits', async () => {
  const { status, body } = await api.get('/api/rings/RING01/recruits');
  assert.equal(status, 200);
  for (const recruit of body) {
    for (const key of ['id', 'probability', 'reasons']) assert.ok(key in recruit, `recruit missing ${key}`);
  }
});

test('GET /api/rings/:id/geo', async () => {
  const { status, body } = await api.get('/api/rings/RING01/geo');
  assert.equal(status, 200);
  for (const key of ['spread_km', 'cities', 'homes', 'cashouts']) assert.ok(key in body, `geo missing ${key}`);
});

test('GET /api/accounts/:id', async () => {
  const { status, body } = await api.get('/api/accounts/ACC0042');
  assert.equal(status, 200);
  for (const key of ['id', 'features', 'signals', 'linked_identifiers', 'role', 'role_reason']) {
    assert.ok(key in body, `account missing ${key}`);
  }
});

test('GET /api/metrics', async () => {
  const { status, body } = await api.get('/api/metrics');
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.rows));
  assert.equal(typeof body.note, 'string');
});

test('no mock leaks is_fraud', async () => {
  for (const path of ['/api/alerts', '/api/rings/RING01', '/api/rings/RING01/taint', '/api/accounts/ACC0042', '/api/metrics']) {
    const { text } = await api.get(path);
    assert.ok(!text.includes('is_fraud'), `${path} leaked is_fraud`);
  }
});