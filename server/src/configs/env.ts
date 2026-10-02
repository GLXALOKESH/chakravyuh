/**
 * Environment configuration for the Chakravyuh API.
 *
 * Defaults follow TRD section 9 exactly, MONGO_URL included.
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
  /** MONGO_URL, TRD section 9. */
  readonly mongoUrl: string;
  /** Whether MONGO_URL came from the environment rather than from the default. */
  readonly mongoUrlExplicit: boolean;
  /** How long to wait for MongoDB to pick a server before giving up. */
  readonly dbConnectTimeoutMs: number;
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

/** The MONGO_URL default from the configuration table in TRD section 9. */
const TRD_DEFAULT_MONGO_URL = 'mongodb://localhost:27017/chakravyuh';

const explicitMongoUrl = process.env.MONGO_URL?.trim() || null;

export const config: AppConfig = {
  port: int(process.env.PORT, 4000),
  nodeEnv: process.env.NODE_ENV ?? 'development',

  // TRD section 9 gives mongodb://localhost:27017/chakravyuh as the default. It
  // is applied here but not treated as configured: a default that nothing has
  // pointed at is not a database, and bin/server.ts and the test suite both need
  // to tell "the default local mongod is not running" apart from "no database
  // was ever chosen".
  mongoUrl: explicitMongoUrl ?? TRD_DEFAULT_MONGO_URL,
  mongoUrlExplicit: explicitMongoUrl !== null,

  dbConnectTimeoutMs: int(process.env.DB_CONNECT_TIMEOUT_MS, 10_000),

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
 * True when a real database has been pointed at.
 *
 * Requires MONGO_URL to have been set explicitly, because the TRD default is
 * always present in config.mongoUrl and must not read as a choice. A placeholder
 * is also reported as no database: .env.example ships one so the project is
 * runnable on a fresh clone, and the startup banner and the test suite both want
 * "nothing configured" rather than a connection refused on 127.0.0.1.
 */
export const hasDatabase = (): boolean => {
  if (!config.mongoUrlExplicit) return false;
  return !/placeholder|changeme|<.*>|YOUR_|xxx/i.test(config.mongoUrl);
};
