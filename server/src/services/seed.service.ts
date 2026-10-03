/**
 * Seeds the database from data/<profile>/ (TRD section 9).
 *
 * Reads the generator's output and the pipeline's outputs, clears the domain
 * collections and inserts everything inside one transaction, so a failure part
 * way through leaves the previous data intact. Running it twice is a no-op in
 * effect: the counts come out the same.
 *
 * Expected input, matching TRD sections 5 and 6:
 *   data/<profile>/accounts.json
 *   data/<profile>/identifiers.json
 *   data/<profile>/transactions.json
 *   data/<profile>/ground_truth.json          optional, never logged
 *   data/<profile>/outputs/rings.json
 *   data/<profile>/outputs/alerts.json
 *   data/<profile>/outputs/metrics.json
 *   data/<profile>/outputs/recruits.json
 *   data/<profile>/outputs/fund_flows.json        optional
 *
 * If data/<profile>/ is missing and SEED_FIXTURES is on, the dev fixture
 * generator supplies a contract-shaped dataset instead. See its header.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../configs/env.js';
import { ensureIndexes, withTransaction } from '../configs/mongoose.js';
import * as accounts from '../repositories/accounts.repository.js';
import * as alerts from '../repositories/alerts.repository.js';
import * as fundFlows from '../repositories/fund_flows.repository.js';
import * as identifiers from '../repositories/identifiers.repository.js';
import * as metrics from '../repositories/metrics.repository.js';
import * as recruits from '../repositories/recruits.repository.js';
import * as rings from '../repositories/rings.repository.js';
import * as transactions from '../repositories/transactions.repository.js';
import { setLastSeed, truncateAll } from '../repositories/seed.repository.js';
import { buildFixtures, FIXTURE_SEED } from '../fixtures/generator.js';
import type {
  FixtureAccount,
  FixtureAlert,
  FixtureIdentifier,
  FixtureMetrics,
  FixtureRecruitEntry,
  FixtureRing,
  FixtureTransaction,
} from '../fixtures/types.js';
import type { GroundTruth } from '../interfaces/domain.interface.js';
import type { FundFlowsArtifact } from '../interfaces/fund_flow.interface.js';
import type { TransactionWrite } from '../interfaces/repository.interface.js';
import { elapsedMs, errorFields, logEvent } from './logger.service.js';
import { logId, withLogContext } from '../utilities/log-context.util.js';

export interface ProfileData {
  source: string;
  accounts: FixtureAccount[];
  identifiers: FixtureIdentifier[];
  transactions: FixtureTransaction[];
  ground_truth: GroundTruth | null;
  rings: FixtureRing[];
  alerts: FixtureAlert[];
  metrics: FixtureMetrics | null;
  recruits: FixtureRecruitEntry[];
  fund_flows: FundFlowsArtifact | null;
}

export interface SeedResult {
  source: string;
  profile: string;
  counts: Record<string, number>;
  groundTruth: GroundTruth | null;
}

const readJson = async (file: string): Promise<unknown> => {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return null;
    throw new Error(`${file}: ${(err as Error).message}`);
  }
};

const asArray = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

/**
 * Loads one profile from disk, or null when the directory is absent.
 *
 * A missing file inside a present directory is treated as an empty list, not a
 * failure, so a profile that only has the generator output can still be seeded.
 */
export const loadProfile = async (profile: string): Promise<ProfileData | null> => {
  const dir = path.join(config.dataDir, profile);
  const outputs = path.join(dir, 'outputs');
  try {
    await fs.access(dir);
  } catch {
    return null;
  }

  const [accountsFile, identifiersFile, transactionsFile, groundTruth, ringsFile, alertsFile, metricsFile, recruitsFile, fundFlowsFile] =
    await Promise.all([
      readJson(path.join(dir, 'accounts.json')),
      readJson(path.join(dir, 'identifiers.json')),
      readJson(path.join(dir, 'transactions.json')),
      readJson(path.join(dir, 'ground_truth.json')),
      readJson(path.join(outputs, 'rings.json')),
      readJson(path.join(outputs, 'alerts.json')),
      readJson(path.join(outputs, 'metrics.json')),
      readJson(path.join(outputs, 'recruits.json')),
      readJson(path.join(outputs, 'fund_flows.json')),
    ]);

  if (!accountsFile && !transactionsFile) return null;

  // The generator's JSON uses `_id`, which the API exposes as `id`. Both are
  // accepted so the seeder works against ml/generate.py output unchanged and
  // against anything already normalised to the API's names.
  const normalise = (row: Record<string, unknown>): Record<string, unknown> =>
    row._id !== undefined ? { ...row, id: row._id } : row;

  const metricDoc = metricsFile as { rows?: unknown; note?: string } | null;

  return {
    source: `data/${profile}`,
    accounts: asArray<Record<string, unknown>>(accountsFile).map((r) => normalise(r) as unknown as FixtureAccount),
    identifiers: asArray<Record<string, unknown>>(identifiersFile).map(
      (r) => normalise(r) as unknown as FixtureIdentifier,
    ),
    transactions: asArray<Record<string, unknown>>(transactionsFile).map(
      (r) => normalise(r) as unknown as TransactionWrite,
    ),
    ground_truth: (groundTruth as GroundTruth | null) ?? null,
    rings: asArray<Record<string, unknown>>(ringsFile).map((r) => normalise(r) as unknown as FixtureRing),
    alerts: asArray<Record<string, unknown>>(alertsFile).map((r) => normalise(r) as unknown as FixtureAlert),
    metrics: metricDoc ? { rows: asArray(metricDoc.rows), note: metricDoc.note ?? metrics.DEFAULT_NOTE } : null,
    recruits: asArray<Record<string, unknown>>(recruitsFile).map((r) => r as unknown as FixtureRecruitEntry),
    fund_flows: (fundFlowsFile as FundFlowsArtifact | null) ?? null,
  };
};

