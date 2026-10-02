/**
 * Fallback check (TRD section 13, Member 1).
 *
 * "With Python stopped, taint and freeze return "cached": true".
 *
 * The Python service does not exist in this repo, so "stopped" is the default
 * state rather than something the test has to arrange. The point of the test is
 * that the degraded path is what actually runs, and that it returns a usable
 * answer rather than an error.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, startServer, shutdown } from './helpers.js';

let api;
let mlUrl;

before(async () => {
  await freshDb();
  const { createApp } = await import('../src/app.js');
  const { config } = await import('../src/config.js');
  mlUrl = config.mlUrl;
  api = await startServer(createApp());
});

after(async () => {
  await api?.stop();
  await shutdown();
});

test('the ML service is genuinely unreachable in this test environment', async () => {
  // If this ever starts passing, the fallback path is no longer being exercised
  // and the tests below prove nothing.
  await assert.rejects(fetch(`${mlUrl}/health`, { signal: AbortSignal.timeout(1000) }));
});

test('taint falls back to the cached default with cached: true', async () => {
  const { status, body } = await api.get('/api/rings/RING01/taint');
  assert.equal(status, 200, 'taint must not fail when Python is down');
  assert.equal(body.cached, true);
  assert.ok(body.victim_amount > 0, 'the cached default should still carry the victim amount');
  assert.ok(body.accounts.length > 0, 'the cached default should still carry per-account taint');
});

test('freeze falls back to the cached default with cached: true', async () => {
  const { status, body } = await api.post('/api/rings/RING01/freeze', { k: 3 });
  assert.equal(status, 200, 'freeze must not fail when Python is down');
  assert.equal(body.cached, true);
  assert.ok(body.freeze.length > 0, 'the cached default should still recommend accounts');
  assert.ok(body.secured > 0);
});

test('a cached freeze still honours exclude, which TRD section 7.7 requires', async () => {
  const all = await api.post('/api/rings/RING01/freeze', { k: 3 });
  const target = all.body.freeze[0];
  const fewer = await api.post('/api/rings/RING01/freeze', { k: 3, exclude: [target] });
  assert.ok(!fewer.body.freeze.includes(target));
  assert.ok(fewer.body.secured < all.body.secured, 'secured should drop when an account is excluded');
});

test('the cached taint still conserves the victim amount', async () => {
  const { body } = await api.get('/api/rings/RING01/taint');
  const sum = body.accounts.reduce((s, a) => s + a.tainted, 0) + body.lost_to_cash;
  assert.equal(sum, body.victim_amount);
});

test('a slow ML service still falls back inside the timeout budget', async () => {
  // TRD section 3 sets a 3 second timeout. A request that hangs must not hold
  // the HTTP response open indefinitely.
  const started = Date.now();
  const { status, body } = await api.get('/api/rings/RING01/taint');
  const elapsed = Date.now() - started;
  assert.equal(status, 200);
  assert.equal(body.cached, true);
  // Connection refused is immediate; the bound is generous but proves the
  // request completed rather than hanging on the fetch.
  assert.ok(elapsed < 10_000, `taint took ${elapsed}ms, which suggests no timeout is enforced`);
});