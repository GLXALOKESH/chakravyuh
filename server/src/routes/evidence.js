/**
 * POST /rings/:id/evidence (F12, TRD section 9).
 *
 * Body: { graph_png, txn, as_of }. The graph snapshot has to come from the
 * browser because only Cytoscape.js knows the current layout.
 */
import { Router } from 'express';
import { handler, notFound, badRequest } from '../lib/serialize.js';
import * as rings from '../models/rings.js';
import * as accounts from '../models/accounts.js';
import * as recruitsModel from '../models/recruits.js';
import * as ml from '../mlClient.js';
import { buildEvidencePdf } from '../evidence.js';

const router = Router();

const MAX_GRAPH_BYTES = 4 * 1024 * 1024;

router.post(
  '/rings/:id/evidence',
  handler(async (req, res) => {
    const ring = await rings.getById(req.params.id);
    if (!ring) throw notFound(`no ring ${req.params.id}`);

    const body = req.body ?? {};
    const graphPng = typeof body.graph_png === 'string' && body.graph_png ? body.graph_png : null;
    if (graphPng && graphPng.length > MAX_GRAPH_BYTES) {
      throw badRequest('graph_png is too large');
    }

    const victimTxnId = body.txn ?? ring.victim_txn_ids[0] ?? null;
    const asOf = body.as_of ?? null;

    // Both of these fall back to the cached defaults when Python is down, so a
    // thin pack is still produced rather than a failed request.
    const [taint, freeze, members, recruits] = await Promise.all([
      ml.taint({ ring_id: ring.id, victim_txn_id: victimTxnId, as_of: asOf }, ring.default_taint),
      ml.freeze(
        { ring_id: ring.id, victim_txn_id: victimTxnId, as_of: asOf, k: 3, exclude: [] },
        ring.default_freeze,
      ),
      accounts.listByRing(ring.id),
      recruitsModel.listForRing(ring.id),
    ]);

    const pdf = await buildEvidencePdf({
      ring,
      members,
      taint: taint.payload,
      freeze: freeze.payload,
      recruits,
      graphPng,
    });

    res
      .status(200)
      .type('application/pdf')
      // Attach rather than inline so the browser downloads it.
      .setHeader('content-disposition', `attachment; filename="${ring.id}-evidence.pdf"`)
      .send(pdf);
  }),
);

export default router;