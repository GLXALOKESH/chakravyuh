/**
 * POST /api/rings/:id/freeze — the ambiguous-empty case.
 *
 * A ring whose tainted money has not yet reached a cash-out point returns
 * `freeze: []` with `pct_stopped: 0`. That is the optimiser working correctly,
 * not a failure — but the two look identical on the wire, so the frontend's only
 * options were "render an empty panel" or "render an error", and neither was
 * true. `nothing_at_risk` disambiguates it.
 *
 * Found on RING01 in the ML team's dataset, where victim_amount was 17,321
 * against 771,670 and 1,005,849 for the other two rings, and lost_to_cash was 0.
 *
 * REQUIRES THE ML SERVICE TO BE STOPPED, for the same reason as
 * ml-fallback.test.ts. This suite seeds chakravyuh_test from the built-in
 * fixtures, while a running ml/service.py loads the pipeline's own data/demo.
 * The ring ids in the two datasets are unrelated, so with the service up the
 * server asks it about fixture RING01 and gets back pipeline RING01 — a
 * different ring entirely, and the assertion is then about nothing meaningful.
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
    // Which ring is the large one is a property of the generated data, not of
    // the code, and it changes whenever the pipeline is re-run — the ring ids
    // come from community discovery order. So find such a ring rather than
    // hardcoding one, otherwise this test asserts something about the fixture
    // rather than about the flag.
    const { body: rings } = await api.get('/api/rings');

    let checked = false;
    for (const ring of rings) {
      const { status, body } = await api.post(`/api/rings/${ring.id}/freeze`, { k: 3 });
      expect(status).toBe(200);

      // The flag must agree with the number it describes, either way.
      expect(body.nothing_at_risk).toBe(body.at_risk_before === 0);

      if (body.at_risk_before > 0) {
        expect(body.nothing_at_risk).toBe(false);
        expect(body.freeze.length).toBeGreaterThan(0);
        checked = true;
      }
    }

    expect(checked, 'expected at least one ring with money at risk').toBe(true);
  });

  it('still never returns an excluded account', async () => {
    // The ambiguity fix must not have disturbed TRD section 7.7. Find a ring
    // that actually recommends something, again rather than hardcoding one.
    const { body: rings } = await api.get('/api/rings');

    for (const ring of rings) {
      const { body } = await api.post(`/api/rings/${ring.id}/freeze`, { k: 3 });
      if (!body.freeze.length) continue;

      const target = body.freeze[0];
      const excluded = await api.post(`/api/rings/${ring.id}/freeze`, {
        k: 3,
        exclude: [target],
      });
      expect(excluded.body.freeze).not.toContain(target);
      return;
    }

    expect.unreachable('no ring returned a freeze recommendation');
  });
});