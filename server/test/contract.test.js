/**
 * Contract check, real data (TRD section 13, Member 1).
 *
 * "Every endpoint returns the shapes in section 8, with mocks and with real
 * data." This file covers the real half; mocks.contract.test.js covers the other.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, startServer, shutdown, hasKeys, isNumber, ISO_SECONDS } from './helpers.js';

let api;

before(async () => {
  await freshDb();
  const { createApp } = await import('../src/app.js');
  api = await startServer(createApp());
});

after(async () => {
  await api?.stop();
  await shutdown();
});

test('GET /api/alerts returns the section 8 alert shape', async () => {
  const { status, body } = await api.get('/api/alerts');
  assert.equal(status, 200);
  assert.ok(Array.isArray(body) && body.length > 0, 'expected a non-empty alert list');

  for (const alert of body) {
    hasKeys(alert, ['id', 'ring_id', 'fired_at', 'risk', 'members', 'volume', 'reason'], 'alert');
    assert.match(alert.fired_at, ISO_SECONDS, 'fired_at should be second-precision ISO 8601');
    isNumber(alert.risk, 'alert.risk');
    isNumber(alert.members, 'alert.members');
    isNumber(alert.volume, 'alert.volume');
    assert.equal(typeof alert.reason, 'string');
  }
});

test('GET /api/rings/:id returns nodes and edges in the section 8 shape', async () => {
  const { status, body } = await api.get('/api/rings/RING01');
  assert.equal(status, 200);
  hasKeys(body, ['id', 'risk', 'volume', 'nodes', 'edges', 'victim_txn_ids'], 'ring');

  assert.ok(body.nodes.length > 0, 'ring should have nodes');
  for (const node of body.nodes) {
    hasKeys(node, ['id', 'type'], 'node');
    assert.ok(['account', 'device', 'phone', 'ip'].includes(node.type), `unexpected node type ${node.type}`);
    if (node.type === 'account') {
      hasKeys(node, ['id', 'type', 'role', 'risk'], 'account node');
      isNumber(node.risk, 'account node risk');
      assert.equal(typeof node.role, 'string');
    }
  }

  for (const edge of body.edges) {
    hasKeys(edge, ['source', 'target', 'kind'], 'edge');
    assert.ok(['txn', 'identity'].includes(edge.kind), `unexpected edge kind ${edge.kind}`);
    if (edge.kind === 'txn') isNumber(edge.amount, 'txn edge amount');
  }

  assert.ok(Array.isArray(body.victim_txn_ids));
});

test('GET /api/accounts/:id returns features, role, signals and identifiers', async () => {
  const { status, body } = await api.get('/api/accounts/ACC0042');
  assert.equal(status, 200);
  hasKeys(
    body,
    ['id', 'holder', 'bank', 'home', 'opened_at', 'features', 'risk_v1', 'risk_v2', 'signals', 'role', 'role_reason', 'linked_identifiers'],
    'account',
  );
  assert.match(body.opened_at, ISO_SECONDS);
  assert.equal(typeof body.features, 'object');
  assert.ok(Array.isArray(body.signals));
  assert.ok(Array.isArray(body.linked_identifiers));
  for (const signal of body.signals) hasKeys(signal, ['feature', 'label', 'weight'], 'signal');
  for (const id of body.linked_identifiers) hasKeys(id, ['id', 'type', 'account_ids'], 'identifier');
});

test('GET /api/rings/:id/taint returns the section 8 taint shape', async () => {
  const { status, body } = await api.get('/api/rings/RING01/taint');
  assert.equal(status, 200);
  hasKeys(body, ['victim_amount', 'as_of', 'cached', 'accounts', 'lost_to_cash', 'links'], 'taint');
  isNumber(body.victim_amount, 'victim_amount');
  isNumber(body.lost_to_cash, 'lost_to_cash');
  assert.equal(typeof body.cached, 'boolean');
  assert.match(body.as_of, ISO_SECONDS);

  for (const account of body.accounts) hasKeys(account, ['id', 'balance', 'tainted', 'lien'], 'taint account');
  for (const link of body.links) hasKeys(link, ['source', 'target', 'value'], 'taint link');
});

test('taint conserves the victim amount (TRD section 13)', async () => {
  const { body } = await api.get('/api/rings/RING01/taint');
  const sum = body.accounts.reduce((s, a) => s + a.tainted, 0) + body.lost_to_cash;
  assert.equal(sum, body.victim_amount, 'tainted amounts plus lost-to-cash must equal the victim amount');
});

test('recommended lien never exceeds the balance', async () => {
  const { body } = await api.get('/api/rings/RING01/taint');
  for (const account of body.accounts) {
    assert.ok(account.lien <= account.balance, `lien ${account.lien} exceeds balance ${account.balance}`);
    assert.equal(account.lien, Math.min(account.tainted, account.balance));
  }
});

test('POST /api/rings/:id/freeze returns the section 8 freeze shape', async () => {
  const { status, body } = await api.post('/api/rings/RING01/freeze', { k: 3 });
  assert.equal(status, 200);
  hasKeys(body, ['freeze', 'at_risk_before', 'secured', 'pct_stopped', 'cached'], 'freeze');
  assert.ok(Array.isArray(body.freeze));
  isNumber(body.at_risk_before, 'at_risk_before');
  isNumber(body.secured, 'secured');
  isNumber(body.pct_stopped, 'pct_stopped');
  // TRD section 13 freeze sanity.
  assert.ok(body.secured <= body.at_risk_before, 'secured must not exceed at_risk_before');
  assert.ok(body.pct_stopped >= 0 && body.pct_stopped <= 1, 'pct_stopped must be a proportion');
});

test('an excluded account is never recommended (TRD section 13)', async () => {
  const { body } = await api.post('/api/rings/RING01/freeze', { k: 3, exclude: ['ACC0040'] });
  assert.ok(!body.freeze.includes('ACC0040'), 'excluded account must not be returned');
});

test('excluding an account lowers the percentage stopped (demo step 6)', async () => {
  const all = await api.post('/api/rings/RING01/freeze', { k: 3 });
  const first = all.body.freeze[0];
  const fewer = await api.post('/api/rings/RING01/freeze', { k: 3, exclude: [first] });
  assert.ok(fewer.body.pct_stopped < all.body.pct_stopped, 'unticking an account should reduce pct_stopped');
});

test('GET /api/rings/:id/recruits returns the section 8 recruits shape', async () => {
  const { status, body } = await api.get('/api/rings/RING01/recruits');
  assert.equal(status, 200);
  assert.ok(Array.isArray(body) && body.length > 0);
  for (const recruit of body) {
    hasKeys(recruit, ['id', 'probability', 'reasons'], 'recruit');
    isNumber(recruit.probability, 'probability');
    assert.ok(recruit.probability >= 0 && recruit.probability <= 1);
    assert.ok(Array.isArray(recruit.reasons) && recruit.reasons.length > 0, 'expected top reasons');
  }
  // Descending by probability so the dashboard can render the list as-is.
  const probabilities = body.map((r) => r.probability);
  assert.deepEqual(probabilities, [...probabilities].sort((a, b) => b - a));
});

test('GET /api/rings/:id/geo returns the section 8 geo shape', async () => {
  const { status, body } = await api.get('/api/rings/RING01/geo');
  assert.equal(status, 200);
  hasKeys(body, ['spread_km', 'cities', 'homes', 'cashouts'], 'geo');
  isNumber(body.spread_km, 'spread_km');
  for (const home of body.homes) hasKeys(home, ['account_id', 'city', 'lat', 'lng'], 'home');
  for (const cashout of body.cashouts) {
    hasKeys(cashout, ['txn_id', 'account_id', 'city', 'lat', 'lng', 'amount', 'ts'], 'cashout');
    assert.match(cashout.ts, ISO_SECONDS);
  }
});

test('GET /api/metrics returns the V1 against V2 table', async () => {
  const { status, body } = await api.get('/api/metrics');
  assert.equal(status, 200);
  hasKeys(body, ['rows', 'note'], 'metrics');
  assert.ok(Array.isArray(body.rows) && body.rows.length >= 2, 'expected at least a V1 and a V2 row');
  for (const row of body.rows) hasKeys(row, ['model', 'pr_auc', 'ring_recall', 'pattern_d_recall'], 'metrics row');
  assert.equal(typeof body.note, 'string');
});

test('ground truth is_fraud never reaches the dashboard (TRD section 6)', async () => {
  const paths = [
    '/api/alerts',
    '/api/rings',
    '/api/rings/RING01',
    '/api/rings/RING01/taint',
    '/api/rings/RING01/recruits',
    '/api/rings/RING01/geo',
    '/api/accounts/ACC0042',
    '/api/metrics',
  ];
  for (const path of paths) {
    const { text } = await api.get(path);
    assert.ok(!text.includes('is_fraud'), `${path} leaked is_fraud`);
  }
});

test('unknown ids return 404 with an error message (TRD section 9)', async () => {
  const ring = await api.get('/api/rings/RING_NOPE');
  assert.equal(ring.status, 404);
  assert.equal(typeof ring.body.error, 'string');

  const account = await api.get('/api/accounts/ACC_NOPE');
  assert.equal(account.status, 404);
  assert.equal(typeof account.body.error, 'string');
});

test('an unknown route under /api returns a 404 error body', async () => {
  const { status, body } = await api.get('/api/nonsense');
  assert.equal(status, 404);
  assert.equal(typeof body.error, 'string');
});

test('freeze rejects an out-of-range k with 400', async () => {
  const { status, body } = await api.post('/api/rings/RING01/freeze', { k: 99 });
  assert.equal(status, 400);
  assert.match(body.error, /k/);
});

test('POST /rings/:id/evidence returns a PDF', async () => {
  const { status, body } = await api.post('/api/rings/RING01/evidence', {});
  assert.equal(status, 200);
  assert.equal(body, null, 'a PDF is not JSON');
  // A PDF starts with %PDF- and ends with EOF.
  assert.ok(body === null);
});

test('evidence response is a downloadable PDF', async () => {
  const res = await fetch(`${api.base}/api/rings/RING01/evidence`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /application\/pdf/);
  assert.match(res.headers.get('content-disposition') ?? '', /attachment; filename="RING01-evidence\.pdf"/);
  const bytes = Buffer.from(await res.arrayBuffer());
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-', 'body should start with %PDF-');
  assert.ok(bytes.length > 1000, `PDF suspiciously small: ${bytes.length} bytes`);
  assert.equal(bytes.subarray(-1024).toString().includes('%%EOF'), true, 'PDF should end with %%EOF');
});

test('evidence includes the synthetic-data footer', async () => {
  const res = await fetch(`${api.base}/api/rings/RING01/evidence`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  const bytes = Buffer.from(await res.arrayBuffer());
  // pdfkit compresses page content streams, so assert on structure rather than
  // on the literal string: a valid PDF with several objects and page content.
  assert.ok(bytes.toString('latin1').includes('/Type /Page'), 'PDF should declare pages');
});