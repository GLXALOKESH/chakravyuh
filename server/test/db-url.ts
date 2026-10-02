/**
 * Resolves which database the test suite should talk to.
 *
 * MongoDB has no schemas, so the equivalent of the previous test schema is a
 * separate *database*: same cluster, different name. The suite clears collections
 * and reseeds on every run, and a mistake should not cost anyone their seeded
 * dev data.
 *
 * Precedence:
 *   1. TEST_MONGO_URL, when set explicitly.
 *   2. MONGO_URL with its database name replaced by chakravyuh_test.
 *   3. null, meaning nothing is configured and global-setup.ts should start its
 *      own mongod.
 */

/** The database every test file uses. Sequential files, so no collision. */
export const TEST_DB_NAME = 'chakravyuh_test';

/**
 * A placeholder is treated as "not configured" rather than as a real connection,
 * otherwise the database-backed suites run and fail on a connection error for a
 * reason that has nothing to do with the code.
 */
export const isPlaceholderUrl = (url: string | null | undefined): boolean => {
  if (!url) return true;
  return /placeholder|changeme|<.*>|YOUR_|xxx/i.test(url);
};

/**
 * Points a connection string at a different database, keeping the rest intact.
 *
 * Lives in src/ because env.ts needs it too: MONGO_URL that names no database
 * would otherwise land in `test`. Re-exported here so the test helper reads as
 * one piece.
 */
import { withDatabaseName } from '../src/utilities/mongo-url.util.js';
export { withDatabaseName };

export const resolveTestDatabaseUrl = (env: NodeJS.ProcessEnv = process.env): string | null => {
  const explicit = env.TEST_MONGO_URL?.trim();
  if (explicit && !isPlaceholderUrl(explicit)) return explicit;

  const base = env.MONGO_URL?.trim();
  if (!base || isPlaceholderUrl(base)) return null;
  return withDatabaseName(base, TEST_DB_NAME);
};