/**
 * Evidence pack (F12, TRD section 9).
 *
 * The PDF is server-side work, so it can be tested without a database by
 * handing the builder the same shapes a controller would. What is being checked
 * is that the document is a real PDF and that it still gets produced when
 * sections are missing, which is the property that matters mid-demo.
 */
import { describe, expect, it } from 'vitest';
import { buildEvidencePdf } from '../src/services/evidence.service.js';
import { buildFixtures } from '../src/fixtures/generator.js';
import type { Account, FreezePayload, Recruit, ReplayTxn, Ring, TaintPayload } from '../src/interfaces/domain.interface.js';

const fixtures = buildFixtures();
const ring = fixtures.rings.find((r) => r.id === 'RING01') as unknown as Ring;
const taint = ring.default_taint as unknown as TaintPayload;
const freeze = ring.default_freeze as unknown as FreezePayload;
const members = fixtures.accounts
  .filter((a) => a.ring_id === 'RING01')
  .map((a) => ({
    ...a,
    features: a.features,
    signals: a.signals,
    role: a.role ?? 'member',
  })) as unknown as Account[];
const recruits: Recruit[] = fixtures.recruits[0]!.recruits;

/** A 1x1 PNG, the smallest valid image pdfkit will embed. */
const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const assertIsPdf = (bytes: Buffer): void => {
  // Header and trailer are at fixed positions: the version string at the front,
  // %%EOF in the last few hundred bytes. The page tree lives in between, so it
  // is searched over the whole file rather than in a slice.
  expect(bytes.subarray(0, 8).toString('latin1'), 'a PDF starts with a version header').toMatch(/^%PDF-\d\.\d/);
  expect(bytes.subarray(-1024).toString('latin1'), 'a PDF ends with %%EOF').toContain('%%EOF');
  expect(bytes.toString('latin1'), 'the document should declare pages').toContain('/Type /Page');
  expect(bytes.length, 'a suspiciously small PDF means nothing was drawn').toBeGreaterThan(1000);
};

describe('evidence pack', () => {
  it('builds a valid PDF from a full ring', async () => {
    const pdf = await buildEvidencePdf({ ring, members, taint, freeze, recruits, graphPng: TINY_PNG });
    assertIsPdf(pdf);
  });

  it('declares a page tree sized to the content', async () => {
    const small = await buildEvidencePdf({ ring, members: [], taint, freeze, recruits: [] });
    const large = await buildEvidencePdf({
      ring,
      members,
      taint,
      freeze,
      recruits: Array.from({ length: 40 }, (_, i) => ({
        id: `ACC${i}`,
        probability: 0.5,
        reasons: ['Shares device DEV017 with ACC0051', 'Account is 2 days old', 'No transactions yet'],
      })),
    });
    // pdfkit paginates, so more content has to mean more pages. Without this the
    // footer loop could quietly stop running on the later pages.
    const pageCount = (bytes: Buffer) => (bytes.toString('latin1').match(/\/Type \/Page[^s]/g) ?? []).length;
    expect(pageCount(large), 'a longer pack should not fit in fewer pages').toBeGreaterThan(pageCount(small));
  });

  it('is still produced when the ML service returned nothing', async () => {
    // The degraded case: no taint, no freeze, no recruits. A demo should get a
    // thin document, not a failed request.
    const pdf = await buildEvidencePdf({
      ring,
      members,
      taint: { victim_amount: 0, as_of: null, cached: true, accounts: [], lost_to_cash: 0, links: [] },
      freeze: { freeze: [], at_risk_before: 0, secured: 0, pct_stopped: 0, cached: true },
      recruits: [],
    });
    assertIsPdf(pdf);
  });

  it('is still produced with no members at all', async () => {
    const pdf = await buildEvidencePdf({ ring, members: [], taint, freeze, recruits: [] });
    assertIsPdf(pdf);
  });

  it('survives a graph image that is not a real image', async () => {
    const pdf = await buildEvidencePdf({ ring, members, taint, freeze, recruits, graphPng: 'not-an-image' });
    assertIsPdf(pdf);
  });

  it('a pack long enough to paginate keeps its page count honest', async () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      id: `ACC${i}`,
      probability: 0.5,
      reasons: ['Shares device DEV017 with ACC0051', 'Account is 2 days old'],
    }));
    const pdf = await buildEvidencePdf({ ring, members, taint, freeze, recruits: many });
    assertIsPdf(pdf);
    // The footer loop walks bufferedPageRange and draws on every page, so a
    // multi-page pack has to declare more than one page. Asserting the count
    // rather than grepping the footer's text: pdfkit writes glyphs as hex, so
    // the wording is not findable in the raw bytes by design.
    const pages = (pdf.toString('latin1').match(/\/Type \/Page[^s]/g) ?? []).length;
    expect(pages, 'a pack this long should span several pages').toBeGreaterThan(1);
  });

  it('embeds a text font with an encoding readers can extract from', async () => {
    const pdf = await buildEvidencePdf({ ring, members, taint, freeze, recruits });
    const text = pdf.toString('latin1');
    // This is what makes the account ids and amounts copy-pasteable out of the
    // pack, which is the point of producing a PDF at all.
    expect(text).toContain('/BaseFont /Helvetica');
    expect(text, 'WinAnsiEncoding is what lets a reader decode the glyphs').toContain('/WinAnsiEncoding');
  });
});
