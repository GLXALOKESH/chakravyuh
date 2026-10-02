/**
 * Express app assembly.
 *
 * Kept separate from index.js so tests can mount the app on an ephemeral port
 * without opening a socket or a replay timer.
 */
import express from 'express';
import { config } from './config.js';
import { getDriverName } from './db/index.js';
import { ReplayEngine } from './replay.js';
import { replayRoutes } from './routes/replay.js';
import alertsRouter from './routes/alerts.js';
import ringsRouter from './routes/rings.js';
import accountsRouter from './routes/accounts.js';
import metricsRouter from './routes/metrics.js';
import evidenceRouter from './routes/evidence.js';
import mocksRouter from './mocks/router.js';

/** The real API. Replaced wholesale by the mock router when USE_MOCKS is on. */
function apiRouter(replayEngine) {
  const router = express.Router();
  router.use(alertsRouter);
  router.use(ringsRouter);
  router.use(accountsRouter);
  router.use(metricsRouter);
  router.use(evidenceRouter);
  router.use(replayRoutes(replayEngine));
  return router;
}

/**
 * @param {object} opts
 * @param {ReplayEngine} [opts.engine] shared with the socket layer in index.js
 */
export function createApp({ engine } = {}) {
  const app = express();
  const replayEngine = engine ?? new ReplayEngine({ emit: () => {} });

  // Base64 graph PNGs make request bodies large, so the JSON limit is raised
  // above the 100kb default (TRD section 9 sends cy.png() in the body).
  app.use(express.json({ limit: '6mb' }));

  app.get('/health', (_req, res) => {
    res.json({
      ok: true,
      driver: getDriverName(),
      mocks: config.useMocks,
      ml_url: config.mlUrl,
      replay: replayEngine.state(),
    });
  });

  app.use('/api', config.useMocks ? mocksRouter : apiRouter(replayEngine));

  // 404 for anything else under /api, so a typo in a route name is obvious.
  app.use('/api', (req, res) => {
    res.status(404).json({ error: `no route ${req.method} ${req.originalUrl}` });
  });

  // TRD section 9: errors return { "error": "message" } with a 4xx or 5xx.
  app.use((err, req, res, _next) => {
    const status = err.status ?? 500;
    if (status >= 500) console.error(`${req.method} ${req.originalUrl} failed:`, err);
    res.status(status).json({ error: err.message ?? 'internal error' });
  });

  // index.js reads this to attach the engine to the Socket.IO layer.
  app.locals.replayEngine = replayEngine;
  return app;
}

export default createApp;