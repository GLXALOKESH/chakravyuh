/**
 * Application error hierarchy.
 *
 * TRD section 9: errors return `{ "error": "message" }` with a 4xx or 5xx
 * status. Every error the API raises deliberately extends AppError, and the
 * error middleware treats anything that does not as a bug (500).
 */

export class AppError extends Error {
  readonly status: number;
  /** Extra fields merged into the response body, for machine-readable detail. */
  readonly details: Record<string, unknown> | undefined;

  constructor(status: number, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.details = details;
    Error.captureStackTrace?.(this, new.target);
  }
}

export class BadRequestError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(400, message, details);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(404, message, details);
  }
}

/** A DTO failed class-validator. Carries the per-field messages. */
export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(400, message, details);
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(message: string) {
    super(413, message);
  }
}

/**
 * The ML service could not be reached and there is no cached answer to serve.
 *
 * Distinct from a silent fallback because the taint and freeze routes answer from
 * the ring's cached default when Python is down; this is only raised when there
 * is no default either, which means the ring was never seeded properly.
 */
export class MlUnavailableError extends AppError {
  readonly route: string;
  readonly reason: string;

  constructor(route: string, reason: string) {
    super(503, `ML route ${route} unavailable: ${reason}`);
    this.route = route;
    this.reason = reason;
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message: string) {
    super(503, message);
  }
}

export const isAppError = (err: unknown): err is AppError => err instanceof AppError;
