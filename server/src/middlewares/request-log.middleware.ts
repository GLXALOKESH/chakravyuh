import type { RequestHandler } from 'express';
import { elapsedMs, logEvent } from '../services/logger.service.js';
import { contextLogger, currentLogContext, logId, withLogContext } from '../utilities/log-context.util.js';

export const requestLog: RequestHandler = (req, res, next) => {
  withLogContext({ request_id: logId() }, () => {
    const context = currentLogContext();
    const logger = contextLogger();
    const start = performance.now();
    const path = req.originalUrl.split('?')[0]!;
    const quiet = req.method === 'OPTIONS' || ['/health', '/api/replay/state', '/api/stream/state'].includes(path);
    const base = { method: req.method, path, peer: 'client' };
    logEvent(quiet ? 'debug' : 'info', 'http.request', { ...base, direction: 'in' });
    let completed = false;
    const finish = (aborted: boolean): void => {
      if (completed) return;
      completed = true;
      withLogContext(context, () => {
        logEvent(aborted || res.statusCode >= 400 ? (res.statusCode >= 500 ? 'error' : 'warn') : quiet ? 'debug' : 'info',
          aborted ? 'http.aborted' : 'http.response', {
            ...base, direction: aborted ? 'internal' : 'out',
            ...(aborted ? {} : { status_code: res.statusCode }),
            duration_ms: elapsedMs(start), content_type: res.getHeader('content-type'),
            route: typeof req.route?.path === 'string' ? `${req.baseUrl}${req.route.path}` : undefined,
          });
      }, { replace: true, logger });
    };
    res.once('finish', () => finish(false));
    res.once('close', () => { if (!res.writableFinished) finish(true); });
    next();
  });
};
