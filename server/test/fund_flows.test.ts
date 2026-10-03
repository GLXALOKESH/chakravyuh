/** File-based fund-flow ingestion, including the real seed transaction and reseed lifecycle. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { config, serverRoot } from '../src/configs/env.js';
import { INSERT_BATCH_SIZE } from '../src/constants/index.js';
import type { FundFlowsArtifact } from '../src/interfaces/fund_flow.interface.js';
import { Account, FundFlowPath, FundFlowSummary, FUND_FLOW_SUMMARY_ID, Transaction } from '../src/models/index.js';
import { getLastSeed } from '../src/repositories/seed.repository.js';
import { loadProfile, seed } from '../src/services/seed.service.js';
import { shutdown } from './helpers.js';

const artifact = (): FundFlowsArtifact => ({
  summary: {
    total_paths_identified: 2,
    avg_hop_latency_minutes: 2.5,
    fastest_path_minutes: 2.5,
    truncated: false,
  },
  paths: ['FLOW01', 'FLOW02'].map((path_id) => ({
    path_id,
    hops: 2,
    start_time: '2026-10-03T09:00:00Z',
    end_time: '2026-10-03T09:02:30Z',
    duration_minutes: 2.5,
    initial_amount_paise: 10_001,
    final_amount_paise: 15_002,
    // A nominal increase is legal. Never clamp or turn this into taint/loss.
    amount_decay_pct: -50.005,
    chain: [
      { step: 1, from_account: 'ACC01', to_account: 'ACC02', txn_id: 'TXN01', timestamp: '2026-10-03T09:00:00Z', amount_paise: 10_001, latency_from_prev_min: null },
      { step: 2, from_account: 'ACC02', to_account: 'CASH', txn_id: 'TXN02', timestamp: '2026-10-03T09:02:30Z', amount_paise: 15_002, latency_from_prev_min: 2.5 },
    ],
  })),
});

let directory: string;
const originalDataDir = config.dataDir;
const artifactPath = () => path.join(directory, 'demo', 'outputs', 'fund_flows.json');
const writeArtifact = (value: FundFlowsArtifact) => fs.writeFile(artifactPath(), JSON.stringify(value));
const seedFiles = (profile = 'demo') => seed(profile, { forceFixtures: false });

/** Isolated files under server/test: never overwrite the ML team's data/. */
const writeProfile = async (profile = 'demo'): Promise<void> => {
  const dir = path.join(directory, profile);
  await fs.mkdir(path.join(dir, 'outputs'), { recursive: true });
  await fs.writeFile(path.join(dir, 'accounts.json'), JSON.stringify([{ _id: 'ACC01', holder: 'Original holder', opening_balance: 500 }]));
  await fs.writeFile(path.join(dir, 'transactions.json'), JSON.stringify([
    { _id: 'TXN01', from: 'ACC01', to: 'ACC02', amount: 100, ts: '2026-10-03T09:00:00Z', channel: 'UPI' },
  ]));
  await fs.writeFile(path.join(dir, 'outputs', 'fund_flows.json'), JSON.stringify(artifact()));
};

beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(serverRoot, 'test', '.fund-flows-'));
  Object.assign(config, { dataDir: directory });
});

beforeEach(async () => {
  await writeProfile();
  await seedFiles();
});

afterAll(async () => {
  Object.assign(config, { dataDir: originalDataDir });
  if (directory) await fs.rm(directory, { recursive: true, force: true });
  await shutdown();
});

