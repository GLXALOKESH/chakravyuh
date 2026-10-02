/**
 * Seeding (TRD section 9).
 *
 * "npm run seed reads data/<profile>/*.json and data/<profile>/outputs/*.json,
 * drops the tables and inserts everything. It must be safe to run repeatedly."
 * This file asserts that repeatability: seeding twice leaves the same row counts
 * rather than doubling them, and a failure part way through rolls back.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/configs/prisma.js';
import { loadProfile, seed } from '../src/services/seed.service.js';
import { getLastSeed, truncateAll } from '../src/repositories/seed.repository.js';
import { buildFixtures } from '../src/fixtures/generator.js';
import * as transactions from '../src/repositories/transactions.repository.js';
import { freshDb, hasDatabase, shutdown } from './helpers.js';

afterAll(async () => {
  if (hasDatabase()) await shutdown();
});

/** Row counts, read straight from Prisma rather than through a repository. */
const count = async (): Promise<Record<string, number>> => {
  const db = prisma();
  const [account, transaction, ring, alert, identifier, metric] = await Promise.all([
    db.account.count(),
    db.transaction.count(),
    db.ring.count(),
    db.alert.count(),
    db.identifier.count(),
    db.metric.count(),
  ]);
  return { account, transaction, ring, alert, identifier, metric };
};

describe.skipIf(!hasDatabase())('seeding', () => {
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
    // transactions have no relation on from_account/to_account, so CASH is a
    // legal counterparty. If a foreign key had been added, this would have
    // failed at seed time instead.
    const cashouts = await prisma().transaction.count({ where: { toAccount: 'CASH' } });
    expect(cashouts).toBeGreaterThan(0);
    const cashAccount = await prisma().account.findUnique({ where: { id: 'CASH' } });
    expect(cashAccount, 'CASH must not be a row in accounts').toBeNull();
  });

  it('a failed load leaves the previous data intact', async () => {
    await seed('demo', { forceFixtures: true });
    const accountsBefore = (await count()).account;
    const txnsBefore = (await count()).transaction;

    // An unknown channel violates the enum, so the whole transaction must roll
    // back rather than truncating and then half-loading.
    const broken = buildFixtures();
    broken.transactions[0] = { ...broken.transactions[0]!, channel: 'CARRIER_PIGEON' };

    await expect(
      prisma().$transaction(async (tx) => {
        await truncateAll(tx);
        await transactions.insertMany(broken.transactions, tx);
      }),
    ).rejects.toThrow();

    expect((await count()).account, 'truncate should have rolled back').toBe(accountsBefore);
    expect((await count()).transaction, 'partial insert should have rolled back').toBe(txnsBefore);
  });

  it('jsonb columns round-trip through the database', async () => {
    await seed('demo', { forceFixtures: true });
    const ring = await prisma().ring.findUnique({ where: { id: 'RING01' } });
    // Prisma returns Json columns already parsed, so a string here would mean the
    // value was written as a JSON string rather than an object.
    expect(typeof ring!.edges).toBe('object');
    expect(Array.isArray(ring!.edges)).toBe(true);
    expect(Array.isArray(ring!.memberIds)).toBe(true);
    expect(typeof ring!.defaultTaint).toBe('object');
  });

  it('timestamptz columns round-trip as Dates', async () => {
    await seed('demo', { forceFixtures: true });
    const txn = await prisma().transaction.findUnique({ where: { id: 'TXN003975' } });
    expect(txn!.ts).toBeInstanceOf(Date);
    expect(Number.isNaN(txn!.ts.getTime())).toBe(false);
  });
});
