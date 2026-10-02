/**
 * Contract check, real data (TRD section 13, Member 1).
 *
 * "Every endpoint returns the shapes in section 8, with mocks and with real
 * data." This file covers the real half; mocks.contract.test.ts covers the other.
 *
 * Runs against a real MongoDB. global-setup.ts supplies MONGO_URL when one is
 * configured and otherwise starts its own mongod, so this file always executes
 * rather than skipping.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { freshDb, hasKeys, isNumber, ISO_SECONDS, shutdown, startServer, type TestClient } from './helpers.js';

let api: TestClient;

beforeAll(async () => {
  await freshDb();
  api = await startServer(createApp());
});

afterAll(async () => {
  await api?.stop();
  await shutdown();
});

describe('API contract, real data', () => {
  it('GET /api/alerts returns the section 8 alert shape', async () => {
    const { status, body } = await api.get('/api/alerts');
    expect(status).toBe(200);
    expect(Array.isArray(body) && body.length > 0, 'expected a non-empty alert list').toBeTruthy();

    for (const alert of body) {
      hasKeys(alert, ['id', 'ring_id', 'fired_at', 'risk', 'members', 'volume', 'reason'], 'alert');
      expect(alert.fired_at).toMatch(ISO_SECONDS);
      isNumber(alert.risk, 'alert.risk');
      isNumber(alert.members, 'alert.members');
      isNumber(alert.volume, 'alert.volume');
      expect(typeof alert.reason).toBe('string');
    }
  });

  it('GET /api/rings returns the overview list', async () => {
    const { status, body } = await api.get('/api/rings');
    expect(status).toBe(200);
    expect(body.length).toBe(3);
    for (const ring of body) {
      hasKeys(ring, ['id', 'risk', 'volume', 'members'], 'ring summary');
      isNumber(ring.members, 'members');
    }
  });

  it('GET /api/rings/:id returns nodes and edges in the section 8 shape', async () => {
    const { status, body } = await api.get('/api/rings/RING01');
    expect(status).toBe(200);
    hasKeys(body, ['id', 'risk', 'volume', 'nodes', 'edges', 'victim_txn_ids'], 'ring');

    expect(body.nodes.length).toBeGreaterThan(0);
    for (const node of body.nodes) {
      hasKeys(node, ['id', 'type'], 'node');
      expect(['account', 'device', 'phone', 'ip']).toContain(node.type);
      if (node.type === 'account') {
        hasKeys(node, ['id', 'type', 'role', 'risk'], 'account node');
        isNumber(node.risk, 'account node risk');
        expect(typeof node.role).toBe('string');
      }
    }

    for (const edge of body.edges) {
      hasKeys(edge, ['source', 'target', 'kind'], 'edge');
      expect(['txn', 'identity']).toContain(edge.kind);
      if (edge.kind === 'txn') isNumber(edge.amount, 'txn edge amount');
    }

    expect(Array.isArray(body.victim_txn_ids)).toBe(true);
  });

  it('a ring carries both transaction and identity edges', async () => {
    const { body } = await api.get('/api/rings/RING01');
    expect(body.edges.some((e: { kind: string }) => e.kind === 'identity')).toBe(true);
    expect(body.nodes.some((n: { type: string }) => n.type !== 'account')).toBe(true);
  });

  it('GET /api/accounts/:id returns features, role, signals and identifiers', async () => {
    const { status, body } = await api.get('/api/accounts/ACC0042');
    expect(status).toBe(200);
    hasKeys(
      body,
      [
        'id',
        'holder',
        'bank',
        'home',
        'opened_at',
        'features',
        'risk_v1',
        'risk_v2',
        'signals',
        'role',
        'role_reason',
        'linked_identifiers',
      ],
      'account',
    );
    expect(body.opened_at).toMatch(ISO_SECONDS);
    expect(typeof body.features).toBe('object');
    expect(Array.isArray(body.signals)).toBe(true);
    expect(Array.isArray(body.linked_identifiers)).toBe(true);
    for (const signal of body.signals) hasKeys(signal, ['feature', 'label', 'weight'], 'signal');
    for (const id of body.linked_identifiers) hasKeys(id, ['id', 'type', 'account_ids'], 'identifier');
  });

  it('GET /api/rings/:id/taint returns the section 8 taint shape', async () => {
    const { status, body } = await api.get('/api/rings/RING01/taint');
    expect(status).toBe(200);
    hasKeys(body, ['victim_amount', 'as_of', 'cached', 'accounts', 'lost_to_cash', 'links'], 'taint');
    isNumber(body.victim_amount, 'victim_amount');
    isNumber(body.lost_to_cash, 'lost_to_cash');
    expect(typeof body.cached).toBe('boolean');
    expect(body.as_of).toMatch(ISO_SECONDS);

    for (const account of body.accounts) hasKeys(account, ['id', 'balance', 'tainted', 'lien'], 'taint account');
    for (const link of body.links) hasKeys(link, ['source', 'target', 'value'], 'taint link');
  });

  it('taint conserves the victim amount (TRD section 13)', async () => {
    const { body } = await api.get('/api/rings/RING01/taint');
    const sum = body.accounts.reduce((s: number, a: { tainted: number }) => s + a.tainted, 0) + body.lost_to_cash;
    expect(sum, 'tainted amounts plus lost-to-cash must equal the victim amount').toBe(body.victim_amount);
  });

  it('the recommended lien never exceeds the balance', async () => {
    const { body } = await api.get('/api/rings/RING01/taint');
    for (const account of body.accounts) {
      expect(account.lien).toBeLessThanOrEqual(account.balance);
      expect(account.lien).toBe(Math.min(account.tainted, account.balance));
    }
  });

  it('POST /api/rings/:id/freeze returns the section 8 freeze shape', async () => {
    const { status, body } = await api.post('/api/rings/RING01/freeze', { k: 3 });
    expect(status).toBe(200);
    hasKeys(body, ['freeze', 'at_risk_before', 'secured', 'pct_stopped', 'cached'], 'freeze');
    expect(Array.isArray(body.freeze)).toBe(true);
    isNumber(body.at_risk_before, 'at_risk_before');
    isNumber(body.secured, 'secured');
    isNumber(body.pct_stopped, 'pct_stopped');
    expect(body.secured, 'TRD section 13 freeze sanity').toBeLessThanOrEqual(body.at_risk_before);
    expect(body.pct_stopped).toBeGreaterThanOrEqual(0);
    expect(body.pct_stopped).toBeLessThanOrEqual(1);
  });

  it('an excluded account is never recommended (TRD section 13)', async () => {
    const { body } = await api.post('/api/rings/RING01/freeze', { k: 3, exclude: ['ACC0040'] });
    expect(body.freeze).not.toContain('ACC0040');
  });

  it('excluding an account lowers the percentage stopped (demo step 6)', async () => {
    const all = await api.post('/api/rings/RING01/freeze', { k: 3 });
    const fewer = await api.post('/api/rings/RING01/freeze', { k: 3, exclude: [all.body.freeze[0]] });
    expect(fewer.body.pct_stopped).toBeLessThan(all.body.pct_stopped);
  });

  it('k caps the number of recommendations', async () => {
    const { body } = await api.post('/api/rings/RING01/freeze', { k: 1 });
    expect(body.freeze.length).toBeLessThanOrEqual(1);
  });

  it('GET /api/rings/:id/recruits returns the section 8 recruits shape', async () => {
    const { status, body } = await api.get('/api/rings/RING01/recruits');
    expect(status).toBe(200);
    expect(Array.isArray(body) && body.length > 0).toBeTruthy();
    for (const recruit of body) {
      hasKeys(recruit, ['id', 'probability', 'reasons'], 'recruit');
      isNumber(recruit.probability, 'probability');
      expect(recruit.probability).toBeGreaterThanOrEqual(0);
      expect(recruit.probability).toBeLessThanOrEqual(1);
      expect(Array.isArray(recruit.reasons) && recruit.reasons.length > 0, 'expected top reasons').toBeTruthy();
    }
    // Descending by probability so the dashboard can render the list as-is.
    const probabilities = body.map((r: { probability: number }) => r.probability);
    expect(probabilities).toEqual([...probabilities].sort((a, b) => b - a));
  });

  it('GET /api/rings/:id/geo returns the section 8 geo shape', async () => {
    const { status, body } = await api.get('/api/rings/RING01/geo');
    expect(status).toBe(200);
    hasKeys(body, ['spread_km', 'cities', 'homes', 'cashouts'], 'geo');
    isNumber(body.spread_km, 'spread_km');
    for (const home of body.homes) hasKeys(home, ['account_id', 'city', 'lat', 'lng'], 'home');
    for (const cashout of body.cashouts) {
      hasKeys(cashout, ['txn_id', 'account_id', 'city', 'lat', 'lng', 'amount', 'ts'], 'cashout');
      expect(cashout.ts).toMatch(ISO_SECONDS);
    }
  });

  it('GET /api/metrics returns the V1 against V2 table', async () => {
    const { status, body } = await api.get('/api/metrics');
    expect(status).toBe(200);
    hasKeys(body, ['rows', 'note'], 'metrics');
    expect(Array.isArray(body.rows) && body.rows.length >= 2).toBeTruthy();
    for (const row of body.rows) hasKeys(row, ['model', 'pr_auc', 'ring_recall', 'pattern_d_recall'], 'metrics row');
    expect(typeof body.note).toBe('string');
  });

  it('ground truth is_fraud never reaches the dashboard (TRD section 6)', async () => {
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
      expect(text.includes('is_fraud'), `${path} leaked is_fraud`).toBe(false);
    }
  });

  it('unknown ids return 404 with an error message (TRD section 9)', async () => {
    const ring = await api.get('/api/rings/RING_NOPE');
    expect(ring.status).toBe(404);
    expect(typeof ring.body.error).toBe('string');

    const account = await api.get('/api/accounts/ACC_NOPE');
    expect(account.status).toBe(404);
    expect(typeof account.body.error).toBe('string');
  });

  it('an unknown route under /api returns a 404 error body', async () => {
    const { status, body } = await api.get('/api/nonsense');
    expect(status).toBe(404);
    expect(typeof body.error).toBe('string');
  });

  it('freeze rejects an out-of-range k with 400 (DTO validation)', async () => {
    const { status, body } = await api.post('/api/rings/RING01/freeze', { k: 99 });
    expect(status).toBe(400);
    expect(body.error).toMatch(/k/);
  });

  it('freeze rejects a non-integer k with 400', async () => {
    const { status } = await api.post('/api/rings/RING01/freeze', { k: 'lots' });
    expect(status).toBe(400);
  });

  it('taint rejects a malformed as_of with 400', async () => {
    const { status } = await api.get('/api/rings/RING01/taint?as_of=yesterday');
    expect(status).toBe(400);
  });

  it('a malformed id is rejected before it reaches the database', async () => {
    const { status, body } = await api.get('/api/rings/acc%20with%20spaces');
    expect(status).toBe(400);
    expect(body.error).toMatch(/invalid request/);
  });

  it('GET /health reports the database it is talking to', async () => {
    const { status, body } = await api.get('/health');
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    hasKeys(body, ['ok', 'database', 'mocks', 'ml_url', 'replay'], 'health');
    expect(body.database.driver).toContain('mongodb');
    // Atlas is reported distinctly from a local mongod, because they need
    // different setup notes when a connection fails.
    expect(body.database.host).toBeTruthy();
    expect(body.database.database).toBeTruthy();
  });

  it('POST /rings/:id/evidence returns a downloadable PDF', async () => {
    const res = await fetch(`${api.base}/api/rings/RING01/evidence`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toMatch(/application\/pdf/);
    expect(res.headers.get('content-disposition') ?? '').toMatch(/attachment; filename="RING01-evidence\.pdf"/);
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(1000);
    expect(bytes.subarray(-1024).toString().includes('%%EOF')).toBe(true);
    expect(bytes.toString('latin1')).toContain('/Type /Page');
  });

  it('a PDF body is not parsed as JSON', async () => {
    const { body } = await api.post('/api/rings/RING01/evidence', {});
    expect(body).toBeNull();
  });
});
