/**
 * POST /api/rings/:id/freeze — the ambiguous-empty case.
 *
 * A ring whose tainted money has not yet reached a cash-out point returns
 * `freeze: []` with `pct_stopped: 0`. That is the optimiser working correctly,
 * not a failure — but the two look identical on the wire, so the frontend's only
 * options were "render an empty panel" or "render an error", and neither was
 * true. `nothing_at_risk` disambiguates it.
 *
 * Found on RING01 in the ML team's dataset, where victim_amount is 17,321
 * against 771,670 and 1,005,849 for the other two rings, and lost_to_cash is 0.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { freshDb, shutdown, startServer, type TestClient } from './helpers.js';

let api: TestClient;

beforeAll(async () => {
  await freshDb();
  api = await startServer(createApp());
});

afterAll(async () => {
  await api?.stop();
  await shutdown();
});

describe('POST /api/rings/:id/freeze with nothing at risk', () => {
  it('distinguishes "nothing to freeze" from a failure', async () => {
    const { status, body } = await api.post('/api/rings/RING01/freeze', { k: 3 });

    expect(status).toBe(200);

    // The flag has to agree with the number it describes.
    expect(body.nothing_at_risk).toBe(body.at_risk_before === 0);

    // And the pair has to be self-consistent either way: nothing at risk means
    // nothing frozen and nothing secured.
    if (body.nothing_at_risk) {
      expect(body.freeze).toEqual([]);
      expect(body.secured).toBe(0);
      expect(body.pct_stopped).toBe(0);
    }
  });

  it('reports a ring with money at risk as not-nothing-at-risk', async () => {
    // RING02 and RING03 both have cash-out links, so at_risk_before is non-zero
    // and the flag must be false. Without this, a hardcoded `false` would pass
    // the test above for the wrong reason.
    const { status, body } = await api.post('/api/rings/RING02/freeze', { k: 3 });

    expect(status).toBe(200);
    expect(body.nothing_at_risk).toBe(false);
    expect(body.at_risk_before).toBeGreaterThan(0);
  });

  it('still never returns an excluded account', async () => {
    // The ambiguity fix must not have disturbed TRD section 7.7.
    const { body } = await api.post('/api/rings/RING02/freeze', {
      k: 3,
      exclude: ['ACC1034'],
    });

    expect(body.freeze).not.toContain('ACC1034');
  });
});