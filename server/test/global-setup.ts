/**
 * Runs once before the suite.
 *
 * Creates the test schema from prisma/schema.prisma with `prisma db push`.
 * Push rather than `migrate deploy` because the repository has no committed
 * migration history yet, and the schema is the source of truth; once migrations
 * exist this should become `prisma migrate deploy` so the test schema is built
 * the same way a fresh deployment would build it.
 *
 * Skipped entirely when no connection string is configured, so `npm test` is
 * still useful before one is supplied.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveTestDatabaseUrl } from './db-url.js';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export default async function setup(): Promise<void> {
  const url = resolveTestDatabaseUrl();
  if (!url) {
    console.log('[test] no DATABASE_URL, database-backed suites will be skipped');
    return;
  }

  console.log(`[test] syncing schema to ${new URL(url).pathname.replace(/^\//, '')} (schema=${new URL(url).searchParams.get('schema') ?? 'default'})`);
  execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], {
    cwd: serverRoot,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  });
}
