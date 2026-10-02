/**
 * Development fixtures.
 *
 * NOT the data generator. That is Member 3's job, in ml/generate.py, writing
 * data/<profile>/*.json per TRD section 5. This file exists only because
 * data/ and ml/ are empty while the API is being built: it produces a small,
 * deterministic, contract-shaped dataset so the routes, the seed, the replay
 * engine, the PDF and the frontend can all be developed and tested against
 * something real-shaped before the ML pipeline exists.
 *
 * `npm run seed` prefers data/<profile>/ and only falls back to this when it is
 * missing (or SEED_FIXTURES=1). Once ml/generate.py lands, delete this file and
 * the fallback.
 *
 * The scenario follows the PRD "Demo scenario" section: a victim transfers
 * 12,00,000 into RING01, a fan-out ring whose money ends up at ATM cash-outs,
 * with ACC0311 sharing a device with a ring member but never transacting with it.
 *
 * Set SEED_ROUNDS=n to spend a while proving the ring recovery, metrics and
 * taint-conservation invariants hold for many seeds. The demo uses the default.
 */
import { CONFIG } from './fixtureConfig.js';

/** Fixed for the demo (TRD section 5, "fixed seed"). Override only via SEED_SEED. */
export const FIXTURE_SEED = 42;

const T0 = Date.parse('2026-10-01T00:00:00Z');

