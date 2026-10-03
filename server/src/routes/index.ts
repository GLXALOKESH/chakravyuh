/**
 * Route tables.
 *
 * Every table is thin: validate the request into a DTO, hand it to a controller.
 * No business logic and no query building lives here, which is what makes the
 * layer easy to read as a list of the API surface.
 */
import { Router } from 'express';
import { validateDto } from '../middlewares/validate.middleware.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import {
  EvidenceBodyDto,
  FreezeBodyDto,
  PipelineRunBodyDto,
  ReplayStartBodyDto,
  ResourceIdDto,
  TaintQueryDto,
  TransactionPageQueryDto,
} from '../DTOClasses/index.js';
import * as rings from '../controllers/rings.controller.js';
import * as accounts from '../controllers/accounts.controller.js';
import * as alerts from '../controllers/alerts.controller.js';
import * as metrics from '../controllers/metrics.controller.js';
import * as evidence from '../controllers/evidence.controller.js';
import { listTransactions } from '../controllers/transactions.controller.js';
import { replayRoutes } from '../controllers/replay.controller.js';
import { pipelineRoutes } from '../controllers/pipeline.controller.js';
import type { ReplayEngine } from '../services/replay.service.js';

export const alertsRouter = Router();
export const ringsRouter = Router();
export const accountsRouter = Router();
export const metricsRouter = Router();
export const evidenceRouter = Router();
export const transactionsRouter = Router();

/** :id is validated the same way for every ring subroute. */
const resourceId = validateDto(ResourceIdDto, { from: 'params', target: 'resourceId' });
const ringId = [resourceId];

alertsRouter.get('/alerts', asyncHandler(alerts.listAlerts));

ringsRouter.get('/rings', asyncHandler(rings.listRings));
ringsRouter.get('/rings/:id', ringId, asyncHandler(rings.getRing));
ringsRouter.get(
  '/rings/:id/taint',
  ringId,
  validateDto(TaintQueryDto, { from: 'query', target: 'queryDto' }),
  asyncHandler(rings.getTaint),
);
ringsRouter.post(
  '/rings/:id/freeze',
  ringId,
  validateDto(FreezeBodyDto, { from: 'body', target: 'bodyDto' }),
  asyncHandler(rings.postFreeze),
);
ringsRouter.get('/rings/:id/recruits', ringId, asyncHandler(rings.getRecruits));
ringsRouter.get('/rings/:id/geo', ringId, asyncHandler(rings.getGeo));

accountsRouter.get('/accounts/:id', ringId, asyncHandler(accounts.getAccount));

metricsRouter.get('/metrics', asyncHandler(metrics.getMetrics));

// Paginated ledger. Registered before evidenceRouter only for readability; the
// paths cannot collide because this one is a static /transactions.
transactionsRouter.get(
  '/transactions',
  validateDto(TransactionPageQueryDto, { from: 'query', target: 'queryDto' }),
  asyncHandler(listTransactions),
);

evidenceRouter.post(
  '/rings/:id/evidence',
  ringId,
  validateDto(EvidenceBodyDto, { from: 'body', target: 'bodyDto' }),
  asyncHandler(evidence.postEvidence),
);

/** Replay is bound to one engine instance, shared with the socket layer. */
export const replayRouter = (engine: ReplayEngine): Router => {
  const router = Router();
  const controller = replayRoutes(engine);
  router.post('/replay/start', validateDto(ReplayStartBodyDto, { from: 'body', target: 'bodyDto' }), asyncHandler(controller.start));
  router.post('/replay/stop', asyncHandler(controller.stop));
  router.get('/replay/state', asyncHandler(controller.state));
  return router;
};

/**
 * TRD section 7.10. Triggers the Python pipeline and reseeds, so one call takes
 * the data from "files changed on disk" to "serving".
 */
export const pipelineRouter = (): Router => {
  const router = Router();
  const controller = pipelineRoutes();
  router.post(
    '/pipeline/run',
    validateDto(PipelineRunBodyDto, { from: 'body', target: 'bodyDto' }),
    asyncHandler(controller.run),
  );
  return router;
};
