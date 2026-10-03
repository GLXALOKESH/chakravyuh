/**
 * Live mode's REST routes (docs/STREAMING.md).
 *
 *   POST /stream/start          a new run: { seed?, rate?, external? }
 *   POST /stream/stop
 *   POST /stream/clear         stop the run if it is going and throw its data away
 *   GET  /stream/state
 *   POST /stream/ingest         generator lines, for a generator the server did not start
 *
 *   GET  /live/snapshot         everything a dashboard needs to draw the run so far
 *   GET  /live/alerts
 *   GET  /live/rings/:id        and /taint, /freeze, /recruits, /geo
 *   GET  /live/accounts/:id
 *   GET  /live/metrics          the predictor scored against the generator's ground truth
 *   GET  /live/transactions     the run's ledger, paged like /transactions
 *
 * The /live routes answer in the same shapes as the stored-data routes,
 * through the same mappers, so the ring page works on a live ring unchanged.
 * Taint and freeze still go to Python, which reads the live run's ledger when
 * it is given the run id.
 */
import { Router, type Request, type Response } from 'express';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { validateDto } from '../middlewares/validate.middleware.js';
import { AppError, NotFoundError } from '../exceptions/index.js';
import { config } from '../configs/env.js';
import { round3 } from '../utilities/serialize.util.js';
import * as ml from '../services/ml.service.js';
import type { StreamService } from '../services/stream.service.js';
import {
  FreezeBodyDto,
  ResourceIdDto,
  StreamIngestBodyDto,
  StreamStartBodyDto,
  TaintQueryDto,
  TransactionPageQueryDto,
} from '../DTOClasses/index.js';

const dto = <T>(req: Request, key: string): T => (req as unknown as Record<string, unknown>)[key] as T;
const resourceId = validateDto(ResourceIdDto, { from: 'params', target: 'resourceId' });

class ForbiddenError extends AppError {
  constructor(message: string) {
    super(403, message);
  }
}

