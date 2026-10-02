/**
 * ML fallback (TRD section 13, Member 1).
 *
 * "With Python stopped, taint and freeze return cached: true."
 *
 * The Python service does not exist in this repo, so "stopped" is the default
 * state rather than something the test has to arrange. The point of the file is
 * that the degraded path is what actually runs, and that it returns a usable
 * answer rather than an error. Nothing here needs a database: the client takes
 * its cached default as an argument, which is exactly the contract.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config } from '../src/configs/env.js';
import { freeze, health, taint } from '../src/services/ml.service.js';
import { buildFixtures } from '../src/fixtures/generator.js';
import { freshDb, hasDatabase, shutdown, startServer, type TestClient } from './helpers.js';
import { createApp } from '../src/app.js';
import type { FreezePayload, TaintPayload } from '../src/interfaces/domain.interface.js';

const fixtures = buildFixtures();
const ring = fixtures.rings.find((r) => r.id === 'RING01')!;
const cachedTaint = ring.default_taint as unknown as TaintPayload;
const cachedFreeze = ring.default_freeze as unknown as FreezePayload;

const request = { ring_id: 'RING01', victim_txn_id: 'TXN003975', as_of: null };

describe('ML client fallback', () => {
  it('the ML service is genuinely unreachable in this test environment', async () => {
    // If this ever starts passing, the fallback path is no longer being exercised
    // and the rest of this file proves nothing.
    await expect(
      fetch(`${config.mlUrl.replace(/\/$/, '')}/health`, { signal: AbortSignal.timeout(1000) }),
    ).rejects.toThrow();
  });

  it('taint returns the cached default with cached: true', async () => {
    const result = await taint(request, cachedTaint);
    expect(result.cached).toBe(true);
    expect(result.payload.cached).toBe(true);
    expect(result.payload.victim_amount).toBe(cachedTaint.victim_amount);
    expect(result.payload.accounts.length).toBeGreaterThan(0);
    expect(result.error, 'the degraded path should say why').toContain('/taint');
  });

  it('freeze returns the cached default with cached: true', async () => {
    const result = await freeze({ ...request, k: 3, exclude: [] }, cachedFreeze);
    expect(result.cached).toBe(true);
    expect(result.payload.freeze.length).toBeGreaterThan(0);
    expect(result.payload.secured).toBeGreaterThan(0);
  });

  it('the empty fallback is still a valid, conserving payload', async () => {
    // A ring with no cached default must not produce a malformed response.
    const result = await taint(request, null);
    expect(result.cached).toBe(true);
    expect(result.payload.victim_amount).toBe(0);
    expect(result.payload.accounts).toEqual([]);
    expect(result.payload.links).toEqual([]);
  });

  it('the cached taint conserves the victim amount', async () => {
    const { payload } = await taint(request, cachedTaint);
    const sum = payload.accounts.reduce((s, a) => s + a.tainted, 0) + payload.lost_to_cash;
    expect(sum).toBe(payload.victim_amount);
  });

  it('health surfaces the failure rather than swallowing it', async () => {
    await expect(health()).rejects.toThrow();
  });
});

// The routes, not just the client. Needs the seeded ring, so it waits for a
// database.
describe.skipIf(!hasDatabase())('ML fallback through the routes', () => {
  let api: TestClient;

  beforeAll(async () => {
    await freshDb();
    api = await startServer(createApp());
  });

  afterAll(async () => {
    await api?.stop();
    await shutdown();
  });

  it('GET /rings/:id/taint does not fail when Python is down', async () => {
    const { status, body } = await api.get('/api/rings/RING01/taint');
    expect(status).toBe(200);
    expect(body.cached).toBe(true);
    expect(body.victim_amount).toBeGreaterThan(0);
    expect(body.accounts.length).toBeGreaterThan(0);
  });

  it('POST /rings/:id/freeze does not fail when Python is down', async () => {
    const { status, body } = await api.post('/api/rings/RING01/freeze', { k: 3 });
    expect(status).toBe(200);
    expect(body.cached).toBe(true);
    expect(body.freeze.length).toBeGreaterThan(0);
  });

  it('a cached freeze still honours exclude, which TRD section 7.7 requires', async () => {
    const all = await api.post('/api/rings/RING01/freeze', { k: 3 });
    const target = all.body.freeze[0];
    const fewer = await api.post('/api/rings/RING01/freeze', { k: 3, exclude: [target] });
    expect(fewer.body.freeze).not.toContain(target);
    expect(fewer.body.secured, 'secured should drop when an account is excluded').toBeLessThan(all.body.secured);
  });

  it('excluding an account lowers pct_stopped, which demo step 6 depends on', async () => {
    const all = await api.post('/api/rings/RING01/freeze', { k: 3 });
    const fewer = await api.post('/api/rings/RING01/freeze', { k: 3, exclude: [all.body.freeze[0]] });
    expect(fewer.body.pct_stopped).toBeLessThan(all.body.pct_stopped);
  });

  it('a request completes inside the timeout budget rather than hanging', async () => {
    const started = Date.now();
    const { status, body } = await api.get('/api/rings/RING01/taint');
    const elapsed = Date.now() - started;
    expect(status).toBe(200);
    expect(body.cached).toBe(true);
    expect(elapsed, `taint took ${elapsed}ms, which suggests no timeout is enforced`).toBeLessThan(10_000);
  });
});
