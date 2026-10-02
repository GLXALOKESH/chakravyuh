/**
 * Contract-shaped mocks (TRD section 15).
 *
 * Committed so Member 2 can build the dashboard before ml/pipeline.py exists.
 * Set USE_MOCKS=true and every /api route is served from these files, so the
 * frontend contract is fixed and testable independently of the backend data.
 *
 * The shapes here are copied from TRD section 8. If a real response disagrees
 * with a mock, the real response is the bug and the mock is the spec to fix.
 */
import { Router } from 'express';
import mocks from './index.js';

const router = Router();

/** Picks one mock item for a single-resource GET such as /rings/:id. */
const one = (name, params) => {
  const value = mocks[name];
  const keys = Object.keys(value ?? {});
  const match = keys.find((k) => params?.id && k === params.id);
  if (match) return value[match];
  // Fall back to the first entry so the dashboard always has something to render.
  return Array.isArray(value) ? value[0] : value[keys[0]];
};

router.get('/alerts', (_req, res) => res.json(mocks.alerts));
router.get('/rings', (_req, res) => res.json(mocks.ringsSummary));
router.get('/rings/:id', (req, res) => res.json(one('rings', req.params)));
router.get('/rings/:id/taint', (req, res) => res.json({ ...mocks.taint, as_of: req.query.as_of ?? mocks.taint.as_of }));
router.post('/rings/:id/freeze', (req, res) => {
  const exclude = new Set(req.body?.exclude ?? []);
  const freeze = (mocks.freeze.freeze ?? []).filter((id) => !exclude.has(id));
  const atRisk = mocks.freeze.at_risk_before ?? 0;
  const each = mocks.freeze.freeze?.length ? (mocks.freeze.secured ?? 0) / mocks.freeze.freeze.length : 0;
  const secured = freeze.length * each;
  res.json({
    ...mocks.freeze,
    freeze,
    secured: Math.round(secured),
    pct_stopped: atRisk ? Number((secured / atRisk).toFixed(3)) : 0,
  });
});
router.get('/rings/:id/recruits', (_req, res) => res.json(mocks.recruits));
router.get('/rings/:id/geo', (_req, res) => res.json(mocks.geo));
router.get('/accounts/:id', (req, res) => res.json(one('accounts', req.params)));
router.get('/metrics', (_req, res) => res.json(mocks.metrics));
router.post('/replay/start', (_req, res) => res.json({ ok: true, mocked: true }));
router.post('/replay/stop', (_req, res) => res.json({ ok: true, mocked: true }));
router.get('/replay/state', (_req, res) =>
  res.json({ running: false, speed: 60, progress: 0, emitted: 0, queued: 0, pending_alerts: 0, clock: null, mocked: true }),
);
// The PDF is real even in mock mode: the document layout is server-side work
// and Member 2 needs a downloadable file to wire the button against.
router.post('/rings/:id/evidence', (_req, res) => res.status(501).json({ error: 'evidence is not served in mock mode' }));

export default router;