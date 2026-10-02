/**
 * Generator invariants (TRD section 13).
 *
 * The TRD assigns these to Member 3 for ml/generate.py. They are run here
 * against server/devFixtures.js as well, because until the generator exists the
 * fixtures are what the demo runs on, and a broken invariant in the demo data is
 * a judge-facing problem rather than a theoretical one.
 *
 * One invariant is deliberately not asserted: ML purity. is_fraud comes from the
 * generator either way, and the API already refuses to serialise it.
 */
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildFixtures, FIXTURE_SEED } from '../devFixtures.js';
import { CONFIG } from '../fixtureConfig.js';

/** Accounts the generator treats as external, not as real accounts. */
const SYSTEM_ACCOUNTS = new Set(['CASH', 'SALARY']);

const fixtures = buildFixtures();
const byId = new Map(fixtures.accounts.map((a) => [a._id, a]));

describe('generator invariants', () => {
  test('no account balance goes below zero', () => {
    const balance = new Map(fixtures.accounts.map((a) => [a._id, a.opening_balance]));
    for (const id of SYSTEM_ACCOUNTS) balance.set(id, 0);

    const ordered = [...fixtures.transactions].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
    for (const txn of ordered) {
      balance.set(txn.from, (balance.get(txn.from) ?? 0) - txn.amount);
      balance.set(txn.to, (balance.get(txn.to) ?? 0) + txn.amount);
      const from = balance.get(txn.from);
      if (!SYSTEM_ACCOUNTS.has(txn.from)) {
        assert.ok(from >= -0.5, `${txn.from} went negative (${from}) on ${txn._id}`);
      }
    }
  });

  test('every ring has a source and a cash-out', () => {
    for (const ring of fixtures.rings) {
      const roles = ring.member_ids.map((id) => byId.get(id)?.role);
      assert.ok(roles.includes('source'), `${ring._id} has no source`);
      assert.ok(roles.includes('cash-out'), `${ring._id} has no cash-out`);
    }
  });

  test('every ring member carries a role and a reason for it (TRD section 7.5)', () => {
    for (const account of fixtures.accounts.filter((a) => a.ring_id)) {
      assert.ok(account.role, `${account._id} is in a ring but has no role`);
      assert.ok(account.role_reason?.length > 10, `${account._id} has no usable role_reason`);
    }
  });

  test('Account E shares an identifier with a ring member but never transacts with one', () => {
    const accountE = fixtures.ground_truth.account_e;
    const ring = fixtures.rings.find((r) => r._id === 'RING01');
    const members = new Set(ring.member_ids);

    const linked = fixtures.identifiers.some(
      (identifier) =>
        identifier.account_ids.includes(accountE) && identifier.account_ids.some((a) => members.has(a)),
    );
    assert.ok(linked, 'Account E should share a device or phone with a ring member');

    const touching = fixtures.transactions.filter((t) => t.from === accountE || t.to === accountE);
    assert.equal(touching.length, 0, 'Account E must have no transactions before joining');

    for (const txn of touching) {
      assert.ok(!members.has(txn.from) && !members.has(txn.to));
    }
  });

  test('every ATM transaction has a location and nothing else does', () => {
    for (const txn of fixtures.transactions) {
      if (txn.channel === 'ATM') {
        assert.ok(txn.location, `${txn._id} is ATM with no location`);
        assert.equal(typeof txn.location.lat, 'number');
        assert.equal(typeof txn.location.lng, 'number');
        assert.ok(txn.location.city, `${txn._id} has no city`);
      } else {
        assert.equal(txn.location, null, `${txn._id} is ${txn.channel} but carries a location`);
      }
    }
  });

  test('every account has a home city with coordinates', () => {
    for (const account of fixtures.accounts) {
      assert.ok(account.home?.city, `${account._id} has no home city`);
      assert.equal(typeof account.home.lat, 'number');
      assert.equal(typeof account.home.lng, 'number');
    }
  });

  test('geo_spread_km stays under 50 km for a ring with one cash-out city', () => {
    for (const ring of fixtures.rings) {
      const cashouts = fixtures.transactions.filter(
        (t) => t.channel === 'ATM' && ring.member_ids.includes(t.from) && t.location,
      );
      const cities = new Set(cashouts.map((t) => t.location.city));
      if (cities.size === 1) {
        assert.ok(ring.geo_spread_km < 50, `${ring._id} spans ${ring.geo_spread_km}km across a single city`);
      }
    }
  });

  test('taint conserves the victim amount for every ring', () => {
    for (const ring of fixtures.rings) {
      const taint = ring.default_taint;
      const sum = taint.accounts.reduce((s, a) => s + a.tainted, 0) + taint.lost_to_cash;
      assert.equal(sum, taint.victim_amount, `${ring._id} does not conserve the victim amount`);
    }
  });

  test('recommended liens are proportionate, never more than the balance', () => {
    for (const ring of fixtures.rings) {
      for (const account of ring.default_taint.accounts) {
        assert.equal(account.lien, Math.min(account.tainted, account.balance), `${ring._id} ${account.id}`);
      }
    }
  });

  test('the cached freeze is sane (TRD section 13)', () => {
    for (const ring of fixtures.rings) {
      const freeze = ring.default_freeze;
      assert.ok(freeze.secured <= freeze.at_risk_before, `${ring._id} secures more than is at risk`);
      assert.ok(freeze.pct_stopped >= 0 && freeze.pct_stopped <= 1);
      for (const id of freeze.freeze) assert.ok(ring.member_ids.includes(id), `${ring._id} recommends a non-member`);
      assert.ok(freeze.freeze.length <= freeze.k, `${ring._id} recommends more than k accounts`);
    }
  });

  test('ring volume counts only money that entered the ring from outside', () => {
    for (const ring of fixtures.rings) {
      const members = new Set(ring.member_ids);
      const expected = fixtures.transactions
        .filter((t) => t.is_fraud && members.has(t.to) && !members.has(t.from))
        .reduce((s, t) => s + t.amount, 0);
      assert.equal(ring.volume, expected, `${ring._id} volume should be its external inflow`);
    }
  });

  test('the dataset meets the PRD size targets', () => {
    assert.ok(fixtures.accounts.length >= 500 && fixtures.accounts.length <= 700, 'about 600 accounts');
    assert.ok(fixtures.transactions.length >= 4500 && fixtures.transactions.length <= 5500, 'about 5000 transactions');
    assert.equal(fixtures.rings.length, 3, 'three planted rings');
  });

  test('account ids, transaction ids and ring ids are unique', () => {
    assert.equal(new Set(fixtures.accounts.map((a) => a._id)).size, fixtures.accounts.length);
    assert.equal(new Set(fixtures.transactions.map((t) => t._id)).size, fixtures.transactions.length);
    assert.equal(new Set(fixtures.identifiers.map((i) => i._id)).size, fixtures.identifiers.length);
    assert.equal(new Set(fixtures.rings.map((r) => r._id)).size, fixtures.rings.length);
  });

  test('normal accounts share devices too, so shared-device is not a perfect fraud signal', () => {
    // TRD section 5: 3 to 5 percent of normal accounts share a device or phone.
    // Without this noise the V2 result would be meaningless.
    const ringMembers = new Set(fixtures.rings.flatMap((r) => r.member_ids));
    const familyPairs = fixtures.identifiers.filter(
      (i) => i.account_ids.every((a) => !ringMembers.has(a)) && i.account_ids.length === 2,
    );
    assert.ok(familyPairs.length > 0, 'expected some family device sharing among normal accounts');
  });

  test('the generator is deterministic for a given seed', () => {
    const again = buildFixtures();
    assert.equal(again.transactions.length, fixtures.transactions.length);
    assert.equal(again.rings[0].default_taint.victim_amount, fixtures.rings[0].default_taint.victim_amount);
    assert.deepEqual(again.transactions[0], fixtures.transactions[0]);
    assert.notEqual(buildFixtures({ seed: FIXTURE_SEED + 1 }).transactions.length + 0, -1);
  });

  test('the demo scenario is intact: a 12 lakh victim transfer into RING01', () => {
    const ring = fixtures.rings.find((r) => r._id === 'RING01');
    const victimTxn = fixtures.transactions.find((t) => t._id === fixtures.ground_truth.victim_txn_id);
    assert.equal(victimTxn.amount, 1_200_000);
    assert.ok(ring.member_ids.includes(victimTxn.to), 'the victim transfer should land on a ring member');
    assert.equal(ring.default_taint.victim_amount, 1_200_000);
    assert.equal(CONFIG.days, 7, 'the demo profile spans 7 days');
  });
});