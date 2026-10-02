/**
 * HTTP client for the Python ML service (TRD section 3 and 7.10).
 *
 * Rules from the TRD, implemented here:
 *   - Express calls Python with ML_TIMEOUT_MS (default 3000).
 *   - On timeout or error the cached response is returned with "cached": true.
 *   - Only taint (F8) and freeze (F9) call Python live, because only those two
 *     depend on user input.
 *
 * The demo must not stall or fail because the Python service is down, so every
 * failure path returns the ring's precomputed default rather than throwing.
 */
import { config } from './config.js';

export class MlUnavailableError extends Error {
  constructor(route, reason) {
    super(`ML route ${route} unavailable: ${reason}`);
    this.route = route;
    this.reason = reason;
  }
}

/** One POST with a hard deadline. Node's AbortSignal.timeout covers both. */
async function postJson(route, body, timeoutMs = config.mlTimeoutMs) {
  const url = `${config.mlUrl.replace(/\/$/, '')}${route}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new MlUnavailableError(route, `HTTP ${response.status}`);
  }
  return response.json();
}

export async function health() {
  const url = `${config.mlUrl.replace(/\/$/, '')}/health`;
  const response = await fetch(url, { signal: AbortSignal.timeout(config.mlTimeoutMs) });
  if (!response.ok) throw new MlUnavailableError('/health', `HTTP ${response.status}`);
  return response.json();
}

/**
 * POST /taint (TRD section 7.10).
 * @returns {Promise<{ payload: object, cached: boolean, error?: string }>}
 */
export async function taint({ ring_id, victim_txn_id, as_of = null }, fallback) {
  try {
    const payload = await postJson('/taint', { ring_id, victim_txn_id, as_of });
    return { payload: { ...payload, cached: false }, cached: false };
  } catch (err) {
    return withFallback(fallback, '/taint', err, {
      victim_amount: 0,
      as_of,
      accounts: [],
      lost_to_cash: 0,
      links: [],
    });
  }
}

/**
 * POST /mincut (TRD section 7.10).
 * @returns {Promise<{ payload: object, cached: boolean, error?: string }>}
 */
export async function freeze({ ring_id, victim_txn_id, as_of = null, k = 3, exclude = [] }, fallback) {
  try {
    const payload = await postJson('/mincut', { ring_id, victim_txn_id, as_of, k, exclude });
    return { payload: { ...payload, cached: false }, cached: false };
  } catch (err) {
    return withFallback(fallback, '/mincut', err, {
      freeze: [],
      at_risk_before: 0,
      secured: 0,
      pct_stopped: 0,
    });
  }
}

/** POST /recruits, only used by the pipeline trigger route. */
export async function recruits({ ring_id }) {
  return postJson('/recruits', { ring_id });
}

/** POST /pipeline/run, only used by the pipeline trigger route. */
export async function runPipeline({ profile }) {
  return postJson('/pipeline/run', { profile });
}

/**
 * Builds the response for the degraded path. `cached` is always true so the
 * dashboard can label the answer as precomputed rather than live.
 */
function withFallback(fallback, route, err, empty) {
  const source = fallback ?? empty;
  return {
    payload: { ...source, cached: true },
    cached: true,
    error: `${route}: ${err.reason ?? err.message}`,
  };
}