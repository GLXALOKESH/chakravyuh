/**
 * POST /rings/:id/evidence (F12, TRD section 9).
 *
 * Body: { graph_png, txn, as_of }. The graph snapshot has to come from the
 * browser because only Cytoscape.js knows the current layout.
 */
import type { Request, Response } from 'express';
import { BadRequestError, NotFoundError } from '../exceptions/index.js';
import { MAX_GRAPH_PNG_BYTES } from '../constants/index.js';
import * as rings from '../repositories/rings.repository.js';
import * as accounts from '../repositories/accounts.repository.js';
import * as recruits from '../repositories/recruits.repository.js';
import * as ml from '../services/ml.service.js';
import { buildEvidencePdf } from '../services/evidence.service.js';
import type { EvidenceBodyDto, ResourceIdDto } from '../DTOClasses/index.js';

const dto = <T>(req: Request, key: string): T => (req as unknown as Record<string, unknown>)[key] as T;

export const postEvidence = async (req: Request, res: Response): Promise<void> => {
  const { id } = dto<ResourceIdDto>(req, 'resourceId');
  const body = dto<EvidenceBodyDto>(req, 'bodyDto');

  const ring = await rings.getById(id);
  if (!ring) throw new NotFoundError(`no ring ${id}`);

  const graphPng = body.graph_png && body.graph_png.length > 0 ? body.graph_png : null;
  if (graphPng && graphPng.length > MAX_GRAPH_PNG_BYTES) {
    // The DTO caps the encoded length, which is the value we can actually
    // measure. This second check is on the same number and exists so the limit
    // is a named constant rather than a literal buried in a decorator.
    throw new BadRequestError('graph_png is too large');
  }

  const victimTxnId = body.txn ?? ring.victim_txn_ids[0] ?? null;
  const asOf = body.as_of ?? null;

  // Both of these fall back to the cached defaults when Python is down, so a
  // thin pack is still produced rather than a failed request.
  const [taint, freeze, members, recruitList] = await Promise.all([
    ml.taint({ ring_id: ring.id, victim_txn_id: victimTxnId, as_of: asOf }, ring.default_taint),
    ml.freeze({ ring_id: ring.id, victim_txn_id: victimTxnId, as_of: asOf, k: 3, exclude: [] }, ring.default_freeze),
    accounts.listByRing(ring.id),
    recruits.listForRing(ring.id),
  ]);

  const pdf = await buildEvidencePdf({
    ring,
    members,
    taint: taint.payload,
    freeze: freeze.payload,
    recruits: recruitList,
    graphPng,
  });

  res
    .status(200)
    .type('application/pdf')
    // Attach rather than inline so the browser downloads it.
    .setHeader('content-disposition', `attachment; filename="${ring.id}-evidence.pdf"`)
    .send(pdf);
};
