/**
 * GET /accounts/:id (TRD section 8): the entity panel.
 *
 * Returns the account's features, role and "why flagged" signals, plus the
 * identifiers it shares and its recent activity, which is what the panel needs
 * to open without a second round trip.
 */
import type { Request, Response } from 'express';
import { NotFoundError } from '../exceptions/index.js';
import { toAccountDetail } from '../mappers/api.mapper.js';
import * as accounts from '../repositories/accounts.repository.js';
import * as identifiers from '../repositories/identifiers.repository.js';
import * as transactions from '../repositories/transactions.repository.js';
import type { ResourceIdDto } from '../DTOClasses/index.js';

/** How many recent transactions the entity panel shows. */
export const RECENT_LIMIT = 10;

export const getAccount = async (req: Request, res: Response): Promise<void> => {
  const { id } = (req as unknown as Record<string, unknown>).resourceId as ResourceIdDto;

  const account = await accounts.getById(id);
  if (!account) throw new NotFoundError(`no account ${id}`);

  const [linkedIdentifiers, recent] = await Promise.all([
    identifiers.listForAccount(account.id),
    transactions.recentForAccount(account.id, RECENT_LIMIT),
  ]);

  res.json(toAccountDetail(account, linkedIdentifiers, recent));
};
