/**
 * Temporal fund-flow outputs, independent of rings and taint.
 *
 * Each path has its own document, keyed by the ML path_id. Only that path's
 * ordered chain is embedded. The summary describes the current seed/profile,
 * following metrics' stable singleton-id convention.
 *
 * Amounts remain integer paise. amount_decay_pct is the ML engine's nominal
 * transaction amount difference; it is stored verbatim, not interpreted as loss.
 */
import mongoose, { Schema } from 'mongoose';
import type { InferSchemaType } from 'mongoose';
import { collection } from './common.js';

export const FUND_FLOW_SUMMARY_ID = 'main';

const integer = { validator: Number.isSafeInteger, message: '{PATH} must be a safe integer' };
const finite = { validator: Number.isFinite, message: '{PATH} must be a finite number' };
const nullableFinite = {
  validator: (value: number | null) => value === null || Number.isFinite(value),
  message: '{PATH} must be a finite number or null',
};

const stepSchema = new Schema(
  {
    step: { type: Number, required: true, validate: integer },
    from_account: { type: String, required: true },
    to_account: { type: String, required: true },
    txn_id: { type: String, required: true },
    timestamp: { type: Date, required: true },
    amount_paise: { type: Number, required: true, validate: integer },
    latency_from_prev_min: { type: Number, default: null, validate: nullableFinite },
  },
  { _id: false },
);

const pathSchema = new Schema(
  {
    _id: { type: String, required: true },
    hops: { type: Number, required: true, validate: integer },
    start_time: { type: Date, required: true },
    end_time: { type: Date, required: true },
    duration_minutes: { type: Number, required: true, validate: finite },
    initial_amount_paise: { type: Number, required: true, validate: integer },
    final_amount_paise: { type: Number, required: true, validate: integer },
    amount_decay_pct: { type: Number, required: true, validate: finite },
    chain: { type: [stepSchema], required: true, default: undefined },
  },
  collection('fund_flow_paths'),
);

// _id already has MongoDB's unique index. These support time-window scans and
// finding paths containing an account or transaction; no speculative compounds.
pathSchema.index({ start_time: 1 });
pathSchema.index({ 'chain.from_account': 1 });
pathSchema.index({ 'chain.to_account': 1 });
pathSchema.index({ 'chain.txn_id': 1 });

const summarySchema = new Schema(
  {
    total_paths_identified: { type: Number, required: true, validate: integer },
    avg_hop_latency_minutes: { type: Number, required: true, validate: finite },
    fastest_path_minutes: { type: Number, default: null, validate: nullableFinite },
    truncated: { type: Boolean, required: true },
  },
  { _id: false },
);

const summaryDocumentSchema = new Schema(
  {
    _id: { type: String, required: true },
    profile: { type: String, required: true },
    summary: { type: summarySchema, required: true },
  },
  collection('fund_flow_summaries'),
);

export type FundFlowPathDoc = InferSchemaType<typeof pathSchema>;
export type FundFlowSummaryDoc = InferSchemaType<typeof summaryDocumentSchema>;

delete mongoose.models.FundFlowPath;
delete mongoose.models.FundFlowSummary;
export const FundFlowPath = mongoose.model('FundFlowPath', pathSchema);
export const FundFlowSummary = mongoose.model('FundFlowSummary', summaryDocumentSchema);
