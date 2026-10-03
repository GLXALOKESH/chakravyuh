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
import type { Request, Response } from 'express';
import { NotFoundError } from '../exceptions/index.js';
import { iso, round3 } from '../utilities/serialize.util.js';
import { toRingGeo, toRingGraph } from '../mappers/api.mapper.js';
import * as rings from '../repositories/rings.repository.js';
import * as accounts from '../repositories/accounts.repository.js';
import * as identifiers from '../repositories/identifiers.repository.js';
import * as transactions from '../repositories/transactions.repository.js';
import * as recruits from '../repositories/recruits.repository.js';
import * as ml from '../services/ml.service.js';
import type { ResourceIdDto, TaintQueryDto, FreezeBodyDto } from '../DTOClasses/index.js';
import type { Ring } from '../interfaces/domain.interface.js';

const dto = <T>(req: Request, key: string): T => (req as unknown as Record<string, unknown>)[key] as T;

/** Loads the ring or throws 404. Every subroute needs it. */
const requireRing = async (id: string): Promise<Ring> => {
  const ring = await rings.getById(id);
  if (!ring) throw new NotFoundError(`no ring ${id}`);
  return ring;
};

/** GET /rings/:id */
export const getRing = async (req: Request, res: Response): Promise<void> => {
  const { id } = dto<ResourceIdDto>(req, 'resourceId');
  const ring = await requireRing(id);

  const [members, identifierRows] = await Promise.all([
    accounts.graphNodesForRing(ring.id),
    identifiers.listForAccounts(ring.member_ids),
  ]);

  res.json(toRingGraph(ring, members, identifierRows));
};

/**
 * GET /rings/:id/taint?txn=&as_of=
 *
 * `txn` defaults to the ring's first victim transaction and `as_of` is passed
 * through to Python, which decides the cut-off. Without a parameter the cached
 * default already carries its own as_of.
 */
export const getTaint = async (req: Request, res: Response): Promise<void> => {
  const { id } = dto<ResourceIdDto>(req, 'resourceId');
  const query = dto<TaintQueryDto>(req, 'queryDto');
  const ring = await requireRing(id);

  const victimTxnId = query.txn ?? ring.victim_txn_ids[0] ?? null;
  const asOf = query.as_of ?? null;

  const { payload } = await ml.taint({ ring_id: ring.id, victim_txn_id: victimTxnId, as_of: asOf }, ring.default_taint);

  // Guard the contract even if Python misbehaves: never emit a null payload.
  // as_of goes through iso() because the cached default arrives from a jsonb
  // column with the milliseconds the generator wrote, and the contract in TRD
  // section 8 shows second precision.
  res.json({
    victim_amount: payload.victim_amount ?? 0,
    as_of: iso(payload.as_of) ?? iso(asOf),
    cached: Boolean(payload.cached),
    accounts: payload.accounts ?? [],
    lost_to_cash: payload.lost_to_cash ?? 0,
    links: payload.links ?? [],
  });
};

/**
 * POST /rings/:id/freeze with body { k, exclude, txn, as_of }.
 *
 * TRD section 7.7: excluding an account must never return it, so the
 * recommendation is filtered after Python answers as well as before.
 */
export const postFreeze = async (req: Request, res: Response): Promise<void> => {
  const { id } = dto<ResourceIdDto>(req, 'resourceId');
  const body = dto<FreezeBodyDto>(req, 'bodyDto');
  const ring = await requireRing(id);

  const k = body.k ?? 3;
  const exclude = body.exclude ?? [];
  const victimTxnId = body.txn ?? ring.victim_txn_ids[0] ?? null;
  const asOf = body.as_of ?? null;

  const { payload } = await ml.freeze(
    { ring_id: ring.id, victim_txn_id: victimTxnId, as_of: asOf, k, exclude },
    ring.default_freeze,
  );

  const freeze = (payload.freeze ?? []).filter((accountId) => !exclude.includes(accountId)).slice(0, k);

  let atRiskBefore = payload.at_risk_before ?? 0;
  let secured = payload.secured ?? 0;
  let pctStopped = payload.pct_stopped ?? 0;

  // On the cached path Python cannot re-optimise for an excluded account, so
  // the numbers would still describe the un-excluded set. Recompute them from
  // the ring's own per-account taint so unticking an account in the dashboard
  // visibly lowers the percentage, which is the whole point of demo step 6.
  if (payload.cached && ring.default_taint?.accounts?.length) {
    const taintedBy = new Map(ring.default_taint.accounts.map((a) => [a.id, a.tainted ?? 0]));
    atRiskBefore = ring.default_taint.accounts.reduce((sum, a) => sum + (a.tainted ?? 0), 0);
    secured = freeze.reduce((sum, accountId) => sum + (taintedBy.get(accountId) ?? 0), 0);
    pctStopped = atRiskBefore ? round3(secured / atRiskBefore) : 0;
  }

  res.json({
    freeze,
    at_risk_before: atRiskBefore,
    secured,
    pct_stopped: pctStopped,
    cached: Boolean(payload.cached),
    // at_risk_before is 0 when no tainted money has reached a cash-out point
    // yet. That is a real analytical state, not a failure: the freeze optimiser
    // correctly finds nothing to stop. Returning it as an indistinguishable
    // `freeze: []` made the frontend's only options be "render an empty panel"
    // or "render an error", and neither was true. This lets it say why.
    nothing_at_risk: atRiskBefore === 0,
  });
};

/** GET /rings/:id/recruits, served from the database so it never needs Python. */
export const getRecruits = async (req: Request, res: Response): Promise<void> => {
  const { id } = dto<ResourceIdDto>(req, 'resourceId');
  await requireRing(id);
  res.json(await recruits.listForRing(id));
};

/**
 * GET /rings/:id/geo (TRD section 11).
 *
 * Served straight from the database; it does not call Python.
 */
export const getGeo = async (req: Request, res: Response): Promise<void> => {
  const { id } = dto<ResourceIdDto>(req, 'resourceId');
  const ring = await requireRing(id);

  const [members, cashouts] = await Promise.all([
    accounts.listByRing(ring.id),
    transactions.cashoutsForRing(ring.member_ids),
  ]);

  res.json(toRingGeo(ring, members, cashouts));
};

/**
 * Rings overview, used by the dashboard graph before a case is opened.
 * Not in the TRD contract table, so it is kept clearly separate from /rings/:id.
 */
export const listRings = async (_req: Request, res: Response): Promise<void> => {
  res.json(await rings.listSummaries());
};
