/**
 * The MongoDB connection.
 *
 * One Mongoose connection for the process. Mongoose models are registered
 * against a global registry and share a connection pool, so creating more would
 * mean more pools against the same Atlas cluster for no benefit.
 *
 * There is no migration step, no schema file to push and no client to generate,
 * so this file is the whole of the persistence bootstrap. Indexes are the one
 * thing that has to be told to exist, and ensureIndexes() is that step; see
 * `npm run db:indexes`.
 */
import mongoose, { type ClientSession } from 'mongoose';
import { config, hasDatabase } from './env.js';
import { ALL_MODELS } from '../models/index.js';

// Connection options only. Query strictness is a schema option in Mongoose 9,
// set per collection in models/common.ts.
const OPTIONS = {
  // Atlas can take a while to pick a server on a cold connection. Longer than
  // the driver default so a cold start does not fail, short enough that an
  // unreachable cluster reports something instead of hanging.
  serverSelectionTimeoutMS: config.dbConnectTimeoutMs,

  // Queries issued before connect() resolves are queued rather than dropped,
  // which is what lets a test seed without awaiting a connection first. The
  // timeout bounds how long a query waits for the buffer.
  bufferTimeoutMS: config.dbConnectTimeoutMs,
};

/** The live connection. Repositories do not normally need this. */
export const db = (): mongoose.Connection => mongoose.connection;

/**
 * Opens the connection, or returns the open one.
 *
 * Safe to call repeatedly: bin/server.ts, the seeder and the test setup all
 * call it, and any of them may be the first.
 *
 * `override` exists for the test suite, which starts its own mongod and so has
 * a URL that no environment variable ever held. Everything else reads config.
 */
export const connect = async (override?: string): Promise<mongoose.Connection> => {
  const url = override ?? config.mongoUrl;

  if (!override && !hasDatabase()) {
    throw new Error(
      'MONGO_URL is not set. Copy .env.example to .env and put the MongoDB ' +
        'connection string there before starting the server or running the seed. ' +
        'Atlas: mongodb+srv://USER:PASSWORD@cluster.mongodb.net. Local: ' +
        'mongodb://localhost:27017/chakravyuh.',
    );
  }

  if (mongoose.connection.readyState === 1) return mongoose.connection;

  await mongoose.connect(url, OPTIONS);
  return mongoose.connection;
};

/** Closes the connection so the process can exit instead of waiting on it. */
export const disconnect = async (): Promise<void> => {
  if (mongoose.connection.readyState === 0) return;
  await mongoose.disconnect();
};

/**
 * Runs a unit of work in a MongoDB transaction.
 *
 * The seeder uses this so a failure part way through leaves the previous data
 * intact rather than half-replacing it. That requires a replica set, which Atlas
 * provides by default; a standalone local mongod will refuse with "Transactions
 * are not supported by this deployment", and the fix is to start mongod with
 * --replSet and run rs.initiate() once. See the server README.
 */
export const withTransaction = <T>(fn: (session: ClientSession) => Promise<T>): Promise<T> =>
  db().transaction(fn);

/**
 * Creates the indexes declared on the schemas.
 *
 * MongoDB stores documents schemaless, so an index is the only part of the
 * schema the database can be asked to enforce. This is the closest thing
 * MongoDB has to a schema push, and it is called by the test setup and by
 * the seeder, so a fresh database is indexed before anything reads it.
 *
 * createIndexes rather than syncIndexes: the second drops any index it does not
 * recognise, which on a shared Atlas cluster means quietly deleting somebody
 * else's.
 */
export const ensureIndexes = async (override?: string): Promise<number> => {
  await connect(override);
  for (const model of ALL_MODELS) await model.createIndexes();
  return ALL_MODELS.length;
};

/** A description of the connection for /health and the startup banner. */
export const describeDatabase = (): { driver: string; host: string; database: string } => {
  const unknown = { driver: 'mongodb', host: 'unknown', database: 'unknown' };
  try {
    const url = new URL(config.mongoUrl);
    // An Atlas host is always a *.mongodb.net SRV record, so the protocol is the
    // reliable tell. It is worth surfacing, because Atlas and a local mongod
    // need different setup notes when something fails.
    const atlas = url.protocol === 'mongodb+srv:';
    return {
      driver: atlas ? 'mongodb (atlas)' : 'mongodb',
      host: url.hostname + (url.port ? `:${url.port}` : ''),
      database: url.pathname.replace(/^\//, '').split('?')[0] || '(default)',
    };
  } catch {
    return unknown;
  }
};