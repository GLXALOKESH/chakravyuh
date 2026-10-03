/**
 * Seeding support: clearing the domain collections and recording what was
 * loaded.
 *
 * Delete every document rather than dropping the collections, so the indexes
 * declared on the schemas survive a reseed. Dropping them would leave the
 * database unindexed until the next createIndexes, and the replay query over
 * five thousand transactions is the one thing the demo cannot afford to be slow.
 */
import { SeedMeta, SEED_META_ID, ALL_MODELS } from '../models/index.js';
import { logQuery, withDbLog } from '../utilities/db-log.util.js';
import type { Writer } from '../interfaces/repository.interface.js';

/** Collection names, in the order truncateAll clears them. See models/index.ts. */
export const DOMAIN_COLLECTIONS = ALL_MODELS.map((model) => model.collection.collectionName);

/**
 * Empties every domain collection inside the caller's transaction.
 *
 * SeedMeta is included so a re-seed also clears the record of the previous one.
 * Because this runs inside the seeder's transaction, a later failure rolls the
 * deletes back too and the previous dataset survives intact.
 */
export const truncateAll = async (tx: Writer): Promise<void> => {
  for (const model of ALL_MODELS) {
    // deleteMany({}) on a collection that does not exist yet creates nothing and
    // matches nothing, which is what a first seed wants.
    await withDbLog({ collection: model.collection.collectionName, operation: 'deleteMany' },
      () => model.collection.deleteMany({}, { session: tx }));
  }
};

export interface SeedRecord {
  source: string;
  profile: string;
  seeded_at: string;
  fixture_seed: number;
  counts?: Record<string, number>;
}

/**
 * Records the last seed.
 *
 * Written outside the seeder's transaction, after it commits: this is the line
 * that says "the data currently in the database is this", and it must not
 * survive a load that rolled back.
 */
export const setLastSeed = async (value: SeedRecord, tx?: Writer): Promise<void> => {
  await logQuery(SeedMeta.findOneAndUpdate(
    { _id: SEED_META_ID },
    { $set: { value } },
    { upsert: true, returnDocument: 'after', session: tx },
  ));
};

export const getLastSeed = async (): Promise<SeedRecord | null> => {
  const row = await logQuery(SeedMeta.findById(SEED_META_ID).lean());
  return (row?.value as SeedRecord | null) ?? null;
};
