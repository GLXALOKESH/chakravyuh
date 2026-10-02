/**
 * Connection string helpers.
 *
 * MongoDB treats the path segment of a connection string as the database name,
 * and when there is none the driver quietly falls back to a database called
 * `test`. That fallback is a genuine trap: the server starts, every query
 * succeeds, and the data lands somewhere nobody was looking. Atlas dashboard
 * screenshots and copy-pasted connection strings routinely omit the name, so
 * this is worth handling rather than documenting.
 */

/**
 * Points a connection string at a different database, keeping the rest intact.
 *
 * Credentials, host, port and every query option - retryWrites, w, tls, the
 * Atlas SRV flags - are carried over untouched, which is why this works the
 * same for an Atlas SRV string and a local one.
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

/**
 * The database a connection string points at, or null when it names none.
 *
 * The three shapes that count as "no name" are worth spelling out, because all
 * three are common in Atlas connection strings:
 *
 *   mongodb+srv://user:pass@cluster.mongodb.net              no slash at all
 *   mongodb+srv://user:pass@cluster.mongodb.net/             trailing slash
 *   mongodb+srv://user:pass@cluster.mongodb.net/?retryWrites  slash then options
 */
export const databaseNameOf = (url: string): string | null => {
  const questionMark = url.indexOf('?');
  const base = questionMark === -1 ? url : url.slice(0, questionMark);

  const schemeEnd = base.indexOf('://') + 3;
  if (schemeEnd < 3) return null;

  const slash = base.indexOf('/', schemeEnd);
  if (slash === -1) return null;

  const name = base.slice(slash + 1).trim();
  return name === '' ? null : name;
};

/**
 * Fills in the default database name when a connection string omits one.
 *
 * Applied to MONGO_URL so a name-less Atlas string cannot silently write the
 * whole dataset into `test`.
 */
export const withDefaultDatabaseName = (url: string, name: string): string =>
  databaseNameOf(url) === null ? withDatabaseName(url, name) : url;
