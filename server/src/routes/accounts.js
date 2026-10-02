/**
 * GET /accounts/:id (TRD section 8): the entity panel.
 *
 * Returns the account's features, role and "why flagged" signals, plus the
 * identifiers it shares and its recent activity, which is what the panel needs
 * to open without a second round trip.
 */
import { Router } from 'express';
import { handler, notFound } from '../lib/serialize.js';
import * as accounts from '../models/accounts.js';
import * as identifiers from '../models/identifiers.js';
import * as transactions from '../models/transactions.js';

const router = Router();

router.get(
  '/accounts/:id',
  handler(async (req, res) => {
    const account = await accounts.getById(req.params.id);
    if (!account) throw notFound(`no account ${req.params.id}`);

    const [linkedIdentifiers, recent] = await Promise.all([
      identifiers.listForAccount(account.id),
      transactions.recentForAccount(account.id, 10),
    ]);

    res.json({ ...account, linked_identifiers: linkedIdentifiers, recent_transactions: recent });
  }),
);

export default router;