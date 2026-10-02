/**
 * `npm run seed [profile]`
 *
 * Loads data/<profile>/ (or the dev fixtures) into PostgreSQL and prints the
 * resulting counts. Re-running it is safe: the load is one transaction and the
 * tables are truncated first.
 */
import { config } from '../configs/env.js';
import { describeDatabase, disconnect, prisma } from '../configs/prisma.js';
import { seed } from '../services/seed.service.js';
import type { GroundTruth } from '../interfaces/domain.interface.js';

/** Ring recovery against the generator's ground truth, for the build log. */
const reportGroundTruth = (groundTruth: GroundTruth | null): void => {
  if (!groundTruth?.ring_members) return;
  const populated = Object.values(groundTruth.ring_members).filter((members) => members.length >= 3).length;
  console.log(`  ground truth rings: ${Object.keys(groundTruth.ring_members).length}, populated: ${populated}`);
  if (groundTruth.victim_txn_id) console.log(`  victim transaction: ${groundTruth.victim_txn_id}`);
  if (groundTruth.account_e) console.log(`  account E: ${groundTruth.account_e}`);
};

const main = async (): Promise<void> => {
  // Fail here with a readable message rather than deep inside Prisma.
  prisma();

  const profile = process.argv[2] ?? config.seedProfile;
  const result = await seed(profile);
  const database = describeDatabase();

  console.log(`seeded ${profile} from ${result.source} into ${database.host}/${database.database}`);
  for (const [table, n] of Object.entries(result.counts)) {
    console.log(`  ${table.padEnd(13)} ${n}`);
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
