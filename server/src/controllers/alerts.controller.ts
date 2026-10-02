/** GET /alerts (TRD section 8). */
import type { Request, Response } from 'express';
import * as alerts from '../repositories/alerts.repository.js';

export const listAlerts = async (_req: Request, res: Response): Promise<void> => {
  res.json(await alerts.listWithRingSummary());
};
