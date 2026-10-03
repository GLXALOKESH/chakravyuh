import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import { config } from '../src/configs/env.js';
import { connect, db, withTransaction } from '../src/configs/mongoose.js';
import { Account } from '../src/models/index.js';
import * as accounts from '../src/repositories/accounts.repository.js';
import { insertBatches } from '../src/repositories/bulk.repository.js';
import * as seedRepository from '../src/repositories/seed.repository.js';
import { seed } from '../src/services/seed.service.js';
import { logQuery, withDbLog } from '../src/utilities/db-log.util.js';
import { freshDb, shutdown } from './helpers.js';
import { captureLogs } from './logging.helpers.js';

beforeAll(async () => { await freshDb(); });
afterAll(shutdown);
const settings = { ...config.logging };
afterEach(() => { Object.assign(config.logging, settings); vi.restoreAllMocks(); });

describe('database logging', () => {
  it('logs real queries with correct result counts, operation names and no document/filter values', async () => {
    const logs = captureLogs();
    await logs.run(async () => {
      expect(await accounts.getById('MISSING_PRIVATE_ID')).toBeNull();
      expect(await accounts.count()).toBe(600);
      expect(await accounts.listByRing('RING01')).toHaveLength(10);
    }, { request_id: 'request-1' });
    expect(logs.of('db.operation').map((r) => r.operation)).toEqual(['findOne', 'countDocuments', 'find']);
    expect(logs.of('db.result').map((r) => r.returned_count ?? r.count_value)).toEqual([0, 600, 10]);
    expect(logs.records.every((r) => r.database === db().name && r.request_id === 'request-1')).toBe(true);
    expect(JSON.stringify(logs.records)).not.toMatch(/MISSING_PRIVATE_ID|RING01|holder|opening_balance/);
  });

  it('runs a callback once and preserves both its exact result and exact error', async () => {
    const logs = captureLogs();
    const result = { acknowledged: true, modifiedCount: 2, matchedCount: 3 };
    const execute = vi.fn(async () => result);
    expect(await logs.run(() => withDbLog({ collection: 'accounts', operation: 'updateMany' }, execute))).toBe(result);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(logs.of('db.result')[0]).toMatchObject({ modified_count: 2, matched_count: 3 });
    const error = new Error('secret document');
    const reject = vi.fn(async () => { throw error; });
    await expect(logs.run(() => withDbLog({ collection: 'accounts', operation: 'find' }, reject))).rejects.toBe(error);
    expect(reject).toHaveBeenCalledTimes(1);
    expect(logs.of('db.error')).toHaveLength(1);
    expect(JSON.stringify(logs.records)).not.toContain('secret document');
  });

  it('marks slow results without adding another query', async () => {
    Object.assign(config.logging, { dbSlowMs: 0 });
    const logs = captureLogs();
    await logs.run(() => accounts.getById('not-found'));
    expect(logs.of('db.result')).toHaveLength(1);
    expect(logs.of('db.result')[0]).toMatchObject({ slow: true, level: 40, returned_count: 0 });
  });

  it('disabling database logs still executes the operation and preserves failures', async () => {
    Object.assign(config.logging, { dbEnabled: false });
    const logs = captureLogs();
    expect(await logs.run(() => accounts.count())).toBe(600);
    const error = new Error('failure');
    await expect(logs.run(() => withDbLog({ collection: 'accounts', operation: 'find' }, async () => { throw error; }))).rejects.toBe(error);
    expect(logs.records).toHaveLength(0);
  });

  it('tracks parallel reads separately under the same request', async () => {
    const logs = captureLogs();
    await logs.run(() => Promise.all([accounts.count(), accounts.getById('ACC0040')]), { request_id: 'parallel' });
    const starts = logs.of('db.operation');
    expect(new Set(starts.map((r) => r.operation_id)).size).toBe(2);
    for (const start of starts) expect(logs.of('db.result').filter((r) => r.operation_id === start.operation_id)).toHaveLength(1);
    expect(logs.records.every((r) => r.request_id === 'parallel')).toBe(true);
  });

  it('captures raw collection truncation and rollback with no commit-success event', async () => {
    const logs = captureLogs();
    const failure = new Error('stop');
    await expect(logs.run(() => withTransaction(async (session) => {
      await seedRepository.truncateAll(session);
      expect(await logQuery(Account.countDocuments({}).session(session))).toBe(0);
      throw failure;
    }), { seed_id: 'rollback' })).rejects.toBe(failure);
    expect(await Account.countDocuments({})).toBe(600);
    expect(logs.of('db.result').filter((r) => r.operation === 'deleteMany')).toHaveLength(10);
    expect(logs.of('db.result').every((r) => r.commit_state === 'pending')).toBe(true);
    expect(logs.of('seed.transaction_committed')).toHaveLength(0);
    expect(logs.of('seed.transaction_failed')[0]).toMatchObject({ commit_state: 'aborted', attempt: 1 });
  });

  it('logs seed commit before completion and clears transaction context for metadata', async () => {
    const logs = captureLogs();
    await logs.run(() => seed('demo', { forceFixtures: true }));
    const events = logs.records.map((r) => r.event);
    expect(events.indexOf('seed.transaction_committed')).toBeLessThan(events.indexOf('seed.completed'));
    expect(logs.of('seed.completed')[0]).toMatchObject({ fund_flows_present: false, commit_state: 'committed' });
    const metadata = logs.of('db.operation').find((r) => r.collection === 'seed_meta' && r.operation === 'findOneAndUpdate');
    expect(metadata).toBeDefined();
    expect(metadata).not.toHaveProperty('transaction_id');
    expect(logs.of('db.batch.summary').length).toBeGreaterThan(0);
  });

  it('reports metadata failure after commit without claiming the domain data rolled back', async () => {
    const logs = captureLogs();
    const failure = new Error('metadata unavailable');
    vi.spyOn(seedRepository, 'setLastSeed').mockRejectedValueOnce(failure);
    await expect(logs.run(() => seed('demo', { forceFixtures: true }))).rejects.toBe(failure);
    expect(logs.of('seed.transaction_committed')).toHaveLength(1);
    expect(logs.of('seed.transaction_failed')).toHaveLength(0);
    expect(logs.of('seed.completed')).toHaveLength(0);
    expect(logs.of('seed.failed')[0]).toMatchObject({ stage: 'seed_metadata', commit_state: 'committed' });
    expect(await accounts.count()).toBe(600);
  });

  it('keeps one transaction id across driver callback retries and logs only the final commit', async () => {
    const logs = captureLogs();
    let calls = 0;
    const result = await logs.run(() => withTransaction(async (session) => {
      const count = await logQuery(Account.countDocuments({}).session(session));
      if (++calls === 1) throw new mongoose.mongo.MongoServerError({ message: 'retry', errorLabels: ['TransientTransactionError'] });
      return count;
    }));
    expect(result).toBe(600);
    expect(calls).toBe(2);
    const starts = logs.of('db.transaction_started');
    expect(starts.map((r) => r.attempt)).toEqual([1, 2]);
    expect(new Set(starts.map((r) => r.transaction_id)).size).toBe(1);
    expect(logs.of('db.transaction_committed')).toHaveLength(1);
    expect(logs.of('db.transaction_committed')[0]).toMatchObject({ transaction_id: starts[0]!.transaction_id, attempt: 2 });
    expect(logs.of('db.transaction_failed')).toHaveLength(0);
  });

  it('does not claim rollback when the driver reports an unknown commit outcome', async () => {
    const logs = captureLogs();
    const failure = new mongoose.mongo.MongoServerError({ message: 'uncertain', errorLabels: ['UnknownTransactionCommitResult'] });
    vi.spyOn(db(), 'transaction').mockRejectedValueOnce(failure);
    await expect(logs.run(() => withTransaction(async () => {}))).rejects.toBe(failure);
    expect(logs.of('db.transaction_committed')).toHaveLength(0);
    expect(logs.of('db.transaction_failed')[0]).toMatchObject({ commit_state: 'unknown' });
  });

  it('does not claim a partial/duplicate batch was fully inserted', async () => {
    const logs = captureLogs();
    const error = Object.assign(new Error('PRIVATE rejected document'), { code: 11000 });
    const target = { collection: { collectionName: 'test' }, validate: vi.fn(async () => {}), insertMany: vi.fn(async () => { throw error; }) };
    await logs.run(() => insertBatches(target, [{ secret: 1 }, { secret: 2 }]));
    expect(target.insertMany).toHaveBeenCalledTimes(1);
    expect(logs.of('db.result')).toHaveLength(0);
    expect(logs.of('db.duplicate_skipped')).toHaveLength(1);
    expect(logs.of('db.batch.summary')[0]).toMatchObject({ attempted_count: 2, counts: { known_inserted: 0, batches_with_unknown_count: 1 } });
    expect(JSON.stringify(logs.records)).not.toContain('PRIVATE');
  });

  it('distinguishes local validation from database execution and preserves the session', async () => {
    const logs = captureLogs();
    const validation = Object.assign(new Error('PRIVATE value'), { name: 'ValidationError' });
    const target = { collection: { collectionName: 'test' }, validate: vi.fn(async () => { throw validation; }), insertMany: vi.fn(async () => []) };
    await expect(logs.run(() => insertBatches(target, [{}]))).rejects.toBe(validation);
    expect(target.insertMany).not.toHaveBeenCalled();
    expect(logs.of('db.operation')).toHaveLength(0);
    expect(logs.of('db.validation_error')[0]).toMatchObject({ stage: 'validation' });
    const session = await db().startSession();
    try {
      const valid = { ...target, validate: vi.fn(async () => {}), insertMany: vi.fn(async () => [{}]) };
      await logs.run(() => insertBatches(valid, [{}], session));
      expect(valid.insertMany).toHaveBeenCalledWith([{}], { session, ordered: false });
    } finally { await session.endSession(); }
  });

  it('does not accumulate connection listeners when connect is called repeatedly', async () => {
    const before = db().listenerCount('connected');
    await connect();
    await connect();
    expect(db().listenerCount('connected')).toBe(before);
  });
});
