/**
 * identifiers (TRD section 6).
 *
 * One document holding an array of linked accounts, rather than a document per
 * link, because the question the dashboard asks is never "who owns this device"
 * but "which accounts share this device" - and that is the array itself.
 *
 * account_ids is indexed as a multikey index, which is MongoDB's ordinary index
 * over an array field. It makes the entity panel's "every identifier touching
 * this account" a single lookup instead of one query per account.
 */
import mongoose, { Schema } from 'mongoose';
import type { InferSchemaType } from 'mongoose';
import { IDENTIFIER_TYPES } from '../constants/index.js';
import { collection } from './common.js';

const identifierSchema = new Schema(
  {
    _id: { type: String, required: true },
    type: { type: String, required: true, enum: [...IDENTIFIER_TYPES] },
    account_ids: { type: [String], default: [] },
  },
  collection('identifiers'),
);

identifierSchema.index({ account_ids: 1 });
identifierSchema.index({ type: 1 });

export type IdentifierDoc = InferSchemaType<typeof identifierSchema>;

delete mongoose.models.Identifier;
export const Identifier = mongoose.model('Identifier', identifierSchema);