/**
 * Environment configuration for the Chakravyuh API.
 *
 * Defaults follow TRD section 9. The one deliberate rename from the document is
 * MONGO_URL -> DATABASE_URL, because the team chose PostgreSQL over MongoDB.
 * See README "Deviations from the TRD".
 *
 * Read once at import time. Everything that needs configuration takes it from
 * here rather than touching process.env, so a typo in an env var name is a
 * compile error in one place instead of a silent undefined at runtime.
 */
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** server/, two levels up from src/configs/. */
export const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
/** The repository root, so data/ is found next to server/ (TRD section 4). */
export const repoRoot = path.resolve(serverRoot, '..');

dotenv.config({ path: path.join(serverRoot, '.env') });

const bool = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
};

const int = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export interface AppConfig {
  readonly port: number;
  readonly nodeEnv: string;
  readonly databaseUrl: string;
  readonly mlUrl: string;
  readonly mlTimeoutMs: number;
  readonly useMocks: boolean;
  readonly seedProfile: string;
  readonly seedFixtures: boolean;
  /** Where the generator writes its JSON (TRD section 5). */
  readonly dataDir: string;
  readonly replayDefaultSpeed: number;
  readonly replayTickMs: number;
}

export const config: AppConfig = {
  port: int(process.env.PORT, 4000),
  nodeEnv: process.env.NODE_ENV ?? 'development',

  /**
   * PostgreSQL connection string, used both by the Prisma client at runtime and
   * by the Prisma CLI through prisma.config.ts.
   */
  databaseUrl: process.env.DATABASE_URL ?? '',

  mlUrl: process.env.ML_URL ?? 'http://localhost:8000',
  mlTimeoutMs: int(process.env.ML_TIMEOUT_MS, 3000),

  useMocks: bool(process.env.USE_MOCKS, false),

  seedProfile: process.env.SEED_PROFILE ?? 'demo',
  seedFixtures: bool(process.env.SEED_FIXTURES, true),

  dataDir: path.resolve(repoRoot, 'data'),

  /** Replay defaults, from the socket table in TRD section 8. */
  replayDefaultSpeed: int(process.env.REPLAY_DEFAULT_SPEED, 60),
  replayTickMs: int(process.env.REPLAY_TICK_MS, 250),
};

export const isProduction = (): boolean => config.nodeEnv === 'production';

/**
 * True when a real database is configured.
 *
 * .env ships a placeholder connection string so `prisma generate` works before a
 * database exists, so "set" is not the same as "usable": a placeholder is
 * reported as no database, which is what the startup banner and the test suite
 * both want to know.
 */
export const hasDatabase = (): boolean => {
  if (!config.databaseUrl) return false;
  return !/placeholder|changeme|<.*>|YOUR_|xxx/i.test(config.databaseUrl);
};
