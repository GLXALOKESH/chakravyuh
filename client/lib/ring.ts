// The API's ring graph holds the ring's accounts and their shared identifiers.
// A formation also needs a centre (the victim) and a rim (cash withdrawn), so
// both are added here, on the client, from what is already known.

import type { RingDetail, RingEdge, RingNode, Txn } from "./types";

export const CASH = "CASH";

/** Accounts that are not real customers: the cash sink, the salary source, a victim stand-in. */
export const isPseudoAccount = (id: string) => id === CASH || id === "SALARY";

/**
 * Returns the ring with a victim node at the start of the money and a cash
 * node at the end.
 *
 * `victimTxns` are the ring's victim transactions when the replay has seen
 * them, which gives the victim's real account. Without them (a ring page
 * opened on its own) a stand-in victim is linked to the ring's source accounts.
 */
export function completeRing(detail: RingDetail, victimTxns: Txn[] = []): RingDetail {
  const accounts = detail.nodes.filter((n) => n.type === "account");
  const flows = detail.edges.filter((e) => e.kind === "txn");
  const nodes: RingNode[] = [...detail.nodes];
  const edges: RingEdge[] = [...detail.edges];
  const members = new Set(accounts.map((a) => a.id));

  const real = victimTxns.filter((t) => members.has(t.to) && !members.has(t.from));
  if (real.length) {
    for (const from of new Set(real.map((t) => t.from))) nodes.push({ id: from, type: "victim" });
    for (const t of real) edges.push({ source: t.from, target: t.to, kind: "txn", amount: t.amount });
  } else {
    // Whoever is named a source, or failing that whoever nobody in the ring pays.
    const paid = new Set(flows.map((e) => e.target));
    const named = accounts.filter((a) => a.role === "source");
    const sources = named.length ? named : accounts.filter((a) => !paid.has(a.id));
    const victim = `VICTIM:${detail.id}`;
    nodes.push({ id: victim, type: "victim" });
    for (const s of sources.length ? sources : accounts.slice(0, 1)) {
      const out = flows.filter((e) => e.source === s.id).reduce((sum, e) => sum + (e.amount ?? 0), 0);
      edges.push({ source: victim, target: s.id, kind: "txn", amount: out || detail.volume });
    }
  }

  const cashers = accounts.filter((a) => a.role === "cashout");
  if (cashers.length) {
    nodes.push({ id: CASH, type: "cash" });
    for (const c of cashers) {
      const received = flows.filter((e) => e.target === c.id).reduce((sum, e) => sum + (e.amount ?? 0), 0);
      edges.push({ source: c.id, target: CASH, kind: "txn", amount: received });
    }
  }
  return { ...detail, nodes, edges };
}
