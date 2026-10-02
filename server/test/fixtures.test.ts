/**
 * Generator invariants (TRD section 13).
 *
 * The TRD assigns these to Member 3 for ml/generate.py. They are run here
 * against the dev fixture generator as well, because until the generator exists
 * the fixtures are what the demo runs on, and a broken invariant in the demo
 * data is a judge-facing problem rather than a theoretical one.
 *
 * One invariant is deliberately not asserted: ML purity. is_fraud comes from the
 * generator either way, and the API already refuses to serialise it.
 */
import { describe, expect, it } from 'vitest';
import { buildFixtures, FIXTURE_SEED } from '../src/fixtures/generator.js';
import { CONFIG } from '../src/fixtures/config.js';
import { SYSTEM_ACCOUNT_IDS } from '../src/constants/index.js';

const fixtures = buildFixtures();
const byId = new Map(fixtures.accounts.map((a) => [a.id, a]));

describe('generator invariants', () => {
  it('no account balance goes below zero', () => {
    const balance = new Map<string, number>(fixtures.accounts.map((a) => [a.id, a.opening_balance]));
    for (const id of SYSTEM_ACCOUNT_IDS) balance.set(id, 0);

    const ordered = [...fixtures.transactions].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
    for (const txn of ordered) {
      balance.set(txn.from, (balance.get(txn.from) ?? 0) - txn.amount);
      balance.set(txn.to, (balance.get(txn.to) ?? 0) + txn.amount);
      const from = balance.get(txn.from) ?? 0;
      if (!SYSTEM_ACCOUNT_IDS.includes(txn.from)) {
        expect(from, `${txn.from} went negative (${from}) on ${txn.id}`).toBeGreaterThanOrEqual(-0.5);
      }
    }
  });

  it('every ring has a source and a cash-out', () => {
    for (const ring of fixtures.rings) {
      const roles = ring.member_ids.map((id) => byId.get(id)?.role);
      expect(roles, `${ring.id} has no source`).toContain('source');
      expect(roles, `${ring.id} has no cash-out`).toContain('cash-out');
    }
  });

  it('every ring member carries a role and a reason for it (TRD section 7.5)', () => {
    for (const account of fixtures.accounts.filter((a) => a.ring_id)) {
      expect(account.role, `${account.id} is in a ring but has no role`).toBeTruthy();
      expect((account.role_reason ?? '').length, `${account.id} has no usable role_reason`).toBeGreaterThan(10);
    }
  });

  it('Account E shares an identifier with a ring member but never transacts with one', () => {
    const accountE = fixtures.ground_truth.account_e!;
    const ring = fixtures.rings.find((r) => r.id === 'RING01')!;
    const members = new Set(ring.member_ids);

    const linked = fixtures.identifiers.some(
      (identifier) =>
        identifier.account_ids.includes(accountE) && identifier.account_ids.some((a) => members.has(a)),
    );
    expect(linked, 'Account E should share a device or phone with a ring member').toBe(true);

    const touching = fixtures.transactions.filter((t) => t.from === accountE || t.to === accountE);
    expect(touching.length, 'Account E must have no transactions before joining').toBe(0);
  });

  it('every ATM transaction has a location and nothing else does', () => {
    for (const txn of fixtures.transactions) {
      if (txn.channel === 'ATM') {
        expect(txn.location, `${txn.id} is ATM with no location`).toBeTruthy();
        const location = txn.location as { lat: number; lng: number; city: string };
        expect(typeof location.lat).toBe('number');
        expect(typeof location.lng).toBe('number');
        expect(location.city, `${txn.id} has no city`).toBeTruthy();
      } else {
        expect(txn.location, `${txn.id} is ${txn.channel} but carries a location`).toBeNull();
      }
    }
  });

  it('every account has a home city with coordinates', () => {
    for (const account of fixtures.accounts) {
      expect(account.home?.city, `${account.id} has no home city`).toBeTruthy();
      expect(typeof account.home!.lat).toBe('number');
      expect(typeof account.home!.lng).toBe('number');
    }
  });

  it('geo_spread_km stays under 50 km for a ring with one cash-out city', () => {
    for (const ring of fixtures.rings) {
      const cashouts = fixtures.transactions.filter(
        (t) => t.channel === 'ATM' && ring.member_ids.includes(t.from) && t.location,
      );
      const cities = new Set(cashouts.map((t) => (t.location as { city: string }).city));
      if (cities.size === 1) {
        expect(ring.geo_spread_km, `${ring.id} spans ${ring.geo_spread_km}km across a single city`).toBeLessThan(50);
      }
    }
  });

  it('taint conserves the victim amount for every ring', () => {
    for (const ring of fixtures.rings) {
      const taint = ring.default_taint as { accounts: { tainted: number }[]; lost_to_cash: number; victim_amount: number };
      const sum = taint.accounts.reduce((s, a) => s + a.tainted, 0) + taint.lost_to_cash;
      expect(sum, `${ring.id} does not conserve the victim amount`).toBe(taint.victim_amount);
    }
  });

  it('recommended liens are proportionate, never more than the balance', () => {
    for (const ring of fixtures.rings) {
      const taint = ring.default_taint as { accounts: { id: string; tainted: number; balance: number; lien: number }[] };
      for (const account of taint.accounts) {
        expect(account.lien, `${ring.id} ${account.id}`).toBe(Math.min(account.tainted, account.balance));
      }
    }
  });

  it('the cached freeze is sane (TRD section 13)', () => {
    for (const ring of fixtures.rings) {
      const freeze = ring.default_freeze as { freeze: string[]; secured: number; at_risk_before: number; pct_stopped: number };
      expect(freeze.secured, `${ring.id} secures more than is at risk`).toBeLessThanOrEqual(freeze.at_risk_before);
      expect(freeze.pct_stopped).toBeGreaterThanOrEqual(0);
      expect(freeze.pct_stopped).toBeLessThanOrEqual(1);
      for (const id of freeze.freeze) {
        expect(ring.member_ids, `${ring.id} recommends a non-member`).toContain(id);
      }
      // The demo asks for k of 3 (TRD section 7.7).
      expect(freeze.freeze.length, `${ring.id} recommends more than k accounts`).toBeLessThanOrEqual(3);
    }
  });

  it('ring volume counts only money that entered the ring from outside', () => {
    for (const ring of fixtures.rings) {
      const members = new Set(ring.member_ids);
      const expected = fixtures.transactions
        .filter((t) => t.is_fraud && members.has(t.to) && !members.has(t.from))
        .reduce((s, t) => s + t.amount, 0);
      expect(ring.volume, `${ring.id} volume should be its external inflow`).toBe(expected);
    }
  });

  it('the dataset meets the PRD size targets', () => {
    expect(fixtures.accounts.length, 'about 600 accounts').toBeGreaterThanOrEqual(500);
    expect(fixtures.accounts.length).toBeLessThanOrEqual(700);
    expect(fixtures.transactions.length, 'about 5000 transactions').toBeGreaterThanOrEqual(4500);
    expect(fixtures.transactions.length).toBeLessThanOrEqual(5500);
    expect(fixtures.rings.length, 'three planted rings').toBe(3);
  });

  it('account ids, transaction ids and ring ids are unique', () => {
    expect(new Set(fixtures.accounts.map((a) => a.id)).size).toBe(fixtures.accounts.length);
    expect(new Set(fixtures.transactions.map((t) => t.id)).size).toBe(fixtures.transactions.length);
    expect(new Set(fixtures.identifiers.map((i) => i.id)).size).toBe(fixtures.identifiers.length);
    expect(new Set(fixtures.rings.map((r) => r.id)).size).toBe(fixtures.rings.length);
  });

  it('normal accounts share devices too, so shared-device is not a perfect fraud signal', () => {
    // TRD section 5: 3 to 5 percent of normal accounts share a device or phone.
    // Without this noise the V2 result would be meaningless.
    const ringMembers = new Set(fixtures.rings.flatMap((r) => r.member_ids));
    const familyPairs = fixtures.identifiers.filter(
      (i) => i.account_ids.every((a) => !ringMembers.has(a)) && i.account_ids.length === 2,
    );
    expect(familyPairs.length, 'expected some family device sharing among normal accounts').toBeGreaterThan(0);
  });

  it('the generator is deterministic for a given seed', () => {
    const again = buildFixtures();
    expect(again.transactions.length).toBe(fixtures.transactions.length);
    expect(again.transactions[0]).toEqual(fixtures.transactions[0]);
    expect(again.rings[0]!.id).toBe(fixtures.rings[0]!.id);
    // A different seed must produce a different dataset, or the PRNG is not
    // being driven by the seed at all.
    expect(JSON.stringify(buildFixtures({ seed: FIXTURE_SEED + 1 }).transactions.slice(0, 50))).not.toBe(
      JSON.stringify(fixtures.transactions.slice(0, 50)),
    );
  });

  it('the demo scenario is intact: a 12 lakh victim transfer into RING01', () => {
    const ring = fixtures.rings.find((r) => r.id === 'RING01')!;
    const victimTxn = fixtures.transactions.find((t) => t.id === fixtures.ground_truth.victim_txn_id)!;
    expect(victimTxn.amount).toBe(1_200_000);
    expect(ring.member_ids, 'the victim transfer should land on a ring member').toContain(victimTxn.to);
    expect((ring.default_taint as { victim_amount: number }).victim_amount).toBe(1_200_000);
    expect(CONFIG.days, 'the demo profile spans 7 days').toBe(7);
  });
});
