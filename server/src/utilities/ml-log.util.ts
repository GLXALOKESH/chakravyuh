import { elapsedMs, errorFields, logEvent, type LogFields } from '../services/logger.service.js';
import { logId } from './log-context.util.js';

/** Observes one existing HTTP attempt. Never retries or reads a response a second time. */
export const withMlLog = async <T>(
  meta: { path: string; method: string; timeout_ms: number; run_id?: string; seq?: number; ring_id?: string; counts?: Record<string, number> },
  execute: (receivedStatus: (status: number) => void) => Promise<T>,
): Promise<T> => {
  const fields = { ...meta, call_id: logId(), peer: 'ml' };
  const start = performance.now();
  let status: number | undefined;
  logEvent('info', 'ml.request', { ...fields, direction: 'out' });
  try {
    const result = await execute((value) => { status = value; });
    const summary: LogFields = {};
    if (result && typeof result === 'object') {
      const value = result as Record<string, unknown>;
      summary.counts = Object.fromEntries(['scores', 'rings', 'alerts', 'accounts', 'freeze', 'links']
        .filter((key) => Array.isArray(value[key])).map((key) => [key, (value[key] as unknown[]).length]));
      if (typeof value.applied === 'boolean') summary.applied = value.applied;
      if (typeof value.took_ms === 'number') summary.took_ms = value.took_ms;
    }
    logEvent('info', 'ml.response', { ...fields, ...summary, direction: 'in', status_code: status, duration_ms: elapsedMs(start) });
    return result;
  } catch (error) {
    const e = error as { name?: string; cause?: { name?: string } };
    const timeout = [e?.name, e?.cause?.name].some((name) => name === 'TimeoutError' || name === 'AbortError');
    const event = timeout ? 'ml.timeout' : status === undefined ? 'ml.unreachable' : status >= 400 ? 'ml.http_error' : 'ml.invalid_response';
    logEvent('warn', event, { ...fields, ...errorFields(error), direction: status === undefined ? 'internal' : 'in', status_code: status, duration_ms: elapsedMs(start) });
    throw error;
  }
};