export interface SeedOptions {
  /** Ignore data/<profile>/ and use the dev fixture generator. */
  forceFixtures?: boolean;
}

export const seed = (profile: string = config.seedProfile, options: SeedOptions = {}): Promise<SeedResult> =>
  withLogContext({ seed_id: logId() }, async () => {
    const started = performance.now();
    let stage = 'load';
    let committed = false;
    logEvent('info', 'seed.started', { profile, direction: 'internal' });
    try {
      const forceFixtures = options.forceFixtures ?? config.seedFixtures;

      let data = forceFixtures ? null : await loadProfile(profile);
      let source = `data/${profile}`;

      if (!data) {
        if (!forceFixtures) {
          throw new Error(
            `no data/${profile}/ found. Run ml/generate.py and ml/pipeline.py first, or set SEED_FIXTURES=1.`,
          );
        }
        const built = buildFixtures({ seed: FIXTURE_SEED });
        data = { source: 'src/fixtures', ...built, fund_flows: null };
        source = 'src/fixtures (dev generator)';
      }

      logEvent('info', 'seed.profile_loaded', {
        profile, source, direction: 'internal', fund_flows_present: data.fund_flows !== null,
        truncated: data.fund_flows?.summary?.truncated,
        counts: { accounts_input: data.accounts.length, transactions_input: data.transactions.length,
          fund_flow_paths_input: data.fund_flows?.paths?.length ?? 0 },
      });
      stage = 'indexes';
      // Indexes before the write rather than after: a fresh database has none, and
      // a bulk insert into an unindexed collection leaves a window where every
      // query does a collection scan.
      await ensureIndexes();

      // Rings first: accounts.ring_id, alerts.ring_id and recruits.ring_id all
      // point at them. Everything happens in one transaction, so a failure part way
      // through leaves the previous data intact.
      stage = 'transaction';
      await withTransaction(async (tx) => {
        await truncateAll(tx);
        await rings.insertMany(data!.rings, tx);
        await accounts.insertMany(data!.accounts, tx);
        await identifiers.insertMany(data!.identifiers, tx);
        await transactions.insertMany(data!.transactions, tx);
        await alerts.insertMany(data!.alerts, tx);
        await recruits.insertMany(data!.recruits, tx);
        if (data!.metrics) await metrics.set({ rows: data!.metrics.rows, note: data!.metrics.note }, tx);
        if (data!.fund_flows) {
          await fundFlows.setSummary(profile, data!.fund_flows.summary, tx);
          await fundFlows.insertMany(data!.fund_flows.paths, tx);
        }
      });
      committed = true;
      stage = 'counts';

      const counts: Record<string, number> = {
        accounts: await accounts.count(),
        identifiers: await identifiers.count(),
        transactions: await transactions.count(),
        rings: await rings.count(),
        alerts: await alerts.count(),
      };

      stage = 'seed_metadata';
      await setLastSeed({ source, profile, seeded_at: new Date().toISOString(), fixture_seed: FIXTURE_SEED, counts });

      logEvent('info', 'seed.completed', { profile, source, duration_ms: elapsedMs(started), counts,
        fund_flows_present: data.fund_flows !== null, truncated: data.fund_flows?.summary?.truncated,
        commit_state: 'committed', direction: 'internal' });
      return { source, profile, counts, groundTruth: data.ground_truth };
    } catch (error) {
      logEvent('error', 'seed.failed', { profile, stage, duration_ms: elapsedMs(started),
        commit_state: committed ? 'committed' : 'not_confirmed', direction: 'internal', ...errorFields(error) });
      throw error;
    }
  });
