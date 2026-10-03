/**
 * Bulk insert shared by every write repository.
 *
 * The seeder inserts roughly six thousand documents, so it goes through MongoDB
 * rather than around it: insertMany is one command per batch instead of one
 * round trip per document.
 */
import type { ClientSession } from 'mongoose';
import { chunk } from '../utilities/serialize.util.js';
import { INSERT_BATCH_SIZE } from '../constants/index.js';
import type { Writer } from '../interfaces/repository.interface.js';
import { validateDbWrite, withDbLog } from '../utilities/db-log.util.js';
import { logEvent } from '../services/logger.service.js';
import { config } from '../configs/env.js';

/** MongoDB's duplicate-key error, which the write path treats as a no-op. */
const DUPLICATE_KEY = 11000;

const isDuplicateKey = (err: unknown): boolean => {
  const e = err as { code?: number; writeErrors?: { code?: number }[] } | null;
  if (e?.code === DUPLICATE_KEY) return true;
  const writeErrors = e?.writeErrors;
  return Array.isArray(writeErrors) && writeErrors.length > 0 && writeErrors.every((w) => w.code === DUPLICATE_KEY);
};

/**
 * Just the part of a Mongoose model this helper uses.
 *
 * Structural rather than `Model<T>`: Mongoose's Model type carries enough
 * generic state that `Model<A>` and `Model<B>` are mutually unassignable, so
 * naming it here would force a cast at every call site. This is the one place
 * that loosens, and it only widens what is accepted, never what is returned.
 */
interface BulkTarget {
  collection: { collectionName: string };
  /** Validates a plain object against the schema, throwing on the first problem. */
  validate(doc: unknown): Promise<unknown>;
  insertMany(docs: unknown[], options: { session?: ClientSession; ordered: boolean }): Promise<unknown>;
}

/**
 * Inserts documents in batches, tolerating ones that already exist.
 *
 * Three behaviours worth stating, because each replaces something the previous
 * relational implementation got from the database for free.
 *
 * Validation is explicit and happens before anything is sent, because
 * Mongoose's insertMany does *not* reject an invalid document when
 * `ordered: false` - it drops it and reports success. Left alone, a transaction
 * with an unknown channel would have been silently skipped, which is worse than
 * the old enum violation: the seed would report success with rows missing.
 * Validating the batch up front makes a bad profile fail loudly, and the
 * surrounding transaction roll back.
 *
 * A duplicate _id is skipped rather than raised, which is what makes re-running
 * the seed a no-op in effect, as TRD section 9 asks.
 *
 * Any other write error still throws, so a genuine failure cannot be mistaken
 * for a repeat run.
 */
export const insertBatches = async (Model: BulkTarget, docs: unknown[], tx?: Writer): Promise<void> => {
  if (!docs.length) return;

  const collection = Model.collection.collectionName;
  let attempted = 0;
  let inserted = 0;
  let completed = 0;
  let unknown = 0;
  let lastSummary = performance.now();
  const summary = (): void => {
    if (config.logging.dbEnabled) logEvent('info', 'db.batch.summary', {
      collection, operation: 'insertMany', batches_completed: completed,
      attempted_count: attempted, counts: { known_inserted: inserted, batches_with_unknown_count: unknown },
      commit_state: tx?.inTransaction() ? 'pending' : 'not_in_transaction', direction: 'internal',
    });
    lastSummary = performance.now();
  };

  try {
    for (const batch of chunk(docs, INSERT_BATCH_SIZE)) {
      if (!batch.length) continue;

      await validateDbWrite(collection, async () => {
        for (const doc of batch) await Model.validate(doc);
      });

      attempted += batch.length;
      try {
        // ordered: false lets the server take the whole batch even when one key
        // repeats, instead of stopping at the first one.
        const result = await withDbLog({ collection, operation: 'insertMany', attempted_count: batch.length, batch: completed + 1 },
          () => Model.insertMany(batch, { session: tx, ordered: false }));
        if (Array.isArray(result)) inserted += result.length;
        else unknown += 1;
      } catch (err) {
        unknown += 1;
        if (!isDuplicateKey(err)) throw err;
        if (config.logging.dbEnabled) logEvent('warn', 'db.duplicate_skipped', { collection, error_code: DUPLICATE_KEY, attempted_count: batch.length, direction: 'internal' });
      }
      completed += 1;
      if (performance.now() - lastSummary >= config.logging.streamIntervalMs) summary();
    }
  } finally {
    summary();
  }
};
