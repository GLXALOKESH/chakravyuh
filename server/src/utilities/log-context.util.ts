/** Correlation is local to an async operation, never process-global mutable state. */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';

export interface LogContext {
  request_id?: string;
  run_id?: string;
  seed_id?: string;
  transaction_id?: string;
  attempt?: number;
  cached?: boolean;
  fallback_source?: string;
  error_name?: string;
  error_code?: string | number;
}

interface Store { fields: LogContext; logger?: Logger }
const contexts = new AsyncLocalStorage<Store>();
export const logId = (): string => randomUUID();
export const currentLogContext = (): LogContext => contexts.getStore()?.fields ?? {};
export const contextLogger = (): Logger | undefined => contexts.getStore()?.logger;

export const withLogContext = <T>(
  fields: LogContext,
  fn: () => T,
  options: { replace?: boolean; logger?: Logger } = {},
): T => contexts.run({
  fields: { ...(options.replace ? {} : currentLogContext()), ...fields },
  logger: options.logger ?? contextLogger(),
}, fn);

export const setLogContext = (fields: LogContext): void => {
  const store = contexts.getStore();
  if (store) Object.assign(store.fields, fields);
};
