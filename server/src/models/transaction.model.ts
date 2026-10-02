/**
 * transactions (TRD section 6).
 *
 * `from` and `to` are the contract's own field names, not SQL keywords worked
 * around. The CASH sentinel is a legal `to` value here precisely because there
 * are no foreign keys: no account document has to exist for a cash-out to be
 * recorded, and none is invented.
 *
 * `is_fraud` is ground truth. TRD section 6 says it is never sent to the
 * dashboard, and this schema keeps it away from every read: the domain
 * Transaction type has no field for it, so the mapper cannot leak it, and every
 * read below names its columns explicitly rather than reading the document
 * whole.
 *
 * `channel` is validated against the four values of section 6. This is where
 * the enum the relational schema enforced in the database now lives, and
 * loadProfile relies on it: a bad channel fails the write instead of being
 * silently stored and reaching the dashboard as an unknown channel.
 */
import mongoose, { Schema } from 'mongoose';
import type { InferSchemaType } from 'mongoose';
import { CHANNELS } from '../constants/index.js';
import { collection, geoPointSchema } from './common.js';

const transactionSchema = new Schema(
  {
    _id: { type: String, required: true },
    from: { type: String, required: true },
    to: { type: String, required: true },
    amount: { type: Number, required: true },
    ts: { type: Date, required: true },
    channel: { type: String, required: true, enum: [...CHANNELS] },
    // { city, lat, lng } on ATM rows, null otherwise (TRD section 6).
    location: { type: geoPointSchema, default: null },
    is_fraud: { type: Boolean, default: false },
  },
  collection('transactions'),
);

// The replay engine reads every transaction ordered by ts with _id as the
// tiebreak, so that pair is the one index the demo cannot run without.
transactionSchema.index({ ts: 1, _id: 1 });
// The map tab asks for ATM withdrawals by a ring's member list, filtered on
// from and already ordered by ts.
transactionSchema.index({ from: 1, ts: 1 });
// The entity panel's recent activity, per side.
transactionSchema.index({ to: 1, ts: -1 });

export type TransactionDoc = InferSchemaType<typeof transactionSchema>;

delete mongoose.models.Transaction;
export const Transaction = mongoose.model('Transaction', transactionSchema);