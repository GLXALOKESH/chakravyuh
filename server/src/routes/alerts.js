/** GET /alerts (TRD section 8). */
import { Router } from 'express';
import { handler } from '../lib/serialize.js';
import * as alerts from '../models/alerts.js';

const router = Router();

router.get(
  '/alerts',
  handler(async (_req, res) => {
    res.json(await alerts.listWithRingSummary());
  }),
);

export default router;