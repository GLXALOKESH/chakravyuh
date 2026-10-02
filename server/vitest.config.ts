import 'reflect-metadata';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    // Generous, because the cost here is dominated by round trips rather than
    // by CPU: seed.test.ts reseeds before each of its checks, and against Atlas
    // a seed of 5,000 documents takes roughly 25 seconds where a local mongod
    // takes under one. Raise these rather than watching the suite flake.
    testTimeout: 180_000,
    hookTimeout: 180_000,
    include: ['test/**/*.test.ts'],
    // Runs once, before any worker: connects and creates the indexes.
    globalSetup: ['test/global-setup.ts'],
    // Per-worker, before any import: redirects MONGO_URL at the test database.
    setupFiles: ['test/setup.ts'],
    // Each file gets its own process, which matters because the Mongoose
    // connection is a per-process singleton. Files also run one at a time,
    // because the database-backed ones clear the same shared test database.
    pool: 'forks',
    fileParallelism: false,
    reporters: 'default',
  },
});
