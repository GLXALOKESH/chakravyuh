/**
 * The live run, in memory (docs/STREAMING.md).
 *
 * Everything the generator sends and the predictor answers is kept here for
 * the length of one run, and served under /api/live in the same shapes as
 * the stored-data routes, through the same mappers. Nothing is written to
 * MongoDB: a run produces tens of thousands of writes in minutes, which the
 * Atlas free tier's 100 operations a second cannot take
 * (docs/tests/03-THROUGHPUT-STRATEGY.md), and a run is over when it is over.
 *
 * Money arrives in integer paise and leaves in rupees, converted in one place
 * (`rupees` below), the way ml/run.py's paise_to_rupees does it.
 *
 * Ground truth (`gt` on each transaction, the `truth` lines) is held only to
 * score the predictor in liveMetrics(). It is never part of any response.
 */
import { toAccountRole } from '../constants/index.js';
import { toAccountDetail, toRingGeo, toRingGraph } from '../mappers/api.mapper.js';
import type {
  Account,
  AccountDetail,
  AlertWithRing,
  FreezePayload,
  GeoPoint,
  Identifier,
  Ring,
  RingGeo,
  RingGraph,
  TaintPayload,
  Transaction,
} from '../interfaces/domain.interface.js';
import type { IdentifierTypeValue } from '../constants/index.js';

/** Whole rupees from integer paise, rounding half up. Never negative. */
export const rupees = (paise: number): number => Math.max(0, Math.round(paise / 100));

export const SALARY = 'SALARY';

export interface LiveAccount {
  id: string;
  holder: string | null;
  bank: string | null;
  home: GeoPoint | null;
  opened_at: string | null;
  opening_balance_paise: number;
}

export interface LiveTxn {
  id: string;
  from: string;
  to: string;
  amount_paise: number;
  ts: string;
  channel: string;
  location: GeoPoint | null;
}

export interface LiveScore {
  id: string;
  risk: number;
  risk_v1: number;
  risk_v2: number;
  band: string;
  provisional: boolean;
  signals?: { feature: string; label: string; weight: number }[];
}

/** A ring as the predictor sends it: paise, roles keyed by account. */
export interface PredictorRing {
  id: string;
  version: number;
  member_ids: string[];
  roles: Record<string, { role: string; role_reason: string }>;
  edges: { from: string; to: string; amount: number; count: number }[];
  identity_links: { identifier: string; type: IdentifierTypeValue; account_ids: string[] }[];
  volume_paise: number;
  risk: number;
  victim_txn_ids: string[];
  first_seen: string | null;
}

export interface PredictorAlert {
  id: string;
  ring_id: string;
  fired_at: string;
  reason: string;
}

export interface Truth {
  ring: string;
  pattern: string;
  member_ids: string[];
  victim_txn_id: string;
  victim_amount_paise: number;
  planted_at: string;
}

/** A live alert: the stored-data alert shape, plus whether cash had already left. */
export interface LiveAlert extends AlertWithRing {
  before_cashout: boolean;
}

export interface LiveMetrics {
  planted: number;
  caught: number;
  missed: number;
  false_rings: number;
  median_minutes_to_alert: number | null;
  caught_before_cashout: number;
  flagged_accounts: number;
  flagged_in_rings: number;
  note: string;
}

const jaccard = (a: Set<string>, b: Set<string>): number => {
  let both = 0;
  for (const x of a) if (b.has(x)) both += 1;
  return both / Math.max(1, a.size + b.size - both);
};

export class LiveStore {
  runId: string | null = null;
  seed: number | null = null;
  rate: number | null = null;
  simStart: string | null = null;
  simEnd: string | null = null;
  clock: string | null = null;

  readonly accounts = new Map<string, LiveAccount>();
  readonly identifiers = new Map<string, { type: IdentifierTypeValue; accounts: Set<string> }>();
  readonly identifiersOf = new Map<string, Set<string>>();
  readonly txns: LiveTxn[] = [];
  readonly txnsOf = new Map<string, LiveTxn[]>();
  /** Accounts the dashboard has seen in a transaction (salary credits do not count). */
  readonly seen = new Set<string>();
  readonly scores = new Map<string, LiveScore>();
  readonly rings = new Map<string, PredictorRing>();
  readonly ringOf = new Map<string, string>();
  readonly alerts: LiveAlert[] = [];
  readonly truth = new Map<string, Truth>();
  readonly fraudTxns = new Set<string>();
  readonly taintCache = new Map<string, TaintPayload>();
  readonly freezeCache = new Map<string, FreezePayload>();

