/** GET /metrics (TRD section 8): the V1 against V2 table for the results slide. */
import { Router } from 'express';
import { handler } from '../lib/serialize.js';
import * as metrics from '../models/metrics.js';

const router = Router();

router.get(
  '/metrics',
  handler(async (_req, res) => {
    res.json(await metrics.get());
  }),
);

export default router;