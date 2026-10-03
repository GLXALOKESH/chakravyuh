/**
 * HTTP client for the Python ML service (TRD section 3 and 7.10).
 *
 * The rules from the TRD, implemented here:
 *   - Express calls Python with ML_TIMEOUT_MS (default 3000).
 *   - On timeout or error the cached response is returned with "cached": true.
 *   - Only taint (F8) and freeze (F9) call Python live, because only those two
 *     depend on user input.
 *
 * The demo must not stall or fail because the Python service is down, so every
 * failure path returns the ring's precomputed default rather than throwing. The
 * caller can tell the difference from the `cached` flag, which is what lets the
 * dashboard label the answer as precomputed rather than live.
 */
import { config } from '../configs/env.js';
import type { FreezePayload, TaintPayload } from '../interfaces/domain.interface.js';
import { withMlLog } from '../utilities/ml-log.util.js';
import { currentLogContext, setLogContext } from '../utilities/log-context.util.js';
import { logEvent } from './logger.service.js';

/** Control-flow signal for a failed call. Never reaches a client. */
class MlCallError extends Error {
  constructor(
    readonly route: string,
    readonly reason: string,
  ) {
    super(`ML route ${route} unavailable: ${reason}`);
    this.name = 'MlCallError';
  }
}

export interface MlResult<T> {
  payload: T;
  cached: boolean;
  /** Present only on the degraded path, for the log line. */
  error?: string;
}

export interface TaintRequest {
  ring_id: string;
  victim_txn_id: string | null;
  as_of: string | null;
  /** Set for a live ring: Python then reads that run's ledger instead of the demo files. */
  run_id?: string;
}

export interface FreezeRequest extends TaintRequest {
  k: number;
  exclude: string[];
}

/** One POST with a hard deadline. AbortSignal.timeout covers the timeout case. */
const postJson = async (route: string, body: unknown, timeoutMs = config.mlTimeoutMs): Promise<Record<string, unknown>> => {
  const url = `${config.mlUrl.replace(/\/$/, '')}${route}`;
  const input = body as Partial<TaintRequest>;
  return withMlLog({ path: route, method: 'POST', timeout_ms: timeoutMs, ring_id: input.ring_id, run_id: input.run_id }, async (receivedStatus) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    receivedStatus(response.status);
    if (!response.ok) throw new MlCallError(route, `HTTP ${response.status}`);
    return (await response.json()) as Record<string, unknown>;
  });
};

export const health = async (): Promise<Record<string, unknown>> => {
  const url = `${config.mlUrl.replace(/\/$/, '')}/health`;
  return withMlLog({ path: '/health', method: 'GET', timeout_ms: config.mlTimeoutMs }, async (receivedStatus) => {
    const response = await fetch(url, { signal: AbortSignal.timeout(config.mlTimeoutMs) });
    receivedStatus(response.status);
    if (!response.ok) throw new MlCallError('/health', `HTTP ${response.status}`);
    return (await response.json()) as Record<string, unknown>;
  });
};

/** POST /taint (TRD section 7.10). */
export const taint = async (request: TaintRequest, fallback: TaintPayload | null): Promise<MlResult<TaintPayload>> => {
  try {
    const payload = await postJson('/taint', request);
    setLogContext({ cached: currentLogContext().cached ?? false });
    return { payload: { ...(payload as unknown as TaintPayload), cached: false }, cached: false };
  } catch (err) {
    // `cached` is set to false here only to satisfy the shape; withFallback
    // overwrites it with true, which is the whole point of this branch.
    return withFallback(fallback, '/taint', err, {
      victim_amount: 0,
      as_of: request.as_of,
      accounts: [],
      lost_to_cash: 0,
      links: [],
      cached: false,
    }, Boolean(request.run_id));
  }
};

/** POST /mincut (TRD section 7.7 and 7.10). */
export const freeze = async (request: FreezeRequest, fallback: FreezePayload | null): Promise<MlResult<FreezePayload>> => {
  try {
    const payload = await postJson('/mincut', request);
    setLogContext({ cached: currentLogContext().cached ?? false });
    return { payload: { ...(payload as unknown as FreezePayload), cached: false }, cached: false };
  } catch (err) {
    // As above: the flag is meaningless on the failure path because
    // withFallback overwrites it with true.
    return withFallback(fallback, '/mincut', err, {
      freeze: [],
      at_risk_before: 0,
      secured: 0,
      pct_stopped: 0,
      cached: false,
    }, Boolean(request.run_id));
  }
};

/** POST /recruits, used only by the pipeline trigger. No cached fallback. */
export const recruits = async (ringId: string): Promise<unknown> => postJson('/recruits', { ring_id: ringId });

/** POST /pipeline/run, used only by the pipeline trigger. */
export const runPipeline = async (profile: string): Promise<unknown> => postJson('/pipeline/run', { profile });

/**
 * Builds the response for the degraded path. `cached` is always true, so the
 * dashboard can label the answer as precomputed rather than live.
 */
const withFallback = <T>(fallback: T | null, route: string, err: unknown, empty: T, live = false): MlResult<T> => {
  const source = fallback ?? empty;
  const reason = err instanceof MlCallError ? err.reason : ((err as Error)?.message ?? 'unknown error');
  const fallbackSource = fallback === null ? 'empty' : live ? 'live_cache' : 'stored_default';
  setLogContext({ cached: true, fallback_source: fallbackSource });
  logEvent('warn', 'ml.fallback', { direction: 'internal', peer: 'ml', path: route, cached: true, fallback_source: fallbackSource });
  return {
    payload: { ...source, cached: true } as T,
    cached: true,
    error: `${route}: ${reason}`,
  };
};

/** True when the last call fell back. Exported for the tests. */
export const isMlCallError = (err: unknown): boolean => err instanceof MlCallError;
