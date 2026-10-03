/** Persistence for outputs/fund_flows.json; all writes use the seed's session. */
import { FundFlowPath, FundFlowSummary, FUND_FLOW_SUMMARY_ID } from '../models/index.js';
import { insertBatches } from './bulk.repository.js';
import type { FundFlowPath as PathWrite, FundFlowSummary as SummaryWrite } from '../interfaces/fund_flow.interface.js';
import type { Writer } from '../interfaces/repository.interface.js';

export const insertMany = async (paths: PathWrite[], tx?: Writer): Promise<void> => {
  await insertBatches(
    FundFlowPath,
    paths.map((path) => ({
      _id: path.path_id,
      hops: path.hops,
      start_time: new Date(path.start_time),
      end_time: new Date(path.end_time),
      duration_minutes: path.duration_minutes,
      initial_amount_paise: path.initial_amount_paise,
      final_amount_paise: path.final_amount_paise,
      amount_decay_pct: path.amount_decay_pct,
      chain: path.chain.map((step) => ({
        step: step.step,
        from_account: step.from_account,
        to_account: step.to_account,
        txn_id: step.txn_id,
        timestamp: new Date(step.timestamp),
        amount_paise: step.amount_paise,
        latency_from_prev_min: step.latency_from_prev_min,
      })),
    })),
    tx,
  );
};

/** One summary for the current seed, including when the artifact has no paths. */
export const setSummary = async (profile: string, summary: SummaryWrite, tx?: Writer): Promise<void> => {
  const doc = { _id: FUND_FLOW_SUMMARY_ID, profile, summary };
  await FundFlowSummary.validate(doc);
  await FundFlowSummary.findOneAndUpdate(
    { _id: FUND_FLOW_SUMMARY_ID },
    { $set: { profile, summary } },
    { upsert: true, returnDocument: 'after', runValidators: true, session: tx },
  ).exec();
};
