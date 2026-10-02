/** Shared helpers for turning database rows into API payloads (TRD section 8). */

/**
 * Timestamps go out as YYYY-MM-DDTHH:MM:SSZ, matching the contract examples in
 * TRD section 8. Both drivers hand back a JS Date for timestamptz, whose default
 * toJSON adds milliseconds, so the milliseconds are trimmed here once rather
 * than in every serializer.
 */
export function iso(value) {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export const isoList = (list) => (list ?? []).map(iso);

/**
 * jsonb columns need an explicit stringify. node-postgres would do it for us but
 * PGlite does not, so writing the string is what keeps both drivers identical.
 */
export const toJsonb = (value) => (value === undefined ? null : JSON.stringify(value ?? null));

/** Array columns default to empty rather than null, so callers never guard. */
export const arr = (value) => value ?? [];

/** Parses a jsonb column defensively, since seed data may hold a bare string. */
export function parseJson(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

/** TRD section 9: errors return { "error": "message" } with a 4xx or 5xx status. */
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const badRequest = (message) => new HttpError(400, message);
export const notFound = (message) => new HttpError(404, message);

/** Wraps an async route handler so rejections reach the error middleware. */
export const handler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Splits "a,b,c" and JSON arrays into a clean list. Used for exclude and ids. */
export function idList(value) {
  if (value === undefined || value === null) return [];
  const list = Array.isArray(value) ? value : String(value).split(',');
  return list.map((v) => String(v).trim()).filter(Boolean);
}