  reset(runId: string | null): void {
    this.runId = runId;
    this.seed = this.rate = null;
    this.simStart = this.simEnd = this.clock = null;
    for (const store of [this.accounts, this.identifiers, this.identifiersOf, this.txnsOf, this.scores, this.rings, this.ringOf, this.truth, this.taintCache, this.freezeCache]) {
      store.clear();
    }
    this.seen.clear();
    this.fraudTxns.clear();
    this.txns.length = 0;
    this.alerts.length = 0;
  }

  // ---- writes ------------------------------------------------------------

  addAccount(account: LiveAccount): void {
    this.accounts.set(account.id, account);
  }

  addIdentifier(id: string, type: IdentifierTypeValue, accountId: string): void {
    const rec = this.identifiers.get(id) ?? { type, accounts: new Set<string>() };
    rec.accounts.add(accountId);
    this.identifiers.set(id, rec);
    const mine = this.identifiersOf.get(accountId) ?? new Set<string>();
    mine.add(id);
    this.identifiersOf.set(accountId, mine);
  }

  addTxn(txn: LiveTxn, isFraud: boolean): void {
    this.txns.push(txn);
    for (const side of [txn.from, txn.to]) {
      const list = this.txnsOf.get(side) ?? [];
      list.push(txn);
      this.txnsOf.set(side, list);
    }
    if (txn.from !== SALARY) {
      this.seen.add(txn.from);
      this.seen.add(txn.to);
    }
    if (isFraud) this.fraudTxns.add(txn.id);
  }

  setScores(scores: LiveScore[]): void {
    for (const s of scores) this.scores.set(s.id, s);
  }

  /** True when this version is news. */
  upsertRing(ring: PredictorRing): boolean {
    const known = this.rings.get(ring.id);
    if (known && known.version >= ring.version) return false;
    this.rings.set(ring.id, ring);
    for (const member of ring.member_ids) this.ringOf.set(member, ring.id);
    return true;
  }

  /** The alert as the dashboard receives it, or null if this ring has one already. */
  addAlert(alert: PredictorAlert): LiveAlert | null {
    if (this.alerts.some((a) => a.ring_id === alert.ring_id)) return null;
    const ring = this.rings.get(alert.ring_id);
    const members = new Set(ring?.member_ids ?? []);
    const cashedOut = this.txns.some((t) => t.to === 'CASH' && members.has(t.from) && t.ts <= alert.fired_at);
    const live: LiveAlert = {
      id: alert.id,
      ring_id: alert.ring_id,
      fired_at: alert.fired_at,
      reason: alert.reason,
      risk: ring?.risk ?? null,
      members: ring?.member_ids.length ?? 0,
      volume: ring ? rupees(ring.volume_paise) : null,
      before_cashout: !cashedOut,
    };
    this.alerts.unshift(live);
    return live;
  }

  // ---- reads, in the stored-data shapes -------------------------------------

  /** A transaction as the dashboard receives it. */
  clientTxn(t: LiveTxn): Transaction {
    return { id: t.id, from: t.from, to: t.to, amount: rupees(t.amount_paise), ts: t.ts, channel: t.channel, location: t.location };
  }

  private asRing(r: PredictorRing): Ring {
    return {
      id: r.id,
      member_ids: r.member_ids,
      edges: r.edges.map((e) => ({ ...e, amount: rupees(e.amount) })),
      identity_links: r.identity_links.map((l) => ({ identifier: l.identifier, account_ids: l.account_ids })),
      volume: rupees(r.volume_paise),
      risk: r.risk,
      geo_spread_km: 0,
      victim_txn_ids: r.victim_txn_ids,
      default_taint: this.taintCache.get(r.id) ?? null,
      default_freeze: this.freezeCache.get(r.id) ?? null,
    };
  }

  ring(id: string): Ring | null {
    const r = this.rings.get(id);
    return r ? this.asRing(r) : null;
  }

