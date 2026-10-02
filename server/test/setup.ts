/**
 * Per-worker setup. Runs before any test file is imported, which is what lets it
 * redirect MONGO_URL before configs/env.ts reads it.
 *
 * Nothing here touches the database. global-setup.ts has already chosen a
 * database and created the indexes; this only propagates the choice into the
 * worker process, since the two run separately.
 */
import 'reflect-metadata';
import { resolveTestDatabaseUrl } from './db-url.js';

/**
 * global-setup.ts sets MONGO_URL to the database it settled on, in its own
 * process. It has already been rewritten to point at the test database, so
 * resolveTestDatabaseUrl returns it unchanged; the point is that it is set at
 * all when global-setup started its own mongod and there is nothing in the real
 * environment.
 */
process.env.MONGO_URL = resolveTestDatabaseUrl() ?? process.env.MONGO_URL;