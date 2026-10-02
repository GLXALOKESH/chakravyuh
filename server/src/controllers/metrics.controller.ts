/** GET /metrics (TRD section 8): the V1 against V2 table for the results slide. */
import type { Request, Response } from 'express';
import * as metrics from '../repositories/metrics.repository.js';

export const getMetrics = async (_req: Request, res: Response): Promise<void> => {
  res.json(await metrics.get());
};
