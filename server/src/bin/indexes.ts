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

const main = async (): Promise<void> => {
  await connect();
  const created = await ensureIndexes();

  console.log(`indexes ready on ${created} collections`);
  for (const model of ALL_MODELS) {
    const indexes = await model.listIndexes();
    console.log(`  ${model.collection.collectionName.padEnd(13)} ${indexes.length}`);
  }
};

main()
  .then(async () => {
    await disconnect();
    process.exit(0);
  })
  .catch(async (err: unknown) => {
    console.error('index setup failed:', (err as Error).message);
    await disconnect().catch(() => {});
    process.exit(1);
  });