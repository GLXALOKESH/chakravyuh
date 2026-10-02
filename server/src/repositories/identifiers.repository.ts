/**
 * Shared identifiers: devices, phones and IPs (TRD section 6).
 *
 * An identifier is one document holding an array of linked accounts rather than
 * a document per link, because the interesting question is never "who is this
 * device" but "which accounts share this device" - and that is the array itself.
 */
import { Identifier } from '../models/index.js';
import { toIdentifier, type IdentifierRow } from '../mappers/row.mapper.js';
import { insertBatches } from './bulk.repository.js';
import type { Writer } from '../interfaces/repository.interface.js';
import type { Identifier as IdentifierDomain } from '../interfaces/domain.interface.js';

export const getById = async (id: string): Promise<IdentifierDomain | null> => {
  const row = await Identifier.findById(id).lean().exec();
  return row ? toIdentifier(row as unknown as IdentifierRow) : null;
};

/**
 * Every identifier touching any of the given accounts, for the entity panel.
 *
 * `$in` over an array field is MongoDB's array-overlap operator, so this is one
 * indexed lookup rather than a query per account.
 */
export const listForAccounts = async (accountIds: string[]): Promise<IdentifierDomain[]> => {
  if (!accountIds.length) return [];
  const rows = await Identifier.find({ account_ids: { $in: accountIds } }).sort({ _id: 1 }).lean().exec();
  return (rows as unknown as IdentifierRow[]).map(toIdentifier);
};

/** Identifier ids linked to one account. */
export const listForAccount = async (accountId: string): Promise<IdentifierDomain[]> => {
  const rows = await Identifier.find({ account_ids: accountId }).sort({ _id: 1 }).lean().exec();
  return (rows as unknown as IdentifierRow[]).map(toIdentifier);
};

export const count = async (): Promise<number> => Identifier.countDocuments({}).exec();

export const insertMany = async (
  rows: { id: string; type: string; account_ids: string[] }[],
  tx?: Writer,
): Promise<void> => {
  await insertBatches(
    Identifier,
    rows.map((i) => ({ _id: i.id, type: i.type, account_ids: i.account_ids ?? [] })),
    tx,
  );
};