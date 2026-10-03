// Taint tracing and the freeze optimiser, ported from ml/taint.py and
// ml/freeze.py so the mock API answers the same questions the Python service
// does (TRD 7.6 and 7.7). Money is handled in integer paise, as it is there.

import type { FreezeRequest, FreezeResult, TaintResult, Txn } from "../types";
import { mockAccounts, mockRings, mockTransactions } from "./data";

const CASH = "CASH";
const BOTTOMLESS = 10 ** 15;
const paise = (rupees: number) => Math.round(rupees * 100);
const rupees = (p: number) => p / 100;
const isSpecial = (id: string) => id === CASH || id === "SALARY" || id.startsWith("VICTIM");

interface Trace {
  balance: Map<string, number>;
  taint: Map<string, number>;
  flows: Map<string, number>;
  victimAmount: number;
}

/** Proportional rule: money leaving an account carries the tainted share of its balance at that moment. */
function trace(transactions: Txn[], victimTxnId: string, asOf?: string): Trace {
  const balance = new Map<string, number>();
  for (const a of mockAccounts.values()) balance.set(a.id, paise(a.opening_balance));
  const taint = new Map<string, number>();
  const flows = new Map<string, number>();
  let started = false;
  let victimAmount = 0;

  for (const t of transactions) {
    if (asOf && t.ts > asOf) break;
    const x = paise(t.amount);
    const fromBalance = balance.get(t.from) ?? (t.from === "SALARY" || t.from.startsWith("VICTIM") ? BOTTOMLESS : 0);
    const held = taint.get(t.from) ?? 0;
    // The product can pass 2^53, so it is done in BigInt.
    const moved = started && fromBalance > 0 && held > 0 ? Number((BigInt(x) * BigInt(held)) / BigInt(fromBalance)) : 0;

    balance.set(t.from, fromBalance - x);
    balance.set(t.to, (balance.get(t.to) ?? 0) + x);
    if (moved > 0) {
      taint.set(t.from, held - moved);
      taint.set(t.to, (taint.get(t.to) ?? 0) + moved);
      const key = `${t.from}>${t.to}`;
      flows.set(key, (flows.get(key) ?? 0) + moved);
    }
    if (t.id === victimTxnId) {
      // The victim's money is 100% tainted.
      taint.set(t.to, (taint.get(t.to) ?? 0) + x);
      victimAmount = x;
      started = true;
    }
  }
  return { balance, taint, flows, victimAmount };
}

export function taintFor(ringId: string, txn?: string, asOf?: string): TaintResult {
  const ring = mockRings.get(ringId);
  const victimTxn = txn ?? ring?.victim_txn_ids[0];
  const empty: TaintResult = { victim_amount: 0, as_of: asOf ?? null, cached: false, accounts: [], lost_to_cash: 0, links: [] };
  if (!ring || !victimTxn) return empty;
  const t = trace(mockTransactions, victimTxn, asOf);
  if (!t.victimAmount) return empty;
  return {
    victim_amount: rupees(t.victimAmount),
    as_of: asOf ?? null,
    cached: false,
    accounts: [...t.taint]
      .filter(([id, held]) => held > 0 && !isSpecial(id))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, held]) => {
        const balance = Math.max(t.balance.get(id) ?? 0, 0);
        return { id, balance: rupees(balance), tainted: rupees(held), lien: rupees(Math.min(held, balance)) };
      }),
    lost_to_cash: rupees(t.taint.get(CASH) ?? 0),
    links: [...t.flows]
      .filter(([, value]) => value > 0)
      .map(([key, value]) => {
        const [source, target] = key.split(">");
        return { source, target, value: rupees(value) };
      }),
  };
}

/** Channels the ring has used: who has sent to whom, including to cash. */
function channels(members: Set<string>, asOf?: string) {
  const out = new Map<string, Set<string>>();
  for (const t of mockTransactions) {
    if (asOf && t.ts > asOf) break;
    if (!members.has(t.from) || !(members.has(t.to) || t.to === CASH)) continue;
    if (!out.has(t.from)) out.set(t.from, new Set());
    out.get(t.from)!.add(t.to);
  }
  return out;
}

function reachesCash(start: string, graph: Map<string, Set<string>>, frozen: Set<string>) {
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    for (const next of graph.get(queue.pop()!) ?? []) {
      if (next === CASH) return true;
      if (frozen.has(next) || seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return false;
}

/** Tainted money in accounts that can still send it to cash, with `frozen` frozen. */
function atRiskWith(taint: Map<string, number>, graph: Map<string, Set<string>>, frozen: Set<string>) {
  let total = 0;
  for (const [id, held] of taint) {
    if (held > 0 && !isSpecial(id) && !frozen.has(id) && reachesCash(id, graph, frozen)) total += held;
  }
  return total;
}

/**
 * Tainted money that freezing `frozen` keeps from reaching cash: what was at
 * risk before, less what still is. (As in ml/freeze.py: counting every account
 * that cannot reach cash would include money that never could.)
 */
function secured(taint: Map<string, number>, graph: Map<string, Set<string>>, frozen: Set<string>) {
  return atRiskWith(taint, graph, new Set()) - atRiskWith(taint, graph, frozen);
}

function* combinations<T>(items: T[], size: number, from = 0, picked: T[] = []): Generator<T[]> {
  if (picked.length === size) {
    yield picked;
    return;
  }
  for (let i = from; i < items.length; i++) yield* combinations(items, size, i + 1, [...picked, items[i]]);
}

export function freezeFor(ringId: string, request: FreezeRequest): FreezeResult {
  const ring = mockRings.get(ringId);
  const victimTxn = request.txn ?? ring?.victim_txn_ids[0];
  const none: FreezeResult = { freeze: [], at_risk_before: 0, secured: 0, pct_stopped: 0, cached: false };
  if (!ring || !victimTxn) return none;

  const { taint } = trace(mockTransactions, victimTxn, request.as_of);
  const members = new Set(ring.member_ids);
  const graph = channels(members, request.as_of);
  const nobody = new Set<string>();

  let atRisk = 0;
  for (const [id, held] of taint) {
    if (held > 0 && !isSpecial(id) && reachesCash(id, graph, nobody)) atRisk += held;
  }
  if (!atRisk) return none;

  const excluded = new Set(request.exclude);
  const freezable = ring.member_ids.filter((id) => !excluded.has(id) && (taint.get(id) ?? 0) > 0);
  let best: string[] = [];
  let bestSecured = 0;

  if (freezable.length <= 15) {
    // Small ring: try every set of up to k accounts, which gives the exact answer.
    for (let size = 1; size <= Math.min(request.k, freezable.length); size++) {
      for (const combo of combinations(freezable, size)) {
        const s = secured(taint, graph, new Set(combo));
        if (s > bestSecured) {
          bestSecured = s;
          best = combo;
        }
      }
    }
  } else {
    // Large ring: add the single best account, one at a time.
    const frozen = new Set<string>();
    for (let i = 0; i < Math.min(request.k, freezable.length); i++) {
      let pick: string | null = null;
      for (const id of freezable) {
        if (frozen.has(id)) continue;
        const s = secured(taint, graph, new Set([...frozen, id]));
        if (s > bestSecured) {
          bestSecured = s;
          pick = id;
        }
      }
      if (!pick) break;
      frozen.add(pick);
    }
    best = [...frozen].sort();
  }

  return {
    freeze: best,
    at_risk_before: rupees(atRisk),
    secured: rupees(bestSecured),
    pct_stopped: Math.round((bestSecured / atRisk) * 10000) / 10000,
    cached: false,
  };
}
