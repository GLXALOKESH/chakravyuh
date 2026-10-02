/**
 * rings (TRD section 6).
 *
 * A ring is a small, self-contained document: its members, the money edges
 * between them, the identifiers they share, and the cached Python responses for
 * taint and freeze. Nothing here needs a second lookup, which is why this model
 * keeps whole sub-arrays instead of normalising them out into edge documents.
 *
 * default_taint and default_freeze are the cached responses GET /rings/:id/taint
 * and POST /rings/:id/freeze serve when the ML service is unreachable
 * (TRD section 3). They are the fallback, not a second source of truth: when
 * Python answers, the live response wins.
 */
import mongoose, { Schema } from 'mongoose';
import type { InferSchemaType } from 'mongoose';
import { collection } from './common.js';

const edgeSchema = new Schema(
  {
    from: { type: String, required: true },
    to: { type: String, required: true },
    amount: { type: Number, default: 0 },
    count: { type: Number, default: 0 },
  },
  { _id: false },
);

const identityLinkSchema = new Schema(
  {
    identifier: { type: String, required: true },
    account_ids: { type: [String], default: [] },
  },
  { _id: false },
);

const ringSchema = new Schema(
  {
    _id: { type: String, required: true },
    member_ids: { type: [String], default: [] },
    edges: { type: [edgeSchema], default: [] },
    identity_links: { type: [identityLinkSchema], default: [] },
    volume: { type: Number, default: 0 },
    risk: { type: Number, default: 0 },
    geo_spread_km: { type: Number, default: 0 },
    victim_txn_ids: { type: [String], default: [] },
    // Free-form: whatever taint.py and freeze.py returned. Mixed so a change in
    // either payload does not need a schema migration, which MongoDB has no
    // concept of anyway.
    default_taint: { type: Schema.Types.Mixed, default: null },
    default_freeze: { type: Schema.Types.Mixed, default: null },
  },
  collection('rings'),
);

export type RingDoc = InferSchemaType<typeof ringSchema>;

delete mongoose.models.Ring;
export const Ring = mongoose.model('Ring', ringSchema);