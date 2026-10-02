/**
 * Ring routes (TRD section 8).
 *
 *   GET  /rings/:id             ring with members, roles, edges, identity links
 *   GET  /rings/:id/taint       tainted amount per account and Sankey links
 *   POST /rings/:id/freeze      accounts to freeze and flow stopped
 *   GET  /rings/:id/recruits    likely next recruits
 *   GET  /rings/:id/geo         home branches and cash-out points (F18, P2)
 *
 * Taint and freeze are the two routes that may call Python (TRD section 3).
 * Both fall back to the ring's cached default with "cached": true.
 */
import { Router } from 'express';
import { handler, notFound, badRequest, idList, iso } from '../lib/serialize.js';
import * as rings from '../models/rings.js';
import * as accounts from '../models/accounts.js';
import * as identifiers from '../models/identifiers.js';
import * as transactions from '../models/transactions.js';
import * as recruitsModel from '../models/recruits.js';
import * as ml from '../mlClient.js';

const router = Router();

/** Loads the ring or throws 404. Every subroute needs it. */
async function requireRing(id) {
  const ring = await rings.getById(id);
  if (!ring) throw notFound(`no ring ${id}`);
  return ring;
}

/** GET /rings/:id */
router.get(
  '/rings/:id',
  handler(async (req, res) => {
    const ring = await requireRing(req.params.id);

    const members = await accounts.graphNodesForRing(ring.id);
    const identifierRows = await identifiers.listForAccounts(ring.member_ids);

    const nodes = [
      ...members.map((m) => ({ id: m.id, type: 'account', role: m.role ?? 'member', risk: m.risk_v2 ?? 0 })),
      ...identifierRows.map((i) => ({ id: i.id, type: i.type })),
    ];

    const edges = [
      ...ring.edges.map((e) => ({ source: e.from, target: e.to, kind: 'txn', amount: e.amount, count: e.count ?? 1 })),
      // One identity edge per member sharing an identifier, so the graph shows
      // the link that actually ties the ring together.
      ...ring.identity_links.flatMap((link) =>
        (link.account_ids ?? []).map((accountId) => ({ source: link.identifier, target: accountId, kind: 'identity' })),
      ),
    ];

    res.json({ id: ring.id, risk: ring.risk, volume: ring.volume, nodes, edges, victim_txn_ids: ring.victim_txn_ids });
  }),
);

/**
 * GET /rings/:id/taint?txn=&as_of=
 *
 * `txn` defaults to the ring's first victim transaction and `as_of` is passed
 * through to Python, which decides the cut-off. Without a parameter the cached
 * default already carries its own as_of.
 */
router.get(
  '/rings/:id/taint',
  handler(async (req, res) => {
    const ring = await requireRing(req.params.id);
    const victimTxnId = req.query.txn ?? ring.victim_txn_ids[0] ?? null;
    const asOf = req.query.as_of ?? null;

    const { payload, error } = await ml.taint(
      { ring_id: ring.id, victim_txn_id: victimTxnId, as_of: asOf },
      ring.default_taint,
    );
    if (error) req.log?.warn?.(error);

    // Guard the contract even if Python misbehaves: never emit a null payload.
    // as_of goes through iso() because the cached default arrives from jsonb
    // with the milliseconds the generator wrote, and the contract in TRD
    // section 8 shows second precision.
    res.json({
      victim_amount: payload.victim_amount ?? 0,
      as_of: iso(payload.as_of) ?? iso(asOf),
      cached: Boolean(payload.cached),
      accounts: payload.accounts ?? [],
      lost_to_cash: payload.lost_to_cash ?? 0,
      links: payload.links ?? [],
    });
  }),
);

/**
 * POST /rings/:id/freeze with body { k, exclude, txn, as_of }.
 *
 * TRD section 7.7: excluding an account must never return it, so the
 * recommendation is filtered after Python answers as well as before.
 */
router.post(
  '/rings/:id/freeze',
  handler(async (req, res) => {
    const ring = await requireRing(req.params.id);
    const body = req.body ?? {};

    const k = body.k === undefined ? 3 : Number(body.k);
    if (!Number.isInteger(k) || k < 0 || k > 10) throw badRequest('k must be an integer between 0 and 10');

    const exclude = idList(body.exclude);
    const victimTxnId = body.txn ?? ring.victim_txn_ids[0] ?? null;
    const asOf = body.as_of ?? null;

    const { payload, error } = await ml.freeze(
      { ring_id: ring.id, victim_txn_id: victimTxnId, as_of: asOf, k, exclude },
      ring.default_freeze,
    );
    if (error) req.log?.warn?.(error);

    const freeze = (payload.freeze ?? []).filter((id) => !exclude.includes(id)).slice(0, k);

    let atRiskBefore = payload.at_risk_before ?? 0;
    let secured = payload.secured ?? 0;
    let pctStopped = payload.pct_stopped ?? 0;

    // On the cached path Python cannot re-optimise for an excluded account, so
    // the numbers would still describe the un-excluded set. Recompute them from
    // the ring's own per-account taint so unticking an account in the dashboard
    // visibly lowers the percentage, which is the whole point of demo step 6.
    if (payload.cached && ring.default_taint?.accounts?.length) {
      const taintedBy = new Map(ring.default_taint.accounts.map((a) => [a.id, a.tainted ?? 0]));
      atRiskBefore = ring.default_taint.accounts.reduce((s, a) => s + (a.tainted ?? 0), 0);
      secured = freeze.reduce((s, id) => s + (taintedBy.get(id) ?? 0), 0);
      pctStopped = atRiskBefore ? Number((secured / atRiskBefore).toFixed(3)) : 0;
    }

    res.json({
      freeze,
      at_risk_before: atRiskBefore,
      secured,
      pct_stopped: pctStopped,
      cached: Boolean(payload.cached),
    });
  }),
);

/** GET /rings/:id/recruits, served from the database so it never needs Python. */
router.get(
  '/rings/:id/recruits',
  handler(async (req, res) => {
    await requireRing(req.params.id);
    res.json(await recruitsModel.listForRing(req.params.id));
  }),
);

/**
 * GET /rings/:id/geo (TRD section 11).
 *
 * Served straight from the database; it does not call Python.
 */
router.get(
  '/rings/:id/geo',
  handler(async (req, res) => {
    const ring = await requireRing(req.params.id);

    const [members, cashouts] = await Promise.all([
      accounts.listByRing(ring.id),
      transactions.cashoutsForRing(ring.id),
    ]);

    const homes = members
      .filter((a) => a.home?.city)
      .map((a) => ({ account_id: a.id, city: a.home.city, lat: a.home.lat, lng: a.home.lng }));

    // cashoutsForRing returns raw rows, so ts is normalised here to match the
    // second-precision timestamps every other route emits.
    const points = cashouts.map((c) => ({
      txn_id: c.id,
      account_id: c.from_account,
      city: c.location.city,
      lat: c.location.lat,
      lng: c.location.lng,
      amount: c.amount,
      ts: iso(c.ts),
    }));

    res.json({
      spread_km: ring.geo_spread_km ?? 0,
      cities: new Set(points.map((p) => p.city)).size,
      homes,
      cashouts: points,
    });
  }),
);

/**
 * Rings overview, used by the dashboard graph before a case is opened.
 * Not in the TRD contract table, so it is kept clearly separate from /rings/:id.
 */
router.get(
  '/rings',
  handler(async (_req, res) => {
    const summaries = await rings.listSummaries();
    res.json(
      summaries.map((r) => ({ id: r.id, risk: r.risk, volume: r.volume, members: Number(r.members ?? 0) })),
    );
  }),
);

export default router;