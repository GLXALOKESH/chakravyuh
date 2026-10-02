/**
 * Seeding (TRD section 9).
 *
 * "npm run seed reads data/<profile>/*.json and data/<profile>/outputs/*.json,
 * drops the tables and inserts everything. It must be safe to run repeatedly."
 * This file asserts that repeatability: seeding twice leaves the same row counts
 * rather than doubling them, and a failure part way through rolls back.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { withTransaction } from '../src/configs/mongoose.js';
import { Account, Alert, Identifier, Metric, Ring, Transaction } from '../src/models/index.js';
import { loadProfile, seed } from '../src/services/seed.service.js';
import { getLastSeed, truncateAll } from '../src/repositories/seed.repository.js';
import { buildFixtures } from '../src/fixtures/generator.js';
import * as transactions from '../src/repositories/transactions.repository.js';
import { freshDb, shutdown } from './helpers.js';

afterAll(async () => {
  await shutdown();
});

/** Document counts, read straight from the models rather than a repository. */
const count = async (): Promise<Record<string, number>> => {
  const [account, transaction, ring, alert, identifier, metric] = await Promise.all([
    Account.countDocuments({}).exec(),
    Transaction.countDocuments({}).exec(),
    Ring.countDocuments({}).exec(),
    Alert.countDocuments({}).exec(),
    Identifier.countDocuments({}).exec(),
    Metric.countDocuments({}).exec(),
  ]);
  return { account, transaction, ring, alert, identifier, metric };
};

describe('seeding', () => {
  it('seeding again does not duplicate rows', async () => {
    const first = await freshDb();
    const second = await seed('demo', { forceFixtures: true });
    expect(second.counts, 'row counts must be identical after a reseed').toEqual(first.counts);

    expect((await count()).account).toBe(first.counts.accounts);
    expect((await count()).transaction).toBe(first.counts.transactions);
    expect((await count()).ring).toBe(first.counts.rings);
    expect((await count()).alert).toBe(first.counts.alerts);
    expect((await count()).identifier).toBe(first.counts.identifiers);
  });

  it('the demo dataset has the sizes the PRD describes', async () => {
    const result = await seed('demo', { forceFixtures: true });
    expect(result.counts.accounts).toBe(600);
    expect(result.counts.transactions).toBeGreaterThan(4500);
    expect(result.counts.rings).toBe(3);
    expect(result.counts.alerts).toBe(3);
  });

  it('reports coming from the fixtures when data/ is absent', async () => {
    const result = await seed('demo', { forceFixtures: true });
    expect(result.source).toContain('fixtures');
  });

  it('a missing profile without the fixture fallback fails loudly', async () => {
    await expect(seed('does-not-exist', { forceFixtures: false })).rejects.toThrow(/no data\/does-not-exist\/ found/);
  });

  it('loadProfile returns null for a profile that is not on disk', async () => {
    expect(await loadProfile('does-not-exist')).toBeNull();
  });

  it('seed_meta records the last seed so freshness is visible', async () => {
    await seed('demo', { forceFixtures: true });
    const record = await getLastSeed();
    expect(record, 'expected a last_seed row').toBeTruthy();
    expect(record!.profile).toBe('demo');
    expect(record!.seeded_at).toBeTruthy();
    expect(record!.source).toBeTruthy();
  });

  it('metrics keeps exactly one row', async () => {
    await seed('demo', { forceFixtures: true });
    expect((await count()).metric).toBe(1);
  });

  it('the cash-out sentinel is stored, not expanded into a fake account', async () => {
    await seed('demo', { forceFixtures: true });
    // MongoDB has no foreign keys, so CASH is a legal counterparty without an
    // account document of its own. In a relational schema this would have
    // needed either a fake account row, which would then appear in account
    // listings, or a nullable column and a special case in every query.
    const cashouts = await Transaction.countDocuments({ to: 'CASH' }).exec();
    expect(cashouts).toBeGreaterThan(0);
    const cashAccount = await Account.findById('CASH').lean().exec();
    expect(cashAccount, 'CASH must not be a document in accounts').toBeNull();
  });

  it('a failed load leaves the previous data intact', async () => {
    await seed('demo', { forceFixtures: true });
    const accountsBefore = (await count()).account;
    const txnsBefore = (await count()).transaction;

    // An unknown channel breaks the schema's enum, so the whole transaction must
    // roll back rather than clearing and then half-loading.
    const broken = buildFixtures();
    broken.transactions[0] = { ...broken.transactions[0]!, channel: 'CARRIER_PIGEON' };

    await expect(
      withTransaction(async (tx) => {
        await truncateAll(tx);
        await transactions.insertMany(broken.transactions, tx);
      }),
    ).rejects.toThrow();

    expect((await count()).account, 'the clear should have rolled back').toBe(accountsBefore);
    expect((await count()).transaction, 'the partial insert should have rolled back').toBe(txnsBefore);
  });

  it('subdocuments round-trip as structures, not strings', async () => {
    await seed('demo', { forceFixtures: true });
    const ring = await Ring.findById('RING01').lean().exec();
    // A string here would mean the value was written as a JSON string rather
    // than as an embedded document.
    expect(typeof ring!.edges).toBe('object');
    expect(Array.isArray(ring!.edges)).toBe(true);
    expect(Array.isArray(ring!.member_ids)).toBe(true);
    expect(typeof ring!.default_taint).toBe('object');
  });

  it('dates round-trip as Dates, not strings', async () => {
    await seed('demo', { forceFixtures: true });
    const txn = await Transaction.findById('TXN003975').lean().exec();
    expect(txn!.ts).toBeInstanceOf(Date);
    expect(Number.isNaN(txn!.ts.getTime())).toBe(false);
  });

  it('the schema rejects a channel outside the four of TRD section 6', async () => {
    await seed('demo', { forceFixtures: true });
    // The enum the relational schema enforced in the database now lives on the
    // Mongoose schema, so an unknown channel still fails at write time rather
    // than being stored and reaching the dashboard.
    const broken = buildFixtures();
    broken.transactions[0] = { ...broken.transactions[0]!, channel: 'CARRIER_PIGEON' };
    await expect(transactions.insertMany(broken.transactions)).rejects.toThrow(/CARRIER_PIGEON/);
  });
});