/** Deterministic PRNG so fixtures never change between runs. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const at = (minutes) => new Date(T0 + minutes * 60000).toISOString();
const pad = (n, width) => String(n).padStart(width, '0');

function haversineKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function buildFixtures({ seed = FIXTURE_SEED } = {}) {
  const rnd = mulberry32(seed);
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  const between = (lo, hi) => lo + rnd() * (hi - lo);
  const intBetween = (lo, hi) => Math.floor(between(lo, hi + 1));

  const accounts = [];
  const identifiers = [];
  const transactions = [];
  /** Running balance per account, so the no-negative-balance rule holds. */
  const balance = new Map();

  let txnSeq = 5000;
  const nextTxnId = () => `TXN${pad((txnSeq += 1), 6)}`;

  /**
   * Records a transaction, or skips it when the sender cannot cover it. The
   * generator rule in TRD section 5 is that no balance may go below zero, and
   * refusing the debit is the honest way to keep that true.
   */
  function transfer({ from, to, amount, minutes, channel = 'UPI', isFraud = false, location = null }) {
    const have = balance.get(from) ?? 0;
    if (have < amount) return null;
    balance.set(from, have - amount);
    balance.set(to, (balance.get(to) ?? 0) + amount);
    const txn = {
      _id: nextTxnId(),
      from,
      to,
      amount: Math.round(amount),
      ts: at(minutes),
      channel,
      location,
      is_fraud: isFraud,
    };
    transactions.push(txn);
    return txn;
  }

  // ---------------------------------------------------------------- accounts

  const ids = Array.from({ length: CONFIG.accountCount }, (_, i) => `ACC${pad(i + 1, 4)}`);
  const ringAccountIds = new Set();

  for (const id of ids) {
    const home = pick(CONFIG.cities);
    const openedAt = new Date(T0 - between(0, 400) * 86400000 - intBetween(0, 86400) * 1000);
    const opening = Math.round(between(5_000, 200_000));
    const account = {
      _id: id,
      holder: `${pick(['R.', 'S.', 'A.', 'M.', 'K.', 'P.', 'D.', 'N.'])} ${pick(
        ['Sharma', 'Patel', 'Iyer', 'Bose', 'Reddy', 'Nair', 'Gupta', 'Menon', 'Das', 'Khan'],
      )}`,
      bank: pick(['Bank A', 'Bank B', 'Bank C', 'Bank D']),
      home: { city: home.city, lat: Number(home.lat.toFixed(4)), lng: Number(home.lng.toFixed(4)) },
      opened_at: openedAt.toISOString(),
      opening_balance: opening,
      features: {},
      risk_v1: null,
      risk_v2: null,
      signals: [],
      ring_id: null,
      role: null,
      role_reason: null,
    };
    accounts.push(account);
    balance.set(id, opening);
  }

  const byId = (id) => accounts.find((a) => a._id === id);
  const acc = (n) => `ACC${pad(n, 4)}`;

  // ------------------------------------------------------------- identifier

  function addIdentifier(id, type, accountIds) {
    identifiers.push({ _id: id, type, account_ids: accountIds });
  }

  // ------------------------------------------------------------------- RING01
  // Pattern A, fan-out (TRD section 5). Source -> 6 mules -> 2 cash-out.

  const VICTIM = acc(500);
  const SOURCE = acc(40);
  const MULES = [acc(42), acc(45), acc(48), acc(51), acc(54), acc(57)];
  const CASHOUT = [acc(60), acc(63)];
  const COORDINATOR = acc(70);
  const RING01 = [SOURCE, ...MULES, ...CASHOUT, COORDINATOR];

  // DEV017 is shared with ACC0311, which is Account E in the demo script.
  const ACCOUNT_E = acc(311);
  addIdentifier('DEV017', 'device', [MULES[0], MULES[3], MULES[5], ACCOUNT_E]);
  addIdentifier('DEV018', 'device', [MULES[1], MULES[2], COORDINATOR]);
  addIdentifier('PHN042', 'phone', [MULES[0], MULES[3], COORDINATOR]);
  addIdentifier('IP033', 'ip', [MULES[4], MULES[5], CASHOUT[1]]);
  addIdentifier('PHN043', 'phone', [MULES[1], MULES[2], MULES[4]]);
  addIdentifier('IP034', 'ip', [SOURCE, MULES[0], MULES[2], COORDINATOR]);

  for (const id of RING01) ringAccountIds.add(id);

  // Accounts that pay money into a ring need real savings behind them, otherwise
  // the transfer is skipped and the whole ring never moves any money.
  const R2_SEED = acc(460);
  const R3_SEED = acc(470);
  for (const [id, amount] of [
    [VICTIM, 1_500_000],
    [R2_SEED, 1_000_000],
    [R3_SEED, 700_000],
  ]) {
    balance.set(id, amount);
    byId(id).opening_balance = amount;
  }

  const victimTxn = {
    _id: 'TXN003975',
    from: VICTIM,
    to: SOURCE,
    amount: 1200000,
    ts: at(9 * 60 + 42 + 10 / 60),
    channel: 'UPI',
    location: null,
    is_fraud: true,
  };
  transactions.push(victimTxn);
  balance.set(VICTIM, (balance.get(VICTIM) ?? 0) - 1200000);
  balance.set(SOURCE, (balance.get(SOURCE) ?? 0) + 1200000);

  const MULE_SPLIT = [150000, 150000, 150000, 150000, 120000, 120000];
  const ring1MemberTransfers = [];
  MULES.forEach((mule, i) => {
    ring1MemberTransfers.push(
      transfer({
        from: SOURCE,
        to: mule,
        amount: MULE_SPLIT[i],
        minutes: 9 * 60 + 44 + i * 2,
        channel: i % 2 ? 'IMPS' : 'UPI',
        isFraud: true,
      }),
    );
  });

  // Mules forward 90 percent within 2 to 6 minutes, alternating cash-out targets.
  MULES.forEach((mule, i) => {
    const forwarded = Math.round(MULE_SPLIT[i] * 0.9);
    transfer({
      from: mule,
      to: CASHOUT[i % 2],
      amount: forwarded,
      minutes: 9 * 60 + 46 + i * 2,
      channel: 'IMPS',
      isFraud: true,
    });
  });

  // Cash-out. The city is deliberately not the member's home city.
  const cashoutCities = [CONFIG.cities[1], CONFIG.cities[4]];
  CASHOUT.forEach((co, i) => {
    for (let w = 0; w < 2; w += 1) {
      const city = cashoutCities[i];
      transfer({
        from: co,
        to: 'CASH',
        amount: intBetween(40_000, 90_000),
        minutes: 10 * 60 + 5 + i * 6 + w * 20,
        channel: 'ATM',
        isFraud: true,
        location: {
          city: city.city,
          lat: Number((city.lat + between(-0.05, 0.05)).toFixed(4)),
          lng: Number((city.lng + between(-0.05, 0.05)).toFixed(4)),
        },
      });
    }
  });

  // TRD section 9: an alert fires at the ring's third member-to-member transfer.
  const ring1AlertAt = ring1MemberTransfers[2].ts;

  // ------------------------------------------------------------------- RING02
  // Pattern B, relay chain: source -> 3 relays -> cash-out, each hop keeps a cut.

  const R2 = [acc(100), acc(110), acc(120), acc(130), acc(140)];
  R2.forEach((id) => ringAccountIds.add(id));
  addIdentifier('DEV101', 'device', R2);
  addIdentifier('PHN101', 'phone', [R2[0], R2[1], R2[2], R2[3]]);

  const R2_START = 11 * 60 + 5;
  let r2Amount = 900000;
  const r2Entry = transfer({ from: R2_SEED, to: R2[0], amount: r2Amount, minutes: R2_START, channel: 'NEFT', isFraud: true });
  for (let i = 0; i < R2.length - 1; i += 1) {
    r2Amount = Math.round(r2Amount * 0.94);
    const txn = transfer({
      from: R2[i],
      to: R2[i + 1],
      amount: r2Amount,
      minutes: R2_START + 4 * (i + 1),
      channel: 'IMPS',
      isFraud: true,
    });
    ringAccountIds.add(R2[i]);
    if (txn) ring1MemberTransfers.push(txn);
  }
  for (let w = 0; w < 2; w += 1) {
    const city = CONFIG.cities[6];
    transfer({
      from: R2[R2.length - 1],
      to: 'CASH',
      amount: Math.round(r2Amount * 0.45),
      minutes: R2_START + 24 + w * 25,
      channel: 'ATM',
      isFraud: true,
      location: {
        city: city.city,
        lat: Number((city.lat + between(-0.05, 0.05)).toFixed(4)),
        lng: Number((city.lng + between(-0.05, 0.05)).toFixed(4)),
      },
    });
  }

  // ------------------------------------------------------------------- RING03
  // Pattern C, shared-device cluster: 9 near-simultaneous accounts on 3 devices,
  // plus a coordinator that moves very little money.

  const R3 = Array.from({ length: 9 }, (_, i) => acc(200 + i));
  const R3_COORD = acc(210);
  R3.forEach((id) => ringAccountIds.add(id));
  ringAccountIds.add(R3_COORD);
  addIdentifier('DEV201', 'device', [R3[0], R3[1], R3[2], R3[3]]);
  addIdentifier('DEV202', 'device', [R3[4], R3[5], R3[6]]);
  addIdentifier('DEV203', 'device', [R3[7], R3[8], R3_COORD]);
  addIdentifier('PHN201', 'phone', [...R3.slice(0, 6), R3_COORD]);

  const R3_START = 12 * 60;
  const r3Amount = 600000;
  const r3Entry = transfer({ from: R3_SEED, to: R3[0], amount: r3Amount, minutes: R3_START, channel: 'UPI', isFraud: true });
  R3.forEach((id, i) => {
    if (i === 0) return;
    transfer({
      from: R3[i - 1],
      to: id,
      amount: Math.round(r3Amount * 0.97 ** i),
      minutes: R3_START + 3 * i,
      channel: 'IMPS',
      isFraud: true,
    });
  });
  // One cash-out city, two withdrawals, so geo_spread_km is a small non-zero
  // figure. TRD section 13 expects a single-cash-out-city ring to stay under 50 km.
  for (let w = 0; w < 2; w += 1) {
    const city = CONFIG.cities[9];
    transfer({
      from: R3[8],
      to: 'CASH',
      amount: w === 0 ? 180000 : 120000,
      minutes: R3_START + 32 + w * 30,
      channel: 'ATM',
      isFraud: true,
      location: {
        city: city.city,
        lat: Number((city.lat + between(-0.05, 0.05)).toFixed(4)),
        lng: Number((city.lng + between(-0.05, 0.05)).toFixed(4)),
      },
    });
  }
  // Coordinator is linked to every device but carries under 10 percent of volume.
  transfer({ from: R3_COORD, to: R3[4], amount: 15000, minutes: R3_START + 40, channel: 'UPI', isFraud: true });

  // ---------------------------------------------------------- background life

  const background = ids.filter((id) => !ringAccountIds.has(id) && id !== VICTIM && id !== ACCOUNT_E);
  const familySharers = Math.round(background.length * 0.04);
  for (let i = 0; i < familySharers; i += 1) {
    const a = pick(background);
    const b = pick(background);
    if (a === b) continue;
    // TRD section 5: without this noise "shares a device" would be a perfect
    // fraud signal and the V2 result would mean nothing.
    addIdentifier(`DEV${900 + i}`, 'device', [a, b]);
  }

  const channels = ['UPI', 'UPI', 'UPI', 'IMPS', 'NEFT'];

  /**
   * TRD section 6 requires a location on every ATM transaction, and TRD section
   * 11 says a normal account withdraws in its home city about 90 percent of the
   * time. The remaining tenth is ordinary travel, which is what stops distance
   * from home being a perfect fraud signal.
   */
  function atmLocation(accountId) {
    const home = byId(accountId).home;
    const city = rnd() < 0.9 ? CONFIG.cities.find((c) => c.city === home.city) ?? pick(CONFIG.cities) : pick(CONFIG.cities);
    return {
      city: city.city,
      lat: Number((city.lat + between(-0.05, 0.05)).toFixed(4)),
      lng: Number((city.lng + between(-0.05, 0.05)).toFixed(4)),
    };
  }

  let guard = 0;
  while (transactions.length < CONFIG.transactionCount && guard < CONFIG.transactionCount * 20) {
    guard += 1;
    const id = pick(background);
    const roll = rnd();
    const minute = between(0, CONFIG.days * 1440);
    if (roll < 0.22) {
      transfer({
        from: id,
        to: 'CASH',
        amount: intBetween(2_000, 20_000),
        minutes: minute,
        channel: 'ATM',
        location: atmLocation(id),
      });
    } else if (roll < 0.4) {
      transfer({ from: id, to: pick(background), amount: intBetween(500, 30_000), minutes: minute, channel: pick(channels) });
    } else if (roll < 0.62) {
      // Salary credit: a positive opening balance is created directly.
      const amount = intBetween(30_000, 120_000);
      balance.set(id, (balance.get(id) ?? 0) + amount);
      transactions.push({
        _id: nextTxnId(),
        from: 'SALARY',
        to: id,
        amount,
        ts: at(minute),
        channel: 'NEFT',
        location: null,
        is_fraud: false,
      });
    } else {
      transfer({ from: pick(background), to: id, amount: intBetween(200, 15_000), minutes: minute, channel: pick(channels) });
    }
  }

  transactions.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts) || a._id.localeCompare(b._id));

  // ---------------------------------------------------------------- features
  // Stand-ins for pipeline.py output. Values are plausible rather than trained;
  // the real numbers arrive with ml/pipeline.py.

  for (const a of accounts) {
    const own = transactions.filter((t) => t.from === a._id || t.to === a._id);
    const ins = own.filter((t) => t.to === a._id);
    const outs = own.filter((t) => t.from === a._id && t.to !== 'CASH');
    const sumIn = ins.reduce((s, t) => s + t.amount, 0);
    const sumOut = outs.reduce((s, t) => s + t.amount, 0);
    const shared = identifiers.filter((i) => i.account_ids.includes(a._id)).length;
    const fraudish = ringAccountIds.has(a._id);
    a.features = {
      amount_in: sumIn,
      amount_out: sumOut,
      txn_in: ins.length,
      txn_out: outs.length,
      pass_through: Number((sumIn ? Math.min(sumOut, sumIn) / Math.max(sumIn, 1) : 0).toFixed(3)),
      median_hold_min: fraudish ? intBetween(2, 28) : intBetween(30, 900),
      velocity_per_hr: Number(between(0.2, fraudish ? 4 : 2).toFixed(2)),
      burst_10min: fraudish ? intBetween(3, 8) : intBetween(1, 3),
      counterparty_diversity: Number(between(0.2, 0.9).toFixed(3)),
      in_degree: new Set(ins.map((t) => t.from)).size,
      out_degree: new Set(outs.map((t) => t.to)).size,
      account_age_days: Math.floor((T0 - Date.parse(a.opened_at)) / 86400000),
      atm_share: Number(
        (outs.length
          ? own.filter((t) => t.from === a._id && t.to === 'CASH').reduce((s, t) => s + t.amount, 0) / Math.max(sumOut, 1)
          : 0
        ).toFixed(3),
      ),
      shared_device_n: identifiers.filter((i) => i.type === 'device' && i.account_ids.includes(a._id)).length,
      shared_phone_n: identifiers.filter((i) => i.type === 'phone' && i.account_ids.includes(a._id)).length,
      shared_ip_n: identifiers.filter((i) => i.type === 'ip' && i.account_ids.includes(a._id)).length,
      shared_any_new_n: shared,
    };
    const base = fraudish ? between(0.62, 0.97) : between(0.02, 0.44);
    a.risk_v1 = Number(Math.min(0.99, base * 0.88).toFixed(3));
    a.risk_v2 = Number(Math.min(0.99, base + shared * 0.03).toFixed(3));
    a.signals = fraudish
      ? [
          { feature: 'pass_through', label: `Forwards ${Math.round(a.features.pass_through * 100)}% of what it receives`, weight: 0.31 },
          { feature: 'median_hold_min', label: `Median hold ${a.features.median_hold_min} min`, weight: 0.24 },
          { feature: 'shared_device_n', label: `Device shared with ${Math.max(0, a.features.shared_device_n - 1)} other accounts`, weight: 0.19 },
        ]
      : [];
  }

  // Roles per TRD section 7.5, first matching rule wins.
  const roles = {
    [SOURCE]: ['source', 'Half its inflow comes from outside the ring; earliest active member'],
    [COORDINATOR]: ['coordinator', 'Shares identifiers with 4 ring members but carries 1.2% of ring volume'],
    [CASHOUT[0]]: ['cash-out', '62% of its outflow goes to ATM cash-out'],
    [CASHOUT[1]]: ['cash-out', '58% of its outflow goes to ATM cash-out'],
    [R2[0]]: ['source', 'Receives from outside the ring, earliest active relay'],
    [R2[R2.length - 1]]: ['cash-out', '71% of its outflow goes to ATM cash-out'],
    [R3_COORD]: ['coordinator', 'Shares identifiers with 9 ring members but carries 2.1% of ring volume'],
  };
  for (const id of [...MULES, ...R2.slice(1, -1), ...R3.slice(0, 8)]) {
    roles[id] = ['mule', 'Receives from a source, forwards within 6 min, pass-through above 0.8'];
  }

  const ringIdsFor = { RING01, RING02: R2, RING03: [...R3, R3_COORD] };
  for (const [ringId, members] of Object.entries(ringIdsFor)) {
    for (const id of members) {
      const a = byId(id);
      a.ring_id = ringId;
      const [role, reason] = roles[id] ?? ['member', 'Forwarded ring money without a stronger rule matching'];
      a.role = role;
      a.role_reason = reason;
    }
  }

  // ------------------------------------------------------------------- rings

  /**
   * Ring volume is the money that entered the ring from outside, so the PRD's
   * example of 1,200,000 for a 12 lakh victim transfer holds. Summing every hop
   * instead would multiply the figure by the length of the chain and make rings
   * incomparable to each other.
   */
  function ringVolume(members) {
    const membersSet = new Set(members);
    return transactions
      .filter((t) => t.is_fraud && membersSet.has(t.to) && !membersSet.has(t.from))
      .reduce((s, t) => s + t.amount, 0);
  }

  function ringEdges(members) {
    const set = new Set(members);
    const byPair = new Map();
    for (const t of transactions) {
      if (!t.is_fraud || !set.has(t.from) || !set.has(t.to)) continue;
      const key = `${t.from}>${t.to}`;
      const prev = byPair.get(key) ?? { from: t.from, to: t.to, amount: 0, count: 0 };
      prev.amount += t.amount;
      prev.count += 1;
      byPair.set(key, prev);
    }
    return [...byPair.values()];
  }

  function ringIdentityLinks(members) {
    return identifiers
      .filter((i) => i.account_ids.filter((a) => members.includes(a)).length >= 2)
      .map((i) => ({ identifier: i._id, account_ids: i.account_ids.filter((a) => members.includes(a)) }));
  }

  function geoSpread(members) {
    const points = transactions
      .filter((t) => t.channel === 'ATM' && members.includes(t.from) && t.location)
      .map((t) => t.location);
    let max = 0;
    for (let i = 0; i < points.length; i += 1) {
      for (let j = i + 1; j < points.length; j += 1) {
        max = Math.max(max, haversineKm(points[i], points[j]));
      }
    }
    return Math.round(max);
  }

  /**
   * Proportional taint trace (TRD section 7.6). Run here so the cached default
   * stored on each ring is a conserving answer: the tainted amounts plus what
   * reached CASH equal the money that entered the ring. Only used to fill in
   * `default_taint`, which is what the API serves when Python is unreachable.
   * The live path still calls ml/taint.py.
   */
  function trace(victimTxnId, asOf = null) {
    const bal = new Map(accounts.map((a) => [a._id, a.opening_balance]));
    bal.set('CASH', 0);
    const taint = new Map();
    const flows = new Map();
    let started = false;
    for (const t of transactions) {
      if (asOf && Date.parse(t.ts) > Date.parse(asOf)) break;
      const u = t.from;
      const v = t.to;
      const share = started && (bal.get(u) ?? 0) > 0 ? (taint.get(u) ?? 0) / bal.get(u) : 0;
      const moved = t.amount * share;
      bal.set(u, (bal.get(u) ?? 0) - t.amount);
      bal.set(v, (bal.get(v) ?? 0) + t.amount);
      taint.set(u, (taint.get(u) ?? 0) - moved);
      taint.set(v, (taint.get(v) ?? 0) + moved);
      if (moved > 0) flows.set(`${u}>${v}`, (flows.get(`${u}>${v}`) ?? 0) + moved);
      if (t._id === victimTxnId) {
        taint.set(v, (taint.get(v) ?? 0) + t.amount);
        started = true;
      }
    }
    return { bal, taint, flows };
  }

  /** Latest timestamp at which any ring member moved money. */
