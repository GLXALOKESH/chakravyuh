/**
 * Validation middleware.
 *
 * `plainToInstance` then `validate`: class-transformer applies the @Type and
 * @Transform decorators, so `?k=3` becomes the number 3 and an empty string
 * becomes undefined, and class-validator then checks the transformed value
 * rather than the raw string.
 *
 * Whitelisting is on, so a field the DTO does not declare is dropped instead of
 * being passed through to a controller. That keeps the set of accepted inputs
 * exactly what the class says it is.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ValidationError } from '../exceptions/index.js';

type DtoConstructor<T extends object> = new () => T;

export interface ValidationOptions<T extends object> {
  /** Which part of the request to transform. Defaults to body. */
  from?: 'body' | 'query' | 'params';
  /** Property on the request the transformed DTO is written to. */
  target: string;
}

const SOURCE_KEY: Record<'body' | 'query' | 'params', string> = {
  body: 'body',
  query: 'query',
  params: 'params',
};

/** Flattens class-validator's nested error tree into field -> messages. */
const flatten = (
  errors: { property: string; constraints?: Record<string, string>; children?: unknown[] }[],
  prefix = '',
): Record<string, string[]> => {
  const out: Record<string, string[]> = {};
  for (const error of errors) {
    const key = prefix ? `${prefix}.${error.property}` : error.property;
    if (error.constraints) out[key] = Object.values(error.constraints);
    if (Array.isArray(error.children)) {
      const children = flatten(error.children as { property: string; constraints?: Record<string, string> }[], key);
      for (const [k, v] of Object.entries(children)) out[k] = v;
    }
  }
  return out;
};

export const validateDto = <T extends object>(Dto: DtoConstructor<T>, options: ValidationOptions<T>): RequestHandler =>
  (req: Request, _res: Response, next: NextFunction) => {
    const source = options.from ?? 'body';
    const raw = req[SOURCE_KEY[source] as 'body' | 'query' | 'params'] as unknown;
    // A GET with no body sends undefined; an empty object is the same thing to a
    // DTO whose fields are all optional, and avoids a null dereference.
    const instance = plainToInstance(Dto, raw ?? {}, {
      enableImplicitConversion: false,
      excludeExtraneousValues: false,
    });
    // `whitelist: true` strips anything the DTO does not declare; forbidUnknown
    // is deliberately off so an extra field is ignored rather than rejected,
    // which is kinder to a client sending along extra telemetry.
    validate(instance, { whitelist: true, forbidUnknownValues: false, stopAtFirstError: false })
      .then((errors) => {
        if (!errors.length) {
          (req as unknown as Record<string, unknown>)[options.target] = instance;
          next();
          return;
        }
        const fields = flatten(
          errors as unknown as { property: string; constraints?: Record<string, string>; children?: unknown[] }[],
        );
        const summary = Object.entries(fields)
          .map(([field, messages]) => `${field}: ${messages.join(', ')}`)
          .join('; ');
        next(new ValidationError(`invalid request: ${summary}`, { fields }));
      })
      .catch(next);
  };
