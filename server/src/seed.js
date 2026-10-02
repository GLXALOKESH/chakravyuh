#!/usr/bin/env node
/**
 * Seeds the database from data/<profile>/ (TRD section 9).
 *
 * Reads the generator's output and the pipeline's outputs, drops the domain
 * tables and inserts everything inside one transaction, so a failure part way
 * through leaves the previous data intact. Running it twice is a no-op in
 * effect: the counts come out the same.
 *
 * Expected input, matching TRD sections 5 and 6:
 *   data/<profile>/accounts.json
 *   data/<profile>/identifiers.json
 *   data/<profile>/transactions.json
 *   data/<profile>/ground_truth.json          optional, logged only
 *   data/<profile>/outputs/rings.json
 *   data/<profile>/outputs/alerts.json
 *   data/<profile>/outputs/metrics.json
 *   data/<profile>/outputs/recruits.json
 *
 * If data/<profile>/ is missing and SEED_FIXTURES is on, devFixtures.js supplies
 * a contract-shaped dataset instead. See the header of that file.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { connect, close, transaction, migrate, getDriverName } from './db/index.js';
import * as accounts from './models/accounts.js';
import * as identifiers from './models/identifiers.js';
import * as transactions from './models/transactions.js';
import * as rings from './models/rings.js';
import * as alerts from './models/alerts.js';
import * as recruits from './models/recruits.js';
import * as metrics from './models/metrics.js';
import { buildFixtures, FIXTURE_SEED } from '../devFixtures.js';

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw new Error(`${file}: ${err.message}`);
  }
}

/** Loads one profile from disk, or null when the directory is absent. */
async function loadProfile(profile) {
  const dir = path.join(config.dataDir, profile);
  const outputs = path.join(dir, 'outputs');
  try {
    await fs.access(dir);
  } catch {
    return null;
  }
  const [accountsFile, identifiersFile, transactionsFile, groundTruth, ringsFile, alertsFile, metricsFile, recruitsFile] =
    await Promise.all([
      readJson(path.join(dir, 'accounts.json')),
      readJson(path.join(dir, 'identifiers.json')),
      readJson(path.join(dir, 'transactions.json')),
      readJson(path.join(dir, 'ground_truth.json')),
      readJson(path.join(outputs, 'rings.json')),
      readJson(path.join(outputs, 'alerts.json')),
      readJson(path.join(outputs, 'metrics.json')),
      readJson(path.join(outputs, 'recruits.json')),
    ]);

  if (!accountsFile && !transactionsFile) return null;
  return {
    source: `data/${profile}`,
    accounts: accountsFile ?? [],
    identifiers: identifiersFile ?? [],
    transactions: transactionsFile ?? [],
    ground_truth: groundTruth,
    rings: ringsFile ?? [],
    alerts: alertsFile ?? [],
    metrics: metricsFile ?? null,
    recruits: recruitsFile ?? [],
  };
}

async function seed(profile = config.seedProfile, { forceFixtures = config.seedFixtures } = {}) {
  await connect();
  await migrate({ logger: null });

  let data = forceFixtures ? null : await loadProfile(profile);
  let source = `data/${profile}`;
  if (!data) {
    if (!forceFixtures) {
      throw new Error(`no data/${profile}/ found. Run ml/generate.py and ml/pipeline.py first, or set SEED_FIXTURES=1.`);
    }
    const built = buildFixtures({ seed: FIXTURE_SEED });
    data = {
      source: 'server/devFixtures.js',
      accounts: built.accounts,
      identifiers: built.identifiers,
      transactions: built.transactions,
      ground_truth: built.ground_truth,
      rings: built.rings,
      alerts: built.alerts,
      metrics: built.metrics,
      recruits: built.recruits,
    };
    source = 'server/devFixtures.js';
  }

  // Rings first: accounts.ring_id and recruits.ring_id both reference them.
  await transaction(async (tx) => {
    await tx.exec(`
      TRUNCATE seed_meta, metrics, recruits, alerts, transactions, identifiers, accounts, rings
      RESTART IDENTITY CASCADE;
    `);
    await rings.upsertMany(data.rings, tx);
    await accounts.upsertMany(data.accounts, tx);
    await identifiers.upsertMany(data.identifiers, tx);
    await transactions.upsertMany(data.transactions, tx);
    await alerts.upsertMany(data.alerts, tx);
    await recruits.upsertMany(data.recruits, tx);
    if (data.metrics) {
      await metrics.set({ rows: data.metrics.rows ?? [], note: data.metrics.note }, tx);
    }
    await tx.query(
      `INSERT INTO seed_meta (key, value) VALUES ('last_seed', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [JSON.stringify({ source, profile, seeded_at: new Date().toISOString(), fixture_seed: FIXTURE_SEED })],
    );
  });

  const counts = {
    accounts: await accounts.count(),
    identifiers: await identifiers.count(),
    transactions: await transactions.count(),
    rings: await rings.count(),
    alerts: await alerts.count(),
  };

  return { source, profile, counts, groundTruth: data.ground_truth };
}

/** Ring recovery against the generator's ground truth, for the build log. */
function reportGroundTruth(groundTruth) {
  if (!groundTruth?.ring_members) return;
  const found = Object.values(groundTruth.ring_members).filter((members) => members.length >= 3).length;
  console.log(`  ground truth rings: ${Object.keys(groundTruth.ring_members).length}, populated: ${found}`);
  if (groundTruth.victim_txn_id) console.log(`  victim transaction: ${groundTruth.victim_txn_id}`);
  if (groundTruth.account_e) console.log(`  account E: ${groundTruth.account_e}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const profileArg = process.argv[2];
  try {
    const result = await seed(profileArg);
    console.log(`seeded from ${result.source} via ${getDriverName()}`);
    for (const [table, n] of Object.entries(result.counts)) {
      console.log(`  ${table.padEnd(13)} ${n}`);
    }
    reportGroundTruth(result.groundTruth);
    await close();
    process.exit(0);
  } catch (err) {
    console.error('seed failed:', err.message);
    await close().catch(() => {});
    process.exit(1);
  }
}

export { seed, loadProfile };