describe('fund-flow seed persistence', () => {
  it('loads the optional artifact through the existing JSON loader', async () => {
    expect((await loadProfile('demo'))!.fund_flows).toEqual(artifact());
  });

  it('persists one document per path with deterministic string ids and typed dates', async () => {
    const paths = await FundFlowPath.find({}).sort({ _id: 1 }).lean().exec();
    expect(paths).toHaveLength(2);
    expect(paths.map((p) => p._id)).toEqual(['FLOW01', 'FLOW02']);
    const { path_id, chain, start_time, end_time, ...fields } = artifact().paths[0]!;
    expect(paths[0]).toEqual({
      _id: path_id,
      ...fields,
      start_time: new Date(start_time),
      end_time: new Date(end_time),
      chain: chain.map((step) => ({ ...step, timestamp: new Date(step.timestamp) })),
    });
    // Exact equality also excludes invented ring/role/taint fields and subdoc ids.
    expect(paths[0]!.initial_amount_paise).toBe(10_001);
    expect(paths[0]!.amount_decay_pct).toBe(-50.005);
  });

  it('persists the unmodified summary and the current profile in one document', async () => {
    expect(await FundFlowSummary.find({}).lean().exec()).toEqual([
      { _id: FUND_FLOW_SUMMARY_ID, profile: 'demo', summary: artifact().summary },
    ]);
  });

  it('seeding the same files again does not duplicate paths or summaries', async () => {
    await seedFiles();
    expect(await FundFlowPath.countDocuments({})).toBe(2);
    expect(await FundFlowSummary.countDocuments({})).toBe(1);
    expect(await FundFlowPath.distinct('_id')).toEqual(['FLOW01', 'FLOW02']);
  });

  it('replaces old paths and the summary when reseeding a smaller artifact', async () => {
    const next = artifact();
    next.paths = [next.paths[1]!];
    next.paths[0]!.duration_minutes = 4;
    next.summary.total_paths_identified = 1;
    await writeArtifact(next);
    await seedFiles();
    expect(await FundFlowPath.countDocuments({})).toBe(1);
    expect(await FundFlowPath.findById('FLOW01').lean()).toBeNull();
    expect((await FundFlowPath.findById('FLOW02').lean())!.duration_minutes).toBe(4);
    expect((await FundFlowSummary.findById(FUND_FLOW_SUMMARY_ID).lean())!.summary).toEqual(next.summary);
  });

  it('preserves truncated=true and the reported total without deriving it from stored paths', async () => {
    const next = artifact();
    next.summary = { ...next.summary, total_paths_identified: 5_000, truncated: true };
    await writeArtifact(next);
    await seedFiles();
    expect(await FundFlowPath.countDocuments({})).toBe(2);
    expect((await FundFlowSummary.findById(FUND_FLOW_SUMMARY_ID).lean())!.summary).toEqual(next.summary);
  });

  it('persists an empty artifact summary, including a null fastest path, and clears old paths', async () => {
    const empty: FundFlowsArtifact = {
      summary: { total_paths_identified: 0, avg_hop_latency_minutes: 0, fastest_path_minutes: null, truncated: false },
      paths: [],
    };
    await writeArtifact(empty);
    await seedFiles();
    expect(await FundFlowPath.countDocuments({})).toBe(0);
    expect(await FundFlowSummary.countDocuments({})).toBe(1);
    expect((await FundFlowSummary.findById(FUND_FLOW_SUMMARY_ID).lean())!.summary).toEqual(empty.summary);
  });

  it('treats a missing optional file as absent and clears both previous collections', async () => {
    await fs.unlink(artifactPath());
    expect((await loadProfile('demo'))!.fund_flows).toBeNull();
    await seedFiles();
    expect(await FundFlowPath.countDocuments({})).toBe(0);
    expect(await FundFlowSummary.countDocuments({})).toBe(0);
    expect(await Account.countDocuments({})).toBe(1);
    expect(await Transaction.countDocuments({})).toBe(1);
  });

  it('clears fund flows when the existing fixture seed is selected', async () => {
    await seed('demo', { forceFixtures: true });
    expect(await FundFlowPath.countDocuments({})).toBe(0);
    expect(await FundFlowSummary.countDocuments({})).toBe(0);
    expect(await Account.countDocuments({})).toBe(600);
  });

  it('keeps only the current profile summary when switching profiles', async () => {
    await writeProfile('train');
    await seedFiles('train');
    expect(await FundFlowSummary.find({}).lean()).toEqual([
      { _id: FUND_FLOW_SUMMARY_ID, profile: 'train', summary: artifact().summary },
    ]);
    expect(await FundFlowPath.countDocuments({})).toBe(2);
  });

  it('reports malformed JSON through the existing loader and preserves the previous seed', async () => {
    const previousSeed = await getLastSeed();
    await fs.writeFile(artifactPath(), '{"summary":');
    await expect(seedFiles()).rejects.toThrow(/fund_flows\.json:/);
    expect(await FundFlowPath.countDocuments({})).toBe(2);
    expect((await FundFlowSummary.findById(FUND_FLOW_SUMMARY_ID).lean())!.summary).toEqual(artifact().summary);
    expect(await getLastSeed()).toEqual(previousSeed);
  });

  it('rolls back truncation and all writes when the summary is invalid', async () => {
    const invalid = artifact();
    invalid.summary.total_paths_identified = 1.5;
    await writeArtifact(invalid);
    await expect(seedFiles()).rejects.toThrow(/total_paths_identified/);
    expect(await FundFlowPath.countDocuments({})).toBe(2);
    expect((await FundFlowSummary.findById(FUND_FLOW_SUMMARY_ID).lean())!.summary).toEqual(artifact().summary);
    expect(await Transaction.countDocuments({})).toBe(1);
  });

  it('rolls back earlier batches, the summary, and existing collections on a bad chain amount', async () => {
    const previousSeed = await getLastSeed();
    const next = artifact();
    next.paths = Array.from({ length: INSERT_BATCH_SIZE + 1 }, (_, i) => ({ ...structuredClone(next.paths[0]!), path_id: `NEXT${i}` }));
    next.summary = { ...next.summary, total_paths_identified: next.paths.length, truncated: true };
    next.paths.at(-1)!.chain[1]!.amount_paise = 1.5;
    await writeArtifact(next);
    await fs.writeFile(path.join(directory, 'demo', 'accounts.json'), JSON.stringify([{ _id: 'ACC01', holder: 'Replacement holder' }]));

    await expect(seedFiles()).rejects.toThrow(/amount_paise/);
    expect(await FundFlowPath.countDocuments({})).toBe(2);
    expect(await FundFlowPath.countDocuments({ _id: /^NEXT/ })).toBe(0);
    expect((await FundFlowSummary.findById(FUND_FLOW_SUMMARY_ID).lean())!.summary).toEqual(artifact().summary);
    expect((await Account.findById('ACC01').lean())!.holder).toBe('Original holder');
    expect(await Transaction.countDocuments({})).toBe(1);
    expect(await getLastSeed()).toEqual(previousSeed);
  });

  it('rejects invalid chain timestamps without replacing the previous paths', async () => {
    const next = artifact();
    next.paths[0]!.chain[0]!.timestamp = 'not-a-date';
    await writeArtifact(next);
    await expect(seedFiles()).rejects.toThrow(/timestamp/);
    expect(await FundFlowPath.countDocuments({})).toBe(2);
  });

  it('creates only the id, time, account, and transaction lookup indexes', async () => {
    const indexes = await FundFlowPath.collection.listIndexes().toArray();
    expect(indexes.map((index) => index.key)).toEqual(expect.arrayContaining([
      { _id: 1 }, { start_time: 1 }, { 'chain.from_account': 1 }, { 'chain.to_account': 1 }, { 'chain.txn_id': 1 },
    ]));
    expect(indexes).toHaveLength(5);
    expect((await FundFlowSummary.collection.listIndexes().toArray()).map((index) => index.key)).toEqual([{ _id: 1 }]);
  });
});
