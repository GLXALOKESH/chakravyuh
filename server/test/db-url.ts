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
 * The path segment is the database name in a MongoDB URL, so only that is
 * replaced. Credentials, host, port and every query option - retryWrites, w,
 * tls, the Atlas SRV flags - are carried over untouched, which is why this
 * works the same for an Atlas SRV string and a local one.
 */
export const withDatabaseName = (url: string, name: string): string => {
  try {
    const parsed = new URL(url);
    parsed.pathname = `/${name}`;
    // URL serialises known search params back verbatim and keeps any unknown
    // ones, which is what an Atlas query string needs.
    return parsed.toString();
  } catch {
    // Not a URL-shaped string, so no parser to lean on. Swap the segment after
    // the host and keep any query string, rather than guessing at the whole.
    const questionMark = url.indexOf('?');
    const base = questionMark === -1 ? url : url.slice(0, questionMark);
    const query = questionMark === -1 ? '' : url.slice(questionMark);

    const schemeEnd = base.indexOf('://') + 3;
    const slash = base.indexOf('/', schemeEnd);
    const head = slash === -1 ? base : base.slice(0, slash);
    return `${head}/${name}${query}`;
  }
};

export const resolveTestDatabaseUrl = (env: NodeJS.ProcessEnv = process.env): string | null => {
  const explicit = env.TEST_MONGO_URL?.trim();
  if (explicit && !isPlaceholderUrl(explicit)) return explicit;

  const base = env.MONGO_URL?.trim();
  if (!base || isPlaceholderUrl(base)) return null;
  return withDatabaseName(base, TEST_DB_NAME);
};