import 'reflect-metadata';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    // The fixture generator builds 600 accounts and 5,000 transactions, and the
    // PDF is written synchronously, so a couple of files run long by design.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    include: ['test/**/*.test.ts'],
    // Runs once, before any worker: creates the test schema.
    globalSetup: ['test/global-setup.ts'],
    // Per-worker, before any import: redirects DATABASE_URL at the test schema.
    setupFiles: ['test/setup.ts'],
    // Each file gets its own process, which matters because the Prisma client is
    // a per-process singleton. Files also run one at a time, because the
    // database-backed ones truncate the same shared test schema.
    pool: 'forks',
    fileParallelism: false,
    reporters: 'default',
  },
});
