/**
 * `npm run seed [profile]`
 *
 * Loads data/<profile>/ (or the dev fixtures) into MongoDB and prints the
 * resulting counts. Re-running it is safe: the load is one transaction and the
 * collections are cleared first.
 */
import { config } from '../configs/env.js';
import { connect, disconnect } from '../configs/mongoose.js';
import { seed } from '../services/seed.service.js';
import { errorFields, flushLogs, logEvent } from '../services/logger.service.js';

const main = async (): Promise<void> => {
  // Fail here with a readable message rather than as a driver stack trace from
  // three frames down.
  await connect();

  const profile = process.argv[2] ?? config.seedProfile;
  await seed(profile);
};

main()
  .then(async () => {
    await disconnect();
    await flushLogs();
    process.exit(0);
  })
  .catch(async (err: unknown) => {
    logEvent('error', 'seed.cli_failed', { ...errorFields(err), direction: 'internal' });
    await disconnect().catch(() => {});
    await flushLogs();
    process.exit(1);
  });
