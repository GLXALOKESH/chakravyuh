/**
 * The model registry.
 *
 * Importing this module is what defines every schema with Mongoose. Repositories
 * import models from here rather than from the individual files so that a
 * collection can be renamed or a schema split across two files without touching
 * the code that reads it.
 *
 * Also exports the order the seeder clears them in and the list used to build
 * indexes, so neither has to be kept in step by hand.
 */
import { Account } from './account.model.js';
import { Alert } from './alert.model.js';
import { FundFlowPath, FundFlowSummary } from './fund_flow.model.js';
import { Identifier } from './identifier.model.js';
import { Metric, SeedMeta } from './metric.model.js';
import { Recruit } from './recruit.model.js';
import { Ring } from './ring.model.js';
import { Transaction } from './transaction.model.js';

export { Account } from './account.model.js';
export { Alert } from './alert.model.js';
export { FundFlowPath, FundFlowSummary, FUND_FLOW_SUMMARY_ID } from './fund_flow.model.js';
export { Identifier } from './identifier.model.js';
export { Metric, SeedMeta, METRICS_ID, SEED_META_ID } from './metric.model.js';
export { Recruit } from './recruit.model.js';
export { Ring } from './ring.model.js';
export { Transaction } from './transaction.model.js';
export type { AccountDoc } from './account.model.js';
export type { AlertDoc } from './alert.model.js';
export type { FundFlowPathDoc, FundFlowSummaryDoc } from './fund_flow.model.js';
export type { IdentifierDoc } from './identifier.model.js';
export type { MetricDoc, SeedMetaDoc } from './metric.model.js';
export type { RecruitDoc } from './recruit.model.js';
export type { RingDoc } from './ring.model.js';
export type { TransactionDoc } from './transaction.model.js';

/**
 * Every collection, in the order the seeder clears them.
 *
 * Rings come before accounts because accounts.ring_id points at them, and
 * accounts before transactions for the same reason. Nothing enforces that -
 * MongoDB has no foreign keys to enforce - so the order is a convention, and it
 * is written down here once rather than restated at each call site.
 */
export const ALL_MODELS = [SeedMeta, FundFlowSummary, FundFlowPath, Metric, Recruit, Alert, Transaction, Identifier, Account, Ring] as const;
