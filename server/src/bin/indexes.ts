/**
 * `npm run db:indexes`
 *
 * Creates the indexes declared on the schemas. MongoDB cannot enforce a schema,
 * so an index is the only part of one the database is asked to honour, and a
 * fresh cluster has none of them.
 *
 * The seeder and the test setup already call this, so this exists for deploying
 * to a fresh database without loading data into it first.
 */
import { connect, disconnect, ensureIndexes } from '../configs/mongoose.js';
import { ALL_MODELS } from '../models/index.js';
import { errorFields, flushLogs, logEvent } from '../services/logger.service.js';
import { withDbLog } from '../utilities/db-log.util.js';

const main = async (): Promise<void> => {
  await connect();
  const created = await ensureIndexes();

  logEvent('info', 'db.indexes_ready', { counts: { collections: created }, direction: 'internal' });
  for (const model of ALL_MODELS) {
    const indexes = await withDbLog({ collection: model.collection.collectionName, operation: 'listIndexes' }, () => model.listIndexes());
    logEvent('info', 'db.indexes', { collection: model.collection.collectionName, counts: { indexes: indexes.length }, direction: 'internal' });
  }
};

main()
  .then(async () => {
    await disconnect();
    await flushLogs();
    process.exit(0);
  })
  .catch(async (err: unknown) => {
    logEvent('error', 'db.indexes_failed', { ...errorFields(err), direction: 'internal' });
    await disconnect().catch(() => {});
    await flushLogs();
    process.exit(1);
  });
