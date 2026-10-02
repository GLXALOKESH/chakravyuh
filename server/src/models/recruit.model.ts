/**
 * recruits - not in TRD section 6, but GET /rings/:id/recruits has to be
 * answerable without Python, and section 3 allows only taint and freeze to call
 * it live. The pipeline writes this collection; the API only ever reads it.
 *
 * `_id` is the ring and account joined by a colon. A relational schema would
 * make that a composite primary key; as a document store the composite identity
 * just becomes the _id, which is also what makes a re-seed idempotent, since the
 * upsert in the write path keys on it.
 */
import mongoose, { Schema } from 'mongoose';
import type { InferSchemaType } from 'mongoose';
import { collection } from './common.js';

export const recruitId = (ringId: string, accountId: string): string => `${ringId}:${accountId}`;

const recruitSchema = new Schema(
  {
    _id: { type: String, required: true },
    ring_id: { type: String, required: true },
    account_id: { type: String, required: true },
    probability: { type: Number, default: 0 },
    reasons: { type: [String], default: [] },
  },
  collection('recruits'),
);

// One ring's recruits, highest probability first.
recruitSchema.index({ ring_id: 1, probability: -1, account_id: 1 });

export type RecruitDoc = InferSchemaType<typeof recruitSchema>;

delete mongoose.models.Recruit;
export const Recruit = mongoose.model('Recruit', recruitSchema);