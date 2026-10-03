/**
 * Express app assembly.
 *
 * Kept separate from bin/server.ts so tests can mount the app on an ephemeral
 * port without opening a socket or a replay timer.
 */
import express, { type Express } from 'express';
import { config } from './configs/env.js';
import { describeDatabase } from './configs/mongoose.js';
import { JSON_BODY_LIMIT } from './constants/index.js';
import { errorHandler, notFoundHandler } from './middlewares/error.middleware.js';
import { ReplayEngine } from './services/replay.service.js';
import {
  accountsRouter,
  alertsRouter,
  evidenceRouter,
  metricsRouter,
  pipelineRouter,
  replayRouter,
  ringsRouter,
  transactionsRouter,
} from './routes/index.js';
import mocksRouter from './mocks/mocks.routes.js';

/** The real API. Replaced wholesale by the mock router when USE_MOCKS is on. */
const apiRouter = (engine: ReplayEngine) => {
  const router = express.Router();
  router.use(alertsRouter);
  router.use(ringsRouter);
  router.use(accountsRouter);
  router.use(metricsRouter);
  router.use(evidenceRouter);
  router.use(replayRouter(engine));
  router.use(pipelineRouter());
  router.use(transactionsRouter);
  return router;
};

export interface CreateAppOptions {
  /** Shared with the Socket.IO layer in bin/server.ts. */
  engine?: ReplayEngine;
}

export const createApp = ({ engine }: CreateAppOptions = {}): Express => {
  const app = express();
  const replayEngine = engine ?? new ReplayEngine({ emit: () => {} });

  // Base64 graph PNGs make request bodies large, so the JSON limit is raised
  // above the 100kb default (TRD section 9 sends cy.png() in the body).
  app.use(express.json({ limit: JSON_BODY_LIMIT }));

  app.get('/health', (_req, res) => {
    res.json({
      ok: true,
      database: describeDatabase(),
      mocks: config.useMocks,
      ml_url: config.mlUrl,
      replay: replayEngine.state(),
    });
  });

  app.use('/api', config.useMocks ? mocksRouter : apiRouter(replayEngine));

  // 404 for anything unmatched, so a typo in a route name is obvious and every
  // error body has the same shape (TRD section 9).
  app.use('/api', notFoundHandler);
  app.use(notFoundHandler);
  app.use(errorHandler);

  // bin/server.ts reads this to attach the engine to the Socket.IO layer.
  app.locals.replayEngine = replayEngine;
  return app;
};

export default createApp;
