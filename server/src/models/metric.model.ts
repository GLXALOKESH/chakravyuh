/**
 * metrics - TRD section 6, "metrics (single document)", and the seed_meta
 * document that records what was loaded.
 *
 * Both collections hold exactly one document, and both name it through _id
 * rather than through a synthetic key column. That is what "single document"
 * means in a document store: the id is the handle, and a findOneAndUpdate with
 * upsert is the whole read-modify-write.
 *
 * METRICS_ID is not a value anything else depends on; it just has to be stable.
 */
import mongoose, { Schema } from 'mongoose';
import type { InferSchemaType } from 'mongoose';
import { collection } from './common.js';

/** The _id of the one metrics document. */
export const METRICS_ID = 'main';

/** The _id of the one seed_meta document. */
export const SEED_META_ID = 'last_seed';

const metricSchema = new Schema(
  {
    _id: { type: String, required: true },
    // Each row is one model's scores. Mixed because MetricRow is open: section 6
    // names model, pr_auc, ring_recall and pattern_d_recall, and pipeline.py is
    // free to add a column.
    rows: { type: Schema.Types.Mixed, default: () => ([]) },
    note: { type: String, default: null },
  },
  collection('metrics'),
);

const seedMetaSchema = new Schema(
  {
    _id: { type: String, required: true },
    value: { type: Schema.Types.Mixed, required: true },
  },
  collection('seed_meta'),
);

export type MetricDoc = InferSchemaType<typeof metricSchema>;
export type SeedMetaDoc = InferSchemaType<typeof seedMetaSchema>;

delete mongoose.models.Metric;
delete mongoose.models.SeedMeta;
export const Metric = mongoose.model('Metric', metricSchema);
export const SeedMeta = mongoose.model('SeedMeta', seedMetaSchema);