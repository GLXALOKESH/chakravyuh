/**
 * accounts (TRD section 6).
 *
 * `role` is a free string rather than an enum, and that is deliberate for two
 * reasons that both come from the document model: MongoDB has no enum type, and
 * the closed set in TRD section 7.5 includes "cash-out", which is not a legal
 * identifier. The set is enforced in one place instead, by toAccountRole in
 * src/constants, so an unrecognised value degrades to "member" rather than
 * failing a write or reaching the dashboard as a role nobody recognises.
 *
 * `home` is null for accounts with no registered branch, which is most of them.
 */
import mongoose, { Schema } from 'mongoose';
import type { InferSchemaType } from 'mongoose';
import { collection, geoPointSchema, signalSchema } from './common.js';

const accountSchema = new Schema(
  {
    _id: { type: String, required: true },
    holder: { type: String, default: null },
    bank: { type: String, default: null },
    home: { type: geoPointSchema, default: null },
    opened_at: { type: Date, default: null },
    opening_balance: { type: Number, default: 0 },
    // Mixed, not a fixed shape: the feature list grows every time the pipeline
    // adds one, and section 7.2 currently names twenty-two.
    features: { type: Schema.Types.Mixed, default: () => ({}) },
    risk_v1: { type: Number, default: null },
    risk_v2: { type: Number, default: null },
    signals: { type: [signalSchema], default: [] },
    ring_id: { type: String, default: null },
    role: { type: String, default: null },
    role_reason: { type: String, default: null },
  },
  collection('accounts'),
);

// GET /rings/:id and the graph node projection both filter and sort by ring_id
// within a ring, which is the only account query that is not by _id.
accountSchema.index({ ring_id: 1, _id: 1 });

export type AccountDoc = InferSchemaType<typeof accountSchema>;

delete mongoose.models.Account;
export const Account = mongoose.model('Account', accountSchema);