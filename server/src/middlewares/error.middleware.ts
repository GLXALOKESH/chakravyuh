/**
 * Error and not-found middleware.
 *
 * TRD section 9: errors return `{ "error": "message" }` with a 4xx or 5xx
 * status. Anything that is not an AppError is treated as a bug: logged in full
 * with a 500, and its message is not echoed to the client, because an
 * unexpected message is more likely to be a stack fragment than something useful.
 */
import type { NextFunction, Request, Response } from 'express';
import { PayloadTooLargeError } from '../exceptions/index.js';
import { isAppError } from '../exceptions/index.js';

export const notFoundHandler = (req: Request, res: Response): void => {
  res.status(404).json({ error: `no route ${req.method} ${req.originalUrl}` });
};

export const errorHandler = (err: unknown, req: Request, res: Response, _next: NextFunction): void => {
  if (res.headersSent) return;

  // express.json() rejects an oversized body before any route runs.
  if (err instanceof PayloadTooLargeError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (isPayloadTooLarge(err)) {
    res.status(413).json({ error: 'request body is too large' });
    return;
  }
  // Malformed JSON is a client mistake, not a server fault.
  if (isBadJson(err)) {
    res.status(400).json({ error: 'request body is not valid JSON' });
    return;
  }

  if (isAppError(err)) {
    if (err.status >= 500) console.error(`${req.method} ${req.originalUrl} failed:`, err);
    res.status(err.status).json(err.details ? { error: err.message, ...err.details } : { error: err.message });
    return;
  }

  console.error(`${req.method} ${req.originalUrl} failed:`, err);
  res.status(500).json({ error: 'internal error' });
};

type BodyParserError = { type?: string; status?: number; statusCode?: number; message?: string };

const asBodyParserError = (err: unknown): BodyParserError =>
  typeof err === 'object' && err !== null ? (err as BodyParserError) : {};

const isPayloadTooLarge = (err: unknown): boolean => asBodyParserError(err).type === 'entity.too.large';

const isBadJson = (err: unknown): boolean => asBodyParserError(err).type === 'entity.parse.failed';

/**
 * Wraps an async controller so a rejected promise reaches the error middleware.
 *
 * Express 4 does not await handlers, so without this an async throw becomes an
 * unhandled rejection and the request hangs until it times out.
 */
export const asyncHandler =
  <T extends Request>(fn: (req: T, res: Response, next: NextFunction) => Promise<unknown>): ((req: Request, res: Response, next: NextFunction) => void) =>
  (req, res, next) => {
    void fn(req as T, res, next).catch(next);
  };
