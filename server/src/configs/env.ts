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
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withDefaultDatabaseName } from '../utilities/mongo-url.util.js';

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
  readonly logging: {
    readonly level: 'debug' | 'info' | 'warn' | 'error' | 'silent';
    readonly format: 'json' | 'pretty';
    readonly dbEnabled: boolean;
    readonly dbSlowMs: number;
    readonly streamIntervalMs: number;
  };
  /** Live mode (docs/STREAMING.md). */
  readonly stream: {
    /** Serve live mode with no database: replay and the stored-data routes are switched off. */
    readonly only: boolean;
    /** Python that runs ml/stream_generator.py. */
    readonly pythonBin: string;
    readonly generatorScript: string;
    readonly defaultRate: number;
    readonly tickMs: number;
    readonly predictIntervalMs: number;
    /** Longer than ML_TIMEOUT_MS: a batch can carry a few thousand transactions. */
    readonly predictTimeoutMs: number;
    /** Transactions per predictor request, at most. */
    readonly predictBatchMax: number;
    /** A run ends at this many transactions, so memory stays bounded. */
    readonly maxTxns: number;
    /** Required on POST /api/stream/ingest. Unset, that route is closed. */
    readonly ingestToken: string | null;
  };
}

/** The ML virtualenv's Python if there is one, else whatever `python` is on the PATH. */
const defaultPython = (): string => {
  const venv = path.join(repoRoot, 'ml', '.venv');
  for (const candidate of [path.join(venv, 'Scripts', 'python.exe'), path.join(venv, 'bin', 'python')]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return process.platform === 'win32' ? 'python' : 'python3';
};

/** The MONGO_URL default from the configuration table in TRD section 9. */
const TRD_DEFAULT_MONGO_URL = 'mongodb://localhost:27017/chakravyuh';

/** The database this project owns, and the one TRD section 9 defaults to. */
const DB_NAME = 'chakravyuh';

const explicitMongoUrl = process.env.MONGO_URL?.trim() || null;

/**
 * A connection string with no database name is a trap: the driver defaults to a
 * database called `test`, so the server starts, every query succeeds, and the
 * whole dataset lands somewhere nobody is looking. Atlas connection strings get
 * copied out of the dashboard without the path, so the name is filled in here
 * rather than left to chance. The TRD default URL already carries one.
 */
const mongoUrl = explicitMongoUrl
  ? withDefaultDatabaseName(explicitMongoUrl, DB_NAME)
  : TRD_DEFAULT_MONGO_URL;

export const config: AppConfig = {
  port: int(process.env.PORT, 4000),
  nodeEnv: process.env.NODE_ENV ?? 'development',

  // TRD section 9 gives mongodb://localhost:27017/chakravyuh as the default. It
  // is applied here but not treated as configured: a default that nothing has
  // pointed at is not a database, and bin/server.ts and the test suite both need
  // to tell "the default local mongod is not running" apart from "no database
  // was ever chosen".
  mongoUrl,
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

  logging: {
    level: (['debug', 'info', 'warn', 'error', 'silent'].includes(process.env.LOG_LEVEL ?? '')
      ? process.env.LOG_LEVEL
      : process.env.NODE_ENV === 'test' ? 'silent' : 'info') as AppConfig['logging']['level'],
    format: process.env.LOG_FORMAT === 'pretty' ? 'pretty' : 'json',
    dbEnabled: bool(process.env.LOG_DB_ENABLED, true),
    dbSlowMs: Math.max(0, int(process.env.LOG_DB_SLOW_MS, 200)),
    streamIntervalMs: Math.max(100, int(process.env.LOG_STREAM_INTERVAL_MS, 1000)),
  },

  stream: {
    only: bool(process.env.STREAM_ONLY, false),
    pythonBin: process.env.PYTHON_BIN ?? defaultPython(),
    generatorScript: process.env.STREAM_GENERATOR ?? path.join(repoRoot, 'ml', 'stream_generator.py'),
    defaultRate: int(process.env.STREAM_DEFAULT_RATE, 300),
    tickMs: int(process.env.STREAM_TICK_MS, 250),
    predictIntervalMs: int(process.env.STREAM_PREDICT_INTERVAL_MS, 1000),
    predictTimeoutMs: int(process.env.STREAM_PREDICT_TIMEOUT_MS, 5000),
    predictBatchMax: int(process.env.STREAM_PREDICT_BATCH_MAX, 5000),
    maxTxns: int(process.env.STREAM_MAX_TXNS, 200_000),
    ingestToken: process.env.STREAM_INGEST_TOKEN?.trim() || null,
  },
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