  ringGraph(id: string): (RingGraph & { version: number }) | null {
    const r = this.rings.get(id);
    if (!r) return null;
    const members = r.member_ids.map((m) => ({ id: m, role: r.roles[m]?.role ?? 'member', risk_v2: this.scores.get(m)?.risk_v2 ?? null }));
    const identifiers: Identifier[] = r.identity_links.map((l) => ({ id: l.identifier, type: l.type, account_ids: l.account_ids }));
    return { ...toRingGraph(this.asRing(r), members, identifiers), version: r.version };
  }

  private asAccount(id: string): Account | null {
    const a = this.accounts.get(id);
    if (!a) return null;
    const score = this.scores.get(id);
    const ringId = this.ringOf.get(id) ?? null;
    const role = ringId ? this.rings.get(ringId)?.roles[id] : undefined;
    return {
      id,
      holder: a.holder,
      bank: a.bank,
      home: a.home,
      opened_at: a.opened_at,
      opening_balance: rupees(a.opening_balance_paise),
      features: {},
      risk_v1: score?.risk_v1 ?? null,
      risk_v2: score?.risk_v2 ?? null,
      signals: score?.signals ?? [],
      ring_id: ringId,
      role: toAccountRole(role?.role),
      role_reason: role?.role_reason ?? null,
    };
  }

  accountDetail(id: string): AccountDetail | null {
    const account = this.asAccount(id);
    if (!account) return null;
    const linked: Identifier[] = [...(this.identifiersOf.get(id) ?? [])].map((iid) => {
      const rec = this.identifiers.get(iid)!;
      return { id: iid, type: rec.type, account_ids: [...rec.accounts].sort() };
    });
    const recent = (this.txnsOf.get(id) ?? []).slice(-20).reverse().map((t) => this.clientTxn(t));
    return toAccountDetail(account, linked, recent);
  }

  ringGeo(id: string): RingGeo | null {
    const ring = this.ring(id);
    if (!ring) return null;
    const members = ring.member_ids.flatMap((m) => this.asAccount(m) ?? []);
    const memberSet = new Set(ring.member_ids);
    const cashouts = this.txns.filter((t) => t.to === 'CASH' && memberSet.has(t.from) && t.location).map((t) => this.clientTxn(t));
    return toRingGeo(ring, members, cashouts);
  }

  /** The live run's transactions for the taint and freeze engines, in paise. */
  ledger(): LiveTxn[] {
    return this.txns;
  }

  // ---- scoring the predictor against the generator's ground truth ----------------

  liveMetrics(): LiveMetrics {
    const live = [...this.rings.values()].map((r) => ({ id: r.id, members: new Set(r.member_ids) }));
    const matched = new Set<string>();
    const minutes: number[] = [];
    let caught = 0;
    let beforeCashout = 0;
    // A ring counts once its victim's money has arrived; before that there is
    // nothing anyone could have seen. The generator announces rings ahead.
    const due = [...this.truth.values()].filter((t) => !this.clock || t.planted_at <= this.clock);
    for (const t of due) {
      const planted = new Set(t.member_ids);
      let best: { id: string; score: number } | null = null;
      for (const r of live) {
        const score = jaccard(planted, r.members);
        if (!best || score > best.score) best = { id: r.id, score };
      }
      if (!best || best.score < 0.5) continue;
      caught += 1;
      matched.add(best.id);
      const alert = this.alerts.find((a) => a.ring_id === best!.id);
      if (alert?.fired_at) {
        minutes.push((Date.parse(alert.fired_at) - Date.parse(t.planted_at)) / 60_000);
        if (alert.before_cashout) beforeCashout += 1;
      }
    }
    const fraudAccounts = new Set([...this.truth.values()].flatMap((t) => t.member_ids));
    const flagged = [...this.scores.values()].filter((s) => s.risk_v2 >= 0.5);
    minutes.sort((a, b) => a - b);
    return {
      planted: due.length,
      caught,
      missed: due.length - caught,
      false_rings: live.filter((r) => !matched.has(r.id)).length,
      median_minutes_to_alert: minutes.length ? Math.round(minutes[Math.floor(minutes.length / 2)]!) : null,
      caught_before_cashout: beforeCashout,
      flagged_accounts: flagged.length,
      flagged_in_rings: flagged.filter((s) => fraudAccounts.has(s.id)).length,
      note: 'Scored against the generator’s ground truth, which only the server sees.',
    };
  }
}
