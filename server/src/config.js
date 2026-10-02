/**
 * Configuration for the Chakravyuh Express API.
 *
 * Defaults follow TRD section 9. The one deliberate rename is MONGO_URL ->
 * DATABASE_URL, because the team decided to run PostgreSQL rather than MongoDB.
 * See README "Deviations from the TRD".
 */
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const repoRoot = path.resolve(serverRoot, '..');

dotenv.config({ path: path.join(serverRoot, '.env') });

const bool = (value, fallback) => {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

const int = (value, fallback) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const config = {
  port: int(process.env.PORT, 4000),
  nodeEnv: process.env.NODE_ENV ?? 'development',

  /**
   * When DATABASE_URL is unset the API runs on PGlite, an in-process build of
   * real PostgreSQL. Same dialect, same behaviour, zero system install, so the
   * demo works on a laptop that has never had Postgres set up.
   */
  databaseUrl: process.env.DATABASE_URL || null,
  // PGLITE_DIR=:memory: asks for a throwaway in-memory database (tests).
  // Checked before path.resolve, otherwise the sentinel becomes a real
  // directory literally named ":memory:".
  pgliteInMemory: (process.env.PGLITE_DIR ?? '.pglite') === ':memory:',
  pgliteDir:
    (process.env.PGLITE_DIR ?? '.pglite') === ':memory:'
      ? ':memory:'
      : path.resolve(serverRoot, process.env.PGLITE_DIR ?? '.pglite'),

  mlUrl: process.env.ML_URL ?? 'http://localhost:8000',
  mlTimeoutMs: int(process.env.ML_TIMEOUT_MS, 3000),

  useMocks: bool(process.env.USE_MOCKS, false),

  seedProfile: process.env.SEED_PROFILE ?? 'demo',
  seedFixtures: bool(process.env.SEED_FIXTURES, true),

  /** data/ sits at the repo root, not inside server/ (TRD section 4). */
  dataDir: path.resolve(repoRoot, 'data'),
  sqlDir: path.resolve(serverRoot, 'sql'),

  /** Replay defaults (TRD section 8 socket table). */
  replayDefaultSpeed: int(process.env.REPLAY_DEFAULT_SPEED, 60),
  replayTickMs: int(process.env.REPLAY_TICK_MS, 250),
};

export const isProduction = config.nodeEnv === 'production';