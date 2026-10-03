/** Structured, bounded metadata only: no request bodies, documents or raw errors. */
import pino, { type DestinationStream, type Logger } from 'pino';
import { config } from '../configs/env.js';
import { contextLogger, currentLogContext } from '../utilities/log-context.util.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFields = Record<string, unknown>;

export const createLogger = (destination?: DestinationStream, level = config.logging.level): Logger => {
  const options: pino.LoggerOptions = {
    level,
    base: { service: 'chakravyuh-server', pid: process.pid },
    timestamp: pino.stdTimeFunctions.isoTime,
  };
  if (!destination && config.logging.format === 'pretty') {
    const transport = pino.transport({
      target: 'pino-pretty',
      options: { colorize: Boolean(process.stdout.isTTY), translateTime: 'SYS:HH:MM:ss.l', singleLine: true, ignore: 'pid,hostname,service' },
    });
    transport.on('error', () => {});
    return pino(options, transport);
  }
  return destination ? pino(options, destination) : pino(options);
};

const logger = createLogger();

const allowed = new Set([
  'request_id', 'call_id', 'operation_id', 'run_id', 'seed_id', 'transaction_id', 'attempt',
  'direction', 'peer', 'method', 'path', 'route', 'status_code', 'content_type',
  'duration_ms', 'timeout_ms', 'cached', 'fallback_source', 'database', 'host',
  'collection', 'operation', 'returned_count', 'count_value', 'attempted_count',
  'matched_count', 'modified_count', 'deleted_count', 'inserted_count', 'upserted_count',
  'slow', 'stage', 'commit_state', 'error_name', 'error_code', 'mode', 'profile',
  'source', 'fund_flows_present', 'truncated', 'counts', 'seq', 'applied', 'took_ms',
  'retry_ms', 'predictor_status', 'reason', 'exit_code', 'pid', 'port', 'signal',
  'batch', 'batches_completed', 'expected', 'speed', 'rate', 'seed', 'ring_id',
  'alert_id', 'version', 'socket_id', 'filter_fields', 'sort_fields', 'projection_fields',
  'limit', 'skip', 'measurement_scope', 'outcome', 'bytes',
]);

const cleanText = (value: string): string => value
  .replace(/\b(?:mongodb(?:\+srv)?|https?):\/\/[^\s]+/gi, '[URL omitted]')
  .replace(/\b(?:Bearer|Basic)\s+[^\s]+/gi, '[authorization omitted]')
  .replace(/[\u0000-\u001f\u007f]/g, ' ')
  .slice(0, 256);

export const safeLogFields = (fields: LogFields): LogFields => {
  const safe: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!allowed.has(key) || value === undefined) continue;
    if (key === 'counts' && value && typeof value === 'object') {
      safe.counts = Object.fromEntries(Object.entries(value).slice(0, 32)
        .filter(([name, n]) => /^[a-z_]+$/.test(name) && typeof n === 'number' && Number.isFinite(n)));
    } else if (Array.isArray(value) && ['filter_fields', 'sort_fields', 'projection_fields'].includes(key)) {
      safe[key] = value.filter((v): v is string => typeof v === 'string' && /^[\w.$-]{1,64}$/.test(v)).slice(0, 24);
    } else if (typeof value === 'string') safe[key] = cleanText(key === 'path' ? value.split('?')[0]! : value);
    else if (typeof value === 'boolean' || value === null || (typeof value === 'number' && Number.isFinite(value))) safe[key] = value;
  }
  return safe;
};

/** Error messages from MongoDB can contain entire rejected documents. Keep codes, not messages. */
export const errorFields = (error: unknown): LogFields => {
  const e = error as { name?: unknown; code?: unknown; cause?: { code?: unknown } } | null;
  const name = typeof e?.name === 'string' && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(e.name) ? e.name : 'Error';
  const code = e?.code ?? e?.cause?.code;
  return {
    error_name: name,
    ...(typeof code === 'number' || (typeof code === 'string' && /^[A-Z_0-9]{1,64}$/.test(code)) ? { error_code: code } : {}),
  };
};

export const logEvent = (level: LogLevel, event: string, fields: LogFields = {}): void => {
  try {
    const target = contextLogger() ?? logger;
    if (!target.isLevelEnabled(level)) return;
    target[level]({ ...safeLogFields({ ...currentLogContext(), ...fields }), event }, event);
  } catch { /* Observability must preserve the original result/error. */ }
};

export const elapsedMs = (start: number): number => Math.round((performance.now() - start) * 100) / 100;

/** Bounded flush before a CLI entry point calls process.exit(). */
export const flushLogs = (timeoutMs = 500): Promise<void> => new Promise((resolve) => {
  const timer = setTimeout(resolve, timeoutMs);
  try { logger.flush(() => { clearTimeout(timer); resolve(); }); }
  catch { clearTimeout(timer); resolve(); }
});
