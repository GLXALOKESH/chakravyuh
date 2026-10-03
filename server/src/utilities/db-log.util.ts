/** Logs logical DB executions, including casting/selection/network time, exactly once. */
import mongoose from 'mongoose';
import { config } from '../configs/env.js';
import { elapsedMs, errorFields, logEvent, type LogFields } from '../services/logger.service.js';
import { currentLogContext, logId } from './log-context.util.js';

export interface DbOperation {
  collection: string;
  operation: string;
  database?: string;
  attempted_count?: number;
  filter_fields?: string[];
  sort_fields?: string[];
  projection_fields?: string[];
  limit?: number;
  skip?: number;
  stage?: string;
  batch?: number;
}

const resultCounts = (operation: string, result: unknown): LogFields => {
  if (operation === 'countDocuments' || operation === 'estimatedDocumentCount') return { count_value: result };
  if (operation === 'find' || operation === 'aggregate') return { returned_count: Array.isArray(result) ? result.length : 0 };
  if (operation === 'findOne' || operation === 'findOneAndUpdate') return { returned_count: result == null ? 0 : 1 };
  if (operation === 'insertMany') return Array.isArray(result) ? { inserted_count: result.length } : {};
  const counts: LogFields = {};
  if (result && typeof result === 'object') {
    const value = result as Record<string, unknown>;
    for (const [from, to] of Object.entries({ matchedCount: 'matched_count', modifiedCount: 'modified_count', deletedCount: 'deleted_count', insertedCount: 'inserted_count', upsertedCount: 'upserted_count' })) {
      if (typeof value[from] === 'number') counts[to] = value[from];
    }
  }
  return counts;
};

export const withDbLog = async <T>(meta: DbOperation, execute: () => Promise<T>): Promise<T> => {
  if (!config.logging.dbEnabled) return execute();
  const start = performance.now();
  const fields = {
    ...meta, database: meta.database ?? mongoose.connection.name,
    operation_id: logId(), peer: 'mongodb', measurement_scope: 'application_operation',
    ...(currentLogContext().transaction_id ? { commit_state: 'pending' } : {}),
  };
  const level = currentLogContext().seed_id ? 'debug' : 'info';
  logEvent(level, 'db.operation', { ...fields, direction: 'out' });
  try {
    const result = await execute();
    const duration = elapsedMs(start);
    const slow = duration >= config.logging.dbSlowMs;
    logEvent(slow ? 'warn' : level, 'db.result', { ...fields, ...resultCounts(meta.operation, result), direction: 'in', duration_ms: duration, slow });
    return result;
  } catch (error) {
    const name = (error as Error)?.name;
    const validation = ['ValidationError', 'CastError', 'StrictModeError'].includes(name);
    logEvent('error', 'db.error', { ...fields, ...errorFields(error), direction: 'internal', duration_ms: elapsedMs(start), stage: validation ? 'validation' : meta.stage ?? 'execution' });
    throw error;
  }
};

/** Local schema validation is not a MongoDB request/response. */
export const validateDbWrite = async <T>(collection: string, validate: () => Promise<T>): Promise<T> => {
  try { return await validate(); }
  catch (error) {
    if (config.logging.dbEnabled) logEvent('error', 'db.validation_error', {
      collection, operation_id: logId(), stage: 'validation', direction: 'internal', ...errorFields(error),
    });
    throw error;
  }
};

/** Structural typing retains each query's inferred lean result type. */
interface LoggedQuery<T> {
  exec(): Promise<T>;
  model: { collection: { collectionName: string }; db: { name?: string } };
  getFilter(): Record<string, unknown>;
  getOptions(): { limit?: number; skip?: number; sort?: unknown };
  projection(): Record<string, unknown> | null | undefined;
}

export const logQuery = <T>(query: LoggedQuery<T>): Promise<T> => {
  const options = query.getOptions();
  // Query.op is present at runtime in Mongoose 9 but omitted from its public TS declaration.
  const operation = (query as unknown as { op: string }).op;
  return withDbLog({
    collection: query.model.collection.collectionName, database: query.model.db.name, operation,
    filter_fields: Object.keys(query.getFilter()), projection_fields: Object.keys(query.projection() ?? {}),
    sort_fields: options.sort && typeof options.sort === 'object' ? Object.keys(options.sort) : [],
    limit: options.limit, skip: options.skip,
  }, () => query.exec());
};