function ringLastActivity(members) {
  const membersSet = new Set(members);
  let last = null;
  for (const t of transactions) {
    if (!membersSet.has(t.from) && !membersSet.has(t.to)) continue;
    if (!last || Date.parse(t.ts) > Date.parse(last)) last = t.ts;
  }
  return last;
}

/**
   * Rounds taint to whole rupees without losing the total. Rounding each account
   * independently drifts by a rupee or two, which breaks the conservation
   * invariant in TRD section 13, so the residual lands on the largest holder and
   * whatever is left over is reported as lost to cash.
   */
  function roundConserving(entries, total) {
    const rounded = entries.map((e) => ({ ...e, tainted: Math.round(e.tainted) }));
    const sum = rounded.reduce((s, e) => s + e.tainted, 0);
    const residual = total - sum;
    if (residual !== 0 && rounded.length) {
      const largest = rounded.reduce((a, b) => (b.tainted > a.tainted ? b : a));
      largest.tainted += residual;
    }
    return rounded;
  }

  function buildRing(ringId, members, risk, entryTxn, asOf = null) {
    const membersSet = new Set(members);
    // Default to the ring's last activity rather than the alert time: an
    // investigator opening the case wants the position now, including what has
    // already been withdrawn, so the cached answer shows money lost to cash.
    const effectiveAsOf = asOf ?? ringLastActivity(members);
    const victimAmount = entryTxn.amount;
    const { bal, taint, flows } = trace(entryTxn._id, effectiveAsOf);

    const rawTaint = [...membersSet].map((id) => ({
      id,
      balance: Math.round(bal.get(id) ?? 0),
      tainted: taint.get(id) ?? 0,
    }));
    // CASH is settled first, so the residual lands on a real account rather
    // than being silently absorbed into "lost to cash" and reporting zero.
    const lostToCash = Math.round(taint.get('CASH') ?? 0);
    const taintAccounts = roundConserving(rawTaint, victimAmount - lostToCash)
      .map((a) => ({ ...a, lien: Math.min(a.tainted, a.balance) }))
      .sort((a, b) => b.tainted - a.tainted);

    // Brute-force k of 3, matching the approach TRD section 7.7 prescribes for
    // rings this small. Used only to fill the cached default.
    const freezeCandidates = taintAccounts.filter((a) => a.tainted > 0);
    const atRiskBefore = taintAccounts.reduce((s, a) => s + a.tainted, 0);
    let best = { freeze: [], secured: 0 };
    const k = Math.min(3, freezeCandidates.length);
    const combos = [];
    const build = (start, acc2) => {
      if (acc2.length === k) {
        combos.push(acc2);
        return;
      }
      for (let i = start; i < freezeCandidates.length; i += 1) build(i + 1, [...acc2, freezeCandidates[i]]);
    };
    build(0, []);
    for (const combo of combos) {
      const secured = combo.reduce((s, a) => s + a.tainted, 0);
      if (secured > best.secured) best = { freeze: combo.map((a) => a.id), secured };
    }

    return {
      _id: ringId,
      member_ids: members,
      edges: ringEdges(members),
      identity_links: ringIdentityLinks(members),
      volume: ringVolume(members),
      risk,
      geo_spread_km: geoSpread(members),
      victim_txn_ids: [entryTxn._id],
      default_taint: {
        victim_amount: victimAmount,
        as_of: effectiveAsOf,
        accounts: taintAccounts,
        lost_to_cash: lostToCash,
        links: [...flows.entries()].map(([key, value]) => {
          const [source, target] = key.split('>');
          return { source, target, value: Math.round(value) };
        }),
      },
      default_freeze: {
        freeze: best.freeze,
        at_risk_before: atRiskBefore,
        secured: best.secured,
        pct_stopped: atRiskBefore ? Number((best.secured / atRiskBefore).toFixed(3)) : 0,
        k,
      },
    };
  }

  const ring2AlertAt = transactions.find((t) => t._id && t.is_fraud && t.from === R2[1])?.ts ?? at(11 * 60 + 20);
  const ring3AlertAt = at(12 * 60 + 12);

  // Each ring is attributed the money that entered it, so all three have a
  // self-consistent victim amount and cached taint rather than borrowing
  // RING01's 12 lakh.
  const rings = [
    buildRing('RING01', RING01, 0.91, victimTxn),
    buildRing('RING02', R2, 0.84, r2Entry),
    buildRing('RING03', [...R3, R3_COORD], 0.78, r3Entry),
  ];

  // ------------------------------------------------------------------ alerts

  const alerts = [
    {
      _id: 'ALT01',
      ring_id: 'RING01',
      fired_at: ring1AlertAt,
      reason: '6 linked accounts forwarding within minutes',
    },
    {
      _id: 'ALT02',
      ring_id: 'RING02',
      fired_at: ring2AlertAt,
      reason: '4 accounts chained by shared device, each hop under 4 min',
    },
    {
      _id: 'ALT03',
      ring_id: 'RING03',
      fired_at: ring3AlertAt,
      reason: '9 accounts opened within days of each other on 3 shared devices',
    },
  ];

  // ----------------------------------------------------------------- recruits

  const recruits = [
    {
      ring_id: 'RING01',
      recruits: [
        {
          id: ACCOUNT_E,
          probability: 0.82,
          reasons: ['Shares device DEV017 with ACC0051', 'Account is 2 days old', 'No transactions yet'],
        },
        {
          id: acc(318),
          probability: 0.41,
          reasons: ['Shares phone PHN042 with ACC0042', 'Median hold 9 min', 'Forwards 88% of what it receives'],
        },
        {
          id: acc(325),
          probability: 0.28,
          reasons: ['Shares IP033 with ACC0057', 'Opened 5 days before first transaction'],
        },
      ],
    },
    { ring_id: 'RING02', recruits: [] },
    {
      ring_id: 'RING03',
      recruits: [
        { id: acc(222), probability: 0.55, reasons: ['Shares device DEV201 with ACC0201', 'No transactions yet'] },
      ],
    },
  ];

  // ----------------------------------------------------------------- metrics

  const metrics = {
    rows: [
      { model: 'V1 transaction only', pr_auc: 0.61, ring_recall: 0.88, pattern_d_recall: null },
      { model: 'V2 with identity', pr_auc: 0.79, ring_recall: 0.94, pattern_d_recall: null },
    ],
    note: 'Synthetic data, rings planted by the team. Dev fixtures, not a trained run.',
  };

  return {
    accounts,
    identifiers,
    transactions,
    rings,
    alerts,
    recruits,
    metrics,
    ground_truth: {
      profile: 'dev-fixtures',
      victim_txn_id: victimTxn._id,
      account_e: ACCOUNT_E,
      ring_members: Object.fromEntries(Object.entries(ringIdsFor).map(([k, v]) => [k, v])),
    },
  };
}