export const liveRouter = (stream: StreamService): Router => {
  const router = Router();
  const store = stream.store;

  const requireRing = (id: string) => {
    const ring = store.ring(id);
    if (!ring) throw new NotFoundError(`no live ring ${id}`);
    return ring;
  };

  // ---- controls ------------------------------------------------------------

  router.post(
    '/stream/start',
    validateDto(StreamStartBodyDto, { from: 'body', target: 'bodyDto' }),
    asyncHandler(async (req: Request, res: Response) => {
      const body = dto<StreamStartBodyDto>(req, 'bodyDto') ?? {};
      res.json(stream.start({ seed: body.seed, rate: body.rate, external: body.external }));
    }),
  );
  router.post(
    '/stream/stop',
    asyncHandler(async (_req: Request, res: Response) => {
      res.json(stream.stop());
    }),
  );
  router.post(
    '/stream/clear',
    asyncHandler(async (_req: Request, res: Response) => {
      res.json(stream.clear());
    }),
  );
  router.get(
    '/stream/state',
    asyncHandler(async (_req: Request, res: Response) => {
      res.json(stream.state());
    }),
  );
  router.post(
    '/stream/ingest',
    validateDto(StreamIngestBodyDto, { from: 'body', target: 'bodyDto' }),
    asyncHandler(async (req: Request, res: Response) => {
      const token = config.stream.ingestToken;
      if (!token) throw new ForbiddenError('ingest is closed: set STREAM_INGEST_TOKEN on the server to open it');
      if (req.get('authorization') !== `Bearer ${token}`) throw new ForbiddenError('wrong or missing ingest token');
      if (!stream.isRunning) throw new AppError(409, 'no live run: POST /api/stream/start with {"external":true} first');
      res.json(stream.ingest(dto<StreamIngestBodyDto>(req, 'bodyDto').events));
    }),
  );

  // ---- the run's data --------------------------------------------------------------

  router.get(
    '/live/snapshot',
    asyncHandler(async (_req: Request, res: Response) => {
      res.json(stream.snapshot());
    }),
  );
  router.get(
    '/live/alerts',
    asyncHandler(async (_req: Request, res: Response) => {
      res.json(store.alerts);
    }),
  );
  router.get(
    '/live/metrics',
    asyncHandler(async (_req: Request, res: Response) => {
      res.json(store.liveMetrics());
    }),
  );
  router.get(
    '/live/rings',
    asyncHandler(async (_req: Request, res: Response) => {
      res.json([...store.rings.values()].map((r) => ({ id: r.id, risk: r.risk, volume: Math.round(r.volume_paise / 100), members: r.member_ids.length })));
    }),
  );
  router.get(
    '/live/rings/:id',
    resourceId,
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = dto<ResourceIdDto>(req, 'resourceId');
      const graph = store.ringGraph(id);
      if (!graph) throw new NotFoundError(`no live ring ${id}`);
      res.json(graph);
    }),
  );
  router.get(
    '/live/rings/:id/geo',
    resourceId,
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = dto<ResourceIdDto>(req, 'resourceId');
      const geo = store.ringGeo(id);
      if (!geo) throw new NotFoundError(`no live ring ${id}`);
      res.json(geo);
    }),
  );
  router.get(
    '/live/rings/:id/recruits',
    resourceId,
    asyncHandler(async (req: Request, res: Response) => {
      requireRing(dto<ResourceIdDto>(req, 'resourceId').id);
      // The live predictor does not score recruits yet.
      res.json([]);
    }),
  );
  router.get(
    '/live/rings/:id/taint',
    resourceId,
    validateDto(TaintQueryDto, { from: 'query', target: 'queryDto' }),
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = dto<ResourceIdDto>(req, 'resourceId');
      const query = dto<TaintQueryDto>(req, 'queryDto');
      const ring = requireRing(id);
      const request = { ring_id: id, victim_txn_id: query.txn ?? ring.victim_txn_ids[0] ?? null, as_of: query.as_of ?? null, run_id: store.runId ?? undefined };
      const { payload, cached } = await ml.taint(request, store.taintCache.get(id) ?? null);
      if (!cached) store.taintCache.set(id, payload);
      res.json({
        victim_amount: payload.victim_amount ?? 0,
        as_of: payload.as_of ?? request.as_of,
        cached: Boolean(payload.cached),
        accounts: payload.accounts ?? [],
        lost_to_cash: payload.lost_to_cash ?? 0,
        links: payload.links ?? [],
      });
    }),
  );
  router.post(
    '/live/rings/:id/freeze',
    resourceId,
    validateDto(FreezeBodyDto, { from: 'body', target: 'bodyDto' }),
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = dto<ResourceIdDto>(req, 'resourceId');
      const body = dto<FreezeBodyDto>(req, 'bodyDto');
      const ring = requireRing(id);
      const k = body.k ?? 3;
      const exclude = body.exclude ?? [];
      const request = {
        ring_id: id,
        victim_txn_id: body.txn ?? ring.victim_txn_ids[0] ?? null,
        as_of: body.as_of ?? null,
        k,
        exclude,
        run_id: store.runId ?? undefined,
      };
      const { payload, cached } = await ml.freeze(request, store.freezeCache.get(id) ?? null);
      if (!cached && exclude.length === 0) store.freezeCache.set(id, payload);
      const freeze = (payload.freeze ?? []).filter((a) => !exclude.includes(a)).slice(0, k);
      let atRisk = payload.at_risk_before ?? 0;
      let secured = payload.secured ?? 0;
      let pct = payload.pct_stopped ?? 0;
      // As on the stored-data route: on the cached path, recompute from the
      // ring's last per-account taint so unticking an account still moves the bar.
      const taint = store.taintCache.get(id);
      if (payload.cached && taint?.accounts?.length) {
        const by = new Map(taint.accounts.map((a) => [a.id, a.tainted ?? 0]));
        atRisk = taint.accounts.reduce((s, a) => s + (a.tainted ?? 0), 0);
        secured = freeze.reduce((s, a) => s + (by.get(a) ?? 0), 0);
        pct = atRisk ? round3(secured / atRisk) : 0;
      }
      res.json({ freeze, at_risk_before: atRisk, secured, pct_stopped: pct, cached: Boolean(payload.cached), nothing_at_risk: atRisk === 0 });
    }),
  );
  router.get(
    '/live/accounts/:id',
    resourceId,
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = dto<ResourceIdDto>(req, 'resourceId');
      const detail = store.accountDetail(id);
      if (!detail) throw new NotFoundError(`no account ${id} in the live run`);
      res.json(detail);
    }),
  );
  router.get(
    '/live/transactions',
    validateDto(TransactionPageQueryDto, { from: 'query', target: 'queryDto' }),
    asyncHandler(async (req: Request, res: Response) => {
      const query = dto<TransactionPageQueryDto>(req, 'queryDto') ?? {};
      const limit = Math.min(Math.max(1, query.limit ?? 50), 500);
      const shown = store.txns.filter((t) => t.from !== 'SALARY');
      const pages = Math.max(1, Math.ceil(shown.length / limit));
      const page = Math.min(Math.max(1, query.page ?? 1), pages);
      res.json({ rows: shown.slice((page - 1) * limit, page * limit).map((t) => store.clientTxn(t)), total: shown.length, page, pages });
    }),
  );

  return router;
};
