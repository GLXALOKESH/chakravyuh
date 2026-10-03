import { createLogger } from '../src/services/logger.service.js';
import { withLogContext, type LogContext } from '../src/utilities/log-context.util.js';

export interface LogRecord {
  event: string;
  level: number;
  request_id?: string;
  operation_id?: string;
  call_id?: string;
  [key: string]: unknown;
}

export const captureLogs = () => {
  const records: LogRecord[] = [];
  const logger = createLogger({ write: (line: string) => { records.push(JSON.parse(line) as LogRecord); } }, 'debug');
  return {
    records, logger,
    run: <T>(fn: () => T, fields: LogContext = {}): T => withLogContext(fields, fn, { logger, replace: true }),
    of: (event: string) => records.filter((record) => record.event === event),
  };
};
