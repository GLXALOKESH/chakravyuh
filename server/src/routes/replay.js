/**
 * Replay control (F11, TRD section 8).
 *
 * The dashboard can drive replay over REST as well as the socket, so a presenter
 * can recover with a single curl if the socket drops mid-demo.
 */
import { Router } from 'express';
import { handler, badRequest } from '../lib/serialize.js';
import { config } from '../config.js';

const router = Router();

export function replayRoutes(engine) {
  router.post(
    '/replay/start',
    handler(async (req, res) => {
      const speed = req.body?.speed ?? config.replayDefaultSpeed;
      const parsed = Number(speed);
      if (!Number.isFinite(parsed) || parsed <= 0) throw badRequest('speed must be a positive number');
      res.json(engine.start({ speed: parsed }));
    }),
  );

  router.post(
    '/replay/stop',
    handler(async (_req, res) => {
      res.json(engine.stop());
    }),
  );

  router.get(
    '/replay/state',
    handler(async (_req, res) => {
      res.json(engine.state());
    }),
  );

  return router;
}

export default replayRoutes;