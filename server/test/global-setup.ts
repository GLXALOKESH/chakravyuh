/**
 * Runs once before the suite: picks a database, then creates the indexes.
 *
 * Two sources, in order:
 *
 *   1. MONGO_URL (or TEST_MONGO_URL), pointed at a database the suite may clear.
 *      This is the real thing, and it is what CI and the demo laptop use.
 *
 *   2. An in-process mongod, started as a single-node replica set. Replica set
 *      rather than standalone because the seeder's transaction needs one, which
 *      is also why Atlas is a better target than a plain local mongod.
 *
 * Either way the DB-backed files run rather than skipping. That matters more
 * than the usual "keep tests runnable with no services" instinct, because the
 * persistence layer is where a type system stops helping: a repository can
 * typecheck perfectly and still query a field name that does not exist. The
 * contract tests, the resume path, the rollback behaviour and the enum
 * rejection all have to run against a real server to mean anything.
 *
 * Only this file knows which; the per-worker setup just reads MONGO_URL.
 */
import { disconnect, ensureIndexes } from '../src/configs/mongoose.js';
import { resolveTestDatabaseUrl, withDatabaseName } from './db-url.js';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';

/**
 * Kept on the global object so it survives for teardown. globalSetup and the
 * test files run in the same process, but storing a module-scoped variable would
 * rely on the import being cached, and an evicted module would leak a mongod
 * process that never gets stopped.
 */
const HELD = Symbol.for('chakravyuh.test.mongod');

export default async function setup(): Promise<void> {
  const url = resolveTestDatabaseUrl() ?? (await startInProcessMongod());

  // Written to the environment rather than passed along, because the per-worker
  // setup and every src module read config.mongoUrl, and they are separate
  // processes from this one.
  process.env.MONGO_URL = url;
  console.log(`[test] ${describe(url)}`);

  const collections = await ensureIndexes(url);
  await disconnect();
  console.log(`[test] ${collections} collections ready`);
}

/**
 * A single-node replica set in this process, for when no MONGO_URL is set.
 *
 * A replica set and not a standalone mongod, because the seeder wraps its load
 * in a transaction and MongoDB only allows a transaction to start on a replica
 * set. This is the same requirement Atlas satisfies out of the box, so a pass
 * here means the seeding path works against Atlas too.
 */
async function startInProcessMongod(): Promise<string> {
  // Imported lazily so a run against a real database never pays for the
  // download and never fails on a machine that cannot start a mongod.
  const { MongoMemoryReplSet } = await import('mongodb-memory-server');
  const replSet: MongoMemoryReplSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  (globalThis as Record<symbol, unknown>)[HELD] = replSet;
  return withDatabaseName(replSet.getUri(), 'chakravyuh_test');
}

export async function teardown(): Promise<void> {
  const replSet = (globalThis as Record<symbol, unknown>)[HELD] as MongoMemoryReplSet | undefined;
  if (!replSet) return;
  await replSet.stop();
}

/** "cluster host/database", for the log line. */
const describe = (url: string): string => {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname.replace(/^\//, '')} on ${parsed.host}`;
  } catch {
    return '(unparseable url)';
  }
};