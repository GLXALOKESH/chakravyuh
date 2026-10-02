/**
 * alerts (TRD section 6).
 *
 * ring_id is a plain string, not a reference. An alert can outlive the ring it
 * points at, and with no foreign keys the dangling case is representable
 * without a cascade rule; the alert list resolves the ring separately and shows
 * a null risk when it is gone.
 *
 * fired_at is precomputed by the pipeline as the time of the ring's third
 * member-to-member transfer (TRD section 9). The replay engine emits an alert
 * when its clock passes this value.
 */
import mongoose, { Schema } from 'mongoose';
import type { InferSchemaType } from 'mongoose';
import { collection } from './common.js';

const alertSchema = new Schema(
  {
    _id: { type: String, required: true },
    ring_id: { type: String, default: null },
    fired_at: { type: Date, default: null },
    reason: { type: String, default: null },
  },
  collection('alerts'),
);

// GET /alerts is newest first, the replay engine wants oldest first. One index
// serves the descending read; the ascending one is the same scan reversed.
alertSchema.index({ fired_at: -1, _id: 1 });
alertSchema.index({ fired_at: 1, _id: 1 });

export type AlertDoc = InferSchemaType<typeof alertSchema>;

delete mongoose.models.Alert;
export const Alert = mongoose.model('Alert', alertSchema);