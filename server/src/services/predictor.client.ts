/**
 * HTTP client for the Python live predictor (ml/online.py behind ml/service.py).
 *
 *   POST /predict/reset  { run_id, sim_start }
 *   POST /predict        { run_id, seq, clock, accounts, identifiers, txns }
 *
 * The predictor is stateful, so batches must arrive in order and exactly
 * once. The stream service keeps one request in flight and numbers them;
 * resending a batch whose answer was lost returns the predictor's cached
 * answer instead of applying it twice. A 409 means the predictor is not on
 * this run (it restarted, or a batch was skipped), and the caller resyncs.
 */
import { config } from '../configs/env.js';
import type { LiveScore, PredictorAlert, PredictorRing } from './live.store.js';
import { withMlLog } from '../utilities/ml-log.util.js';

export interface PredictRequest {
  run_id: string;
  seq: number;
  clock: string | null;
  accounts: unknown[];
  identifiers: unknown[];
  txns: unknown[];
}

export interface PredictResponse {
  seq: number;
  applied: boolean;
  took_ms: number;
  scores: (LiveScore & { anomaly?: number })[];
  rings: PredictorRing[];
  alerts: PredictorAlert[];
  stats: Record<string, number>;
}

export class PredictorError extends Error {
  constructor(
    message: string,
    /** 0 when the predictor could not be reached at all. */
    readonly status: number,
    readonly detail?: unknown,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = 'PredictorError';
  }
}

export interface PredictorClient {
  reset(runId: string, simStart: string | null): Promise<unknown>;
  predict(request: PredictRequest): Promise<PredictResponse>;
}

type Fetch = typeof fetch;

export const createPredictorClient = ({
  url = config.mlUrl,
  timeoutMs = config.stream.predictTimeoutMs,
  fetchImpl = fetch,
}: { url?: string; timeoutMs?: number; fetchImpl?: Fetch } = {}): PredictorClient => {
  const post = async <T>(route: string, body: unknown): Promise<T> => {
    const input = body as Partial<PredictRequest>;
    return withMlLog({ path: route, method: 'POST', timeout_ms: timeoutMs, run_id: input.run_id, seq: input.seq,
      counts: { txns: input.txns?.length ?? 0, accounts: input.accounts?.length ?? 0, identifiers: input.identifiers?.length ?? 0 },
    }, async (receivedStatus) => {
      let response: Response;
      try {
        response = await fetchImpl(`${url.replace(/\/$/, '')}${route}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        throw new PredictorError(`predictor unreachable: ${(err as Error).message}`, 0, undefined, err);
      }
      receivedStatus(response.status);
      if (!response.ok) {
        const detail = await response.json().catch(() => null);
        throw new PredictorError(`predictor answered HTTP ${response.status}`, response.status, detail);
      }
      return (await response.json()) as T;
    });
  };

  return {
    reset: (runId, simStart) => post('/predict/reset', { run_id: runId, sim_start: simStart }),
    predict: (request) => post<PredictResponse>('/predict', request),
  };
};
