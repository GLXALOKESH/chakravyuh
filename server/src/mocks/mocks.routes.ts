/**
 * Contract-shaped mocks (TRD section 15).
 *
 * Committed so the dashboard can be built before ml/pipeline.py exists. Set
 * USE_MOCKS=true and every /api route is served from payloads.ts, so the
 * frontend contract is fixed and testable independently of the backend data.
 *
 * The shapes here are copied from TRD section 8. If a real response disagrees
 * with a mock, the real response is the bug and the mock is the spec to fix.
 */
import { Router } from 'express';
import * as payloads from './payloads.js';
import { round3 } from '../utilities/serialize.util.js';

/** Picks one mock item for a single-resource GET such as /rings/:id. */
const one = <T>(collection: Record<string, T>, id: string | undefined): T => {
  const key = id && id in collection ? id : Object.keys(collection)[0];
  if (key === undefined) throw new Error('mock collection is empty');
  const value = collection[key];
  if (value === undefined) throw new Error(`mock ${key} is missing`);
  return value;
};

export const mocksRouter = Router();

mocksRouter.get('/alerts', (_req, res) => res.json(payloads.alerts));
mocksRouter.get('/rings', (_req, res) => res.json(payloads.ringsSummary));
mocksRouter.get('/rings/:id', (req, res) => res.json(one(payloads.rings, req.params.id)));
mocksRouter.get('/rings/:id/taint', (req, res) =>
  res.json({ ...payloads.taint, as_of: req.query.as_of ?? payloads.taint.as_of }),
);
mocksRouter.post('/rings/:id/freeze', (req, res) => {
  const exclude = new Set<string>((req.body?.exclude as string[] | undefined) ?? []);
  const freeze = payloads.freeze.freeze.filter((id) => !exclude.has(id));
  const atRisk = payloads.freeze.at_risk_before;
  // Split the cached secured amount evenly, so excluding one account lowers the
  // percentage the same way the real route does on its cached path.
  const each = payloads.freeze.freeze.length ? payloads.freeze.secured / payloads.freeze.freeze.length : 0;
  const secured = freeze.length * each;
  res.json({
    ...payloads.freeze,
    freeze,
    secured: Math.round(secured),
    pct_stopped: atRisk ? round3(secured / atRisk) : 0,
  });
});
mocksRouter.get('/rings/:id/recruits', (_req, res) => res.json(payloads.recruits));
mocksRouter.get('/rings/:id/geo', (_req, res) => res.json(payloads.geo));
mocksRouter.get('/accounts/:id', (req, res) => res.json(one(payloads.accounts, req.params.id)));
mocksRouter.get('/metrics', (_req, res) => res.json(payloads.metrics));
mocksRouter.post('/replay/start', (_req, res) => res.json({ ok: true, mocked: true }));
mocksRouter.post('/replay/stop', (_req, res) => res.json({ ok: true, mocked: true }));
mocksRouter.get('/replay/state', (_req, res) =>
  res.json({ running: false, speed: 60, progress: 0, emitted: 0, queued: 0, pending_alerts: 0, clock: null, mocked: true }),
);
// The PDF is server-side work, so it is not mocked: the layout is server-side
// and the dashboard needs a downloadable file to wire the button against. In
// mock mode there is no ring in the database to build one from, so the route
// says so plainly rather than emitting a 200 with an empty document.
mocksRouter.post('/rings/:id/evidence', (_req, res) =>
  res.status(501).json({ error: 'evidence is not served in mock mode' }),
);

export default mocksRouter;
