/**
 * Small shared helpers. Nothing here knows about Express, Mongoose or HTTP, so
 * these can be imported from a repository, a service or a test.
 */

/**
 * Timestamps go out as YYYY-MM-DDTHH:MM:SSZ, matching the contract examples in
 * TRD section 8.
 *
 * A BSON date comes back as a JS Date, whose default toJSON adds milliseconds,
 * so the milliseconds are trimmed in one place rather than in every mapper.
 * Anything unparseable becomes null rather than the string "Invalid Date", which
 * would break the contract's format check.
 */
export const iso = (value: Date | string | number | null | undefined): string | null => {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
};

export const isoList = (list: readonly (Date | string | null)[]): (string | null)[] => list.map(iso);

/**
 * Subdocuments stored as Mixed come back as whatever shape was written, which is
 * wider than the contract types. This is the one place that narrowing is allowed,
 * and it fails loudly rather than silently yielding an empty object.
 */
export const asRecord = <T>(value: unknown, fallback: T): T => {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== 'object') return fallback;
  return value as T;
};

export const asArray = <T>(value: unknown, fallback: T[] = []): T[] => {
  if (value === undefined || value === null) return fallback;
  return Array.isArray(value) ? (value as T[]) : fallback;
};

/** Array columns default to empty rather than null, so callers never guard. */
export const arr = <T>(value: T[] | null | undefined): T[] => value ?? [];

/**
 * Splits "a,b,c" and JSON arrays into a clean list. Used for the freeze
 * `exclude` parameter, which arrives either way depending on the client.
 */
export const idList = (value: unknown): string[] => {
  if (value === undefined || value === null) return [];
  const list = Array.isArray(value) ? value : String(value).split(',');
  return list.map((v) => String(v).trim()).filter(Boolean);
};

/** Rounds to whole rupees. Money in this dataset is always integer rupees. */
export const round = (value: number): number => Math.round(value);

/** Rounds a proportion to three decimals, matching the cached defaults. */
export const round3 = (value: number): number => Number(value.toFixed(3));

/**
 * Splits an array into fixed-size batches.
 *
 * MongoDB caps a single command at 16MB of BSON, so a bulk insert of several
 * thousand documents has to be split into batches that comfortably fit.
 */
export const chunk = <T>(items: readonly T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

/** Groups a list by a key, preserving nothing else about the order. */
export const groupBy = <T, K extends string>(items: readonly T[], key: (item: T) => K): Record<K, T[]> => {
  const out = {} as Record<K, T[]>;
  for (const item of items) {
    const k = key(item);
    (out[k] ??= []).push(item);
  }
  return out;
};
