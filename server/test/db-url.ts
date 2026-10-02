/**
 * Resolves which database the test suite should talk to.
 *
 * Prisma needs a real PostgreSQL: it ships its own query engine, so there is no
 * in-process substitute. The suite therefore uses a separate schema rather than
 * the development one, because the tests truncate tables and a mistake should
 * not cost anyone their seeded data.
 *
 * Precedence:
 *   1. TEST_DATABASE_URL, when set explicitly.
 *   2. DATABASE_URL with ?schema=chakravyuh_test appended.
 *   3. null, meaning no database is configured and the DB-backed files skip.
 */

/** The schema every test file uses. Sequential files, so no collision. */
export const TEST_SCHEMA = 'chakravyuh_test';

/**
 * .env ships a placeholder so `prisma generate` works before a database exists.
 *
 * A placeholder has to be treated as "not configured" rather than as a real
 * connection, otherwise the database-backed suites run and fail on ECONNREFUSED
 * for a reason that has nothing to do with the code.
 */
export const isPlaceholderUrl = (url: string | null | undefined): boolean => {
  if (!url) return true;
  return /placeholder|changeme|<.*>|YOUR_|xxx/i.test(url);
};

const appendParam = (url: string, key: string, value: string): string => {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}${key}=${value}`;
};

export const resolveTestDatabaseUrl = (
  env: NodeJS.ProcessEnv = process.env,
): string | null => {
  const explicit = env.TEST_DATABASE_URL?.trim();
  if (explicit && !isPlaceholderUrl(explicit)) return explicit;

  const base = env.DATABASE_URL?.trim();
  if (!base || isPlaceholderUrl(base)) return null;
  // An explicit schema in DATABASE_URL is respected rather than overridden.
  if (/[?&]schema=/.test(base)) return base;
  return appendParam(base, 'schema', TEST_SCHEMA);
};

/** True when the suite has a database to run the DB-backed files against. */
export const hasTestDatabase = (env: NodeJS.ProcessEnv = process.env): boolean =>
  resolveTestDatabaseUrl(env) !== null;
