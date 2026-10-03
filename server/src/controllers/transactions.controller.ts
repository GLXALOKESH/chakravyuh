/**
 * GET /transactions: a page of the ledger.
 *
 * The dashboard asked not to be handed every transaction at once. The pipeline
 * writes several thousand rows and the frontend renders a slice, so this is
 * offset pagination with the page numbers needed to render a pager.
 *
 * Response shape is the TRD section 8 convention used by every other list
 * route: the array is the payload and the counts sit alongside it. A wrapper
 * object would have been the alternative, but it would make this the only list
 * on the API shaped differently from the others.
 */
import type { Request, Response } from 'express';
import * as transactions from '../repositories/transactions.repository.js';
import type { TransactionPageQueryDto } from '../DTOClasses/index.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

export const listTransactions = async (req: Request, res: Response): Promise<void> => {
  const query = ((req as unknown as Record<string, unknown>).queryDto ?? {}) as TransactionPageQueryDto;

  const requestedPage = Math.max(1, query.page ?? 1);
  const limit = Math.min(Math.max(1, query.limit ?? DEFAULT_LIMIT), MAX_LIMIT);

  const { rows, total, pages } = await transactions.listPage(requestedPage, limit);

  // Asking for page 400 of a 40-page list should show the last page, not an
  // empty array that looks like missing data.
  if (rows.length === 0 && requestedPage > 1 && pages > 0) {
    const last = await transactions.listPage(pages, limit);
    res.json({ rows: last.rows, total: last.total, page: pages, pages: last.pages });
    return;
  }

  res.json({ rows, total, page: requestedPage, pages });
};