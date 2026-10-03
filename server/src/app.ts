/**
 * Express app assembly.
 *
 * Kept separate from bin/server.ts so tests can mount the app on an ephemeral
 * port without opening a socket or a replay timer.
 */
import express, { type Express } from 'express';
import { config, hasDatabase } from './configs/env.js';
import { describeDatabase } from './configs/mongoose.js';
import { JSON_BODY_LIMIT } from './constants/index.js';
import { errorHandler, notFoundHandler } from './middlewares/error.middleware.js';
import { ReplayEngine } from './services/replay.service.js';
import { StreamService } from './services/stream.service.js';
import { liveRouter } from './controllers/live.controller.js';
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
  /** Live mode, shared with the Socket.IO layer the same way. */
  stream?: StreamService;
}

/** STREAM_ONLY with no database: live mode works, the stored-data routes cannot. */
export const isStreamOnly = (): boolean => config.stream.only && !hasDatabase() && !config.useMocks;

export const createApp = ({ engine, stream }: CreateAppOptions = {}): Express => {
  const app = express();
  const replayEngine = engine ?? new ReplayEngine({ emit: () => {} });
  const streamService = stream ?? new StreamService({ emit: () => {} });
  const streamOnly = isStreamOnly();

  // CORS, as docs/API_FOR_FRONTEND.md promises: the dashboard runs on its own
  // port (Next.js on 3000) and calls this server directly. Socket.IO has its
  // own setting in bin/server.ts; this covers the REST routes.
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin ?? '*');
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

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
      stream: streamService.state(),
      stream_only: streamOnly,
    });
  });

  // Live mode needs no database, so it is mounted in every mode.
  app.use('/api', liveRouter(streamService));
  if (streamOnly) {
    app.use('/api', (req, res) => {
      res.status(503).json({ error: `no database: the server was started with STREAM_ONLY, so only live mode is available (${req.method} ${req.originalUrl})` });
    });
  }
  app.use('/api', config.useMocks ? mocksRouter : apiRouter(replayEngine));

  // 404 for anything unmatched, so a typo in a route name is obvious and every
  // error body has the same shape (TRD section 9).
  app.use('/api', notFoundHandler);
  app.use(notFoundHandler);
  app.use(errorHandler);

  // bin/server.ts reads this to attach the engine to the Socket.IO layer.
  app.locals.replayEngine = replayEngine;
  app.locals.streamService = streamService;
  return app;
};

export default createApp;
