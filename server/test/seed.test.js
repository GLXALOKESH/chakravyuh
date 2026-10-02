/**
 * Seeding (TRD section 9).
 *
 * "npm run seed reads data/<profile>/*.json and data/<profile>/outputs/*.json,
 * drops the collections and inserts everything. It must be safe to run
 * repeatedly." This file asserts that repeatability: seeding twice leaves the
 * same row counts rather than doubling them.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, shutdown } from './helpers.js';
import { queryOne } from '../src/db/index.js';

let seed;

before(async () => {
  await freshDb();
  ({ seed } = await import('../src/seed.js'));
});

after(async () => {
  await shutdown();
});

const count = async (table) => Number((await queryOne(`SELECT count(*)::bigint AS n FROM ${table}`))?.n ?? 0);

test('seeding again does not duplicate rows', async () => {
  const first = await seed('demo', { forceFixtures: true });
  const before = { ...first.counts };

  const second = await seed('demo', { forceFixtures: true });
  assert.deepEqual(second.counts, before, 'row counts must be identical after a reseed');

  assert.equal(await count('accounts'), before.accounts);
  assert.equal(await count('transactions'), before.transactions);
  assert.equal(await count('rings'), before.rings);
  assert.equal(await count('alerts'), before.alerts);
  assert.equal(await count('identifiers'), before.identifiers);
});

test('seeding is reported as coming from the fixtures when data/ is absent', async () => {
  const result = await seed('demo', { forceFixtures: true });
  assert.equal(result.source, 'server/devFixtures.js');
});

test('a missing profile without the fixture fallback fails loudly', async () => {
  await assert.rejects(seed('does-not-exist', { forceFixtures: false }), /no data\/does-not-exist\/ found/);
});

test('seed_meta records the last seed so freshness is visible', async () => {
  await seed('demo', { forceFixtures: true });
  const row = await queryOne(`SELECT value FROM seed_meta WHERE key = 'last_seed'`);
  assert.ok(row, 'expected a last_seed row');
  const value = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
  assert.equal(value.profile, 'demo');
  assert.ok(value.seeded_at, 'expected a seeded_at timestamp');
  assert.ok(value.source, 'expected a source');
});

test('metrics keeps exactly one row', async () => {
  await seed('demo', { forceFixtures: true });
  assert.equal(await count('metrics'), 1);
});

test('a failed seed leaves the previous data intact', async () => {
  await seed('demo', { forceFixtures: true });
  const accountsBefore = await count('accounts');
  const txnsBefore = await count('transactions');

  // An invalid channel violates the CHECK constraint, so the whole transaction
  // must roll back rather than truncating and then half-loading.
  const { transaction } = await import('../src/db/index.js');
  const { default: transactionsModel } = await import('../src/models/transactions.js');
  const { buildFixtures } = await import('../devFixtures.js');

  const broken = buildFixtures();
  broken.transactions[0] = { ...broken.transactions[0], channel: 'CARRIER_PIGEON' };

  await assert.rejects(
    transaction(async (tx) => {
      await tx.exec('TRUNCATE accounts, transactions RESTART IDENTITY CASCADE;');
      await transactionsModel.upsertMany(broken.transactions, tx);
    }),
  );

  assert.equal(await count('accounts'), accountsBefore, 'truncate should have rolled back');
  assert.equal(await count('transactions'), txnsBefore, 'partial insert should have rolled back');
});