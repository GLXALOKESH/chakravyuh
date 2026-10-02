/**
 * `npm run seed [profile]`
 *
 * Loads data/<profile>/ (or the dev fixtures) into MongoDB and prints the
 * resulting counts. Re-running it is safe: the load is one transaction and the
 * collections are cleared first.
 */
import { config } from '../configs/env.js';
import { connect, describeDatabase, disconnect } from '../configs/mongoose.js';
import { seed } from '../services/seed.service.js';
import type { GroundTruth } from '../interfaces/domain.interface.js';

/** Ring recovery against the generator's ground truth, for the build log. */
const reportGroundTruth = (groundTruth: GroundTruth | null): void => {
  const rings = groundTruth?.ring_members;
  if (!rings) return;
  const populated = Object.values(rings).filter((members) => (members?.length ?? 0) >= 3).length;
  console.log(`  ground truth rings: ${Object.keys(rings).length}, populated: ${populated}`);
  if (groundTruth?.victim_txn_id) console.log(`  victim transaction: ${groundTruth.victim_txn_id}`);
  if (groundTruth?.account_e) console.log(`  account E: ${groundTruth.account_e}`);
};

const main = async (): Promise<void> => {
  // Fail here with a readable message rather than as a driver stack trace from
  // three frames down.
  await connect();

  const profile = process.argv[2] ?? config.seedProfile;
  const result = await seed(profile);
  const database = describeDatabase();

  console.log(`seeded ${profile} from ${result.source} into ${database.host}/${database.database}`);
  for (const [collection, n] of Object.entries(result.counts)) {
    console.log(`  ${collection.padEnd(13)} ${n}`);
  }
  reportGroundTruth(result.groundTruth);
};

main()
  .then(async () => {
    await disconnect();
    process.exit(0);
  })
  .catch(async (err: unknown) => {
    console.error('seed failed:', (err as Error).message);
    await disconnect().catch(() => {});
    process.exit(1);
  });