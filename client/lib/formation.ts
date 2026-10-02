// Lays a ring out as a flow diagram read left to right: the victim on the
// left, one column per hop of the money, "Cash withdrawn" on the right.
// Accounts the money never reaches (a coordinator) sit in a row above.

import type { RingDetail, Role } from "./types";

export interface FormationNode {
  id: string;
  type: "account" | "victim" | "cash";
  role?: Role;
  risk: number;
  x: number;
  y: number;
}

export interface Formation {
  /** Extent of the node centres; the layout is centred on the origin. */
  width: number;
  height: number;
  nodes: FormationNode[];
  flows: { from: string; to: string; amount: number }[];
  /** Pairs of accounts that share a device, phone or IP. */
  links: [string, string][];
}

/** Distance between columns and between rows, in layout units. */
export const COL = 120;
export const ROW = 50;

const mean = (values: number[]) => values.reduce((s, v) => s + v, 0) / (values.length || 1);

export function buildFormation(ring: RingDetail): Formation {
  const people = ring.nodes.filter((n) => n.type === "account" || n.type === "victim");
  const known = new Set(people.map((n) => n.id));
  const flows = ring.edges
    .filter((e) => e.kind === "txn")
    .map((e) => ({ from: e.source, to: e.target, amount: e.amount ?? 0 }));
  const transfers = flows.filter((f) => known.has(f.from) && known.has(f.to));

  // Where the money starts: the victims, or failing that whoever is paid by nobody.
  let seeds = people.filter((n) => n.type === "victim").map((n) => n.id);
  if (!seeds.length) seeds = people.filter((n) => !transfers.some((f) => f.to === n.id)).map((n) => n.id);
  if (!seeds.length && people.length) seeds = [people[0].id];

  // Hop distance from the start along money flows.
  const hop = new Map<string, number>(seeds.map((id) => [id, 0]));
  let frontier = seeds;
  while (frontier.length) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const f of transfers) {
        if (f.from === id && !hop.has(f.to)) {
          hop.set(f.to, hop.get(id)! + 1);
          next.push(f.to);
        }
      }
    }
    frontier = next;
  }

  // An account's column is one past the last account that pays it, so money
  // always reads left to right. Transfers that run backwards are ignored here,
  // which keeps a ring that pays in circles from looping forever.
  const forward = transfers.filter((f) => {
    const a = hop.get(f.from);
    const b = hop.get(f.to);
    return a !== undefined && b !== undefined && (a < b || (a === b && f.from < f.to));
  });
  const col = new Map<string, number>(seeds.map((id) => [id, 0]));
  for (let pass = 0; pass < people.length; pass++) {
    let changed = false;
    for (const f of forward) {
      const from = col.get(f.from);
      if (from === undefined || (col.get(f.to) ?? -1) > from) continue;
      col.set(f.to, from + 1);
      changed = true;
    }
    if (!changed) break;
  }
  const last = Math.max(0, ...col.values());

  const at = new Map<string, { x: number; y: number }>();
  for (let c = 0; c <= last; c++) {
    // Each account stands level with whoever paid it, so the lines cross as little as possible.
    const members = people
      .filter((n) => col.get(n.id) === c)
      .map((n) => {
        const payers = forward.filter((f) => f.to === n.id && at.has(f.from)).map((f) => at.get(f.from)!.y);
        return { id: n.id, lean: payers.length ? mean(payers) : 0 };
      })
      .sort((a, b) => a.lean - b.lean || a.id.localeCompare(b.id));
    members.forEach((m, i) => at.set(m.id, { x: c * COL, y: (i - (members.length - 1) / 2) * ROW }));
  }

  // Accounts that share an identifier, per identifier.
  const sharing = ring.nodes
    .filter((n) => n.type === "device" || n.type === "phone" || n.type === "ip")
    .map((idNode) =>
      ring.edges
        // The identifier may be at either end of the edge, depending on who built the graph.
        .filter((e) => e.kind === "identity" && (e.target === idNode.id || e.source === idNode.id))
        .map((e) => (e.target === idNode.id ? e.source : e.target))
        .filter((account) => known.has(account)),
    );

  // Accounts the money never reaches stand in a row above, over whoever they share an identifier with.
  const top = Math.min(0, ...[...at.values()].map((p) => p.y)) - ROW * 1.2;
  const loose = people
    .filter((n) => !at.has(n.id))
    .map((n) => {
      const peers = sharing
        .filter((group) => group.includes(n.id))
        .flat()
        .filter((id) => at.has(id))
        .map((id) => at.get(id)!.x);
      return { id: n.id, x: peers.length ? mean(peers) : (last * COL) / 2 };
    })
    .sort((a, b) => a.x - b.x || a.id.localeCompare(b.id));
  loose.forEach((n, i) => {
    const x = i ? Math.max(n.x, loose[i - 1].x + COL * 0.6) : n.x;
    n.x = x;
    at.set(n.id, { x, y: top });
  });

  const nodes: FormationNode[] = people.map((n) => ({
    id: n.id,
    type: n.type as "account" | "victim",
    role: n.role,
    risk: n.risk ?? 0.5,
    ...at.get(n.id)!,
  }));

  const toCash = flows.filter((f) => f.to === "CASH" && at.has(f.from)).map((f) => at.get(f.from)!);
  if (toCash.length) {
    const x = Math.max(last * COL, ...toCash.map((p) => p.x)) + COL;
    nodes.push({ id: "CASH", type: "cash", risk: 0.5, x, y: mean(toCash.map((p) => p.y)) });
  }

  const links: [string, string][] = [];
  const linked = new Set<string>();
  for (const group of sharing) {
    const ordered = [...new Set(group)].sort((a, b) => at.get(a)!.x - at.get(b)!.x || at.get(a)!.y - at.get(b)!.y);
    for (let i = 1; i < ordered.length; i++) {
      const key = `${ordered[i - 1]}|${ordered[i]}`;
      if (linked.has(key)) continue;
      linked.add(key);
      links.push([ordered[i - 1], ordered[i]]);
    }
  }

  // Centre the layout on the origin.
  const xs = nodes.map((n) => n.x);
  const ys = nodes.map((n) => n.y);
  const x0 = Math.min(0, ...xs);
  const x1 = Math.max(0, ...xs);
  const y0 = Math.min(0, ...ys);
  const y1 = Math.max(0, ...ys);
  for (const n of nodes) {
    n.x -= (x0 + x1) / 2;
    n.y -= (y0 + y1) / 2;
  }

  return { width: x1 - x0, height: y1 - y0, nodes, flows, links };
}

/** Start angle and sweep of layer `k`'s arc in the Chakravyuh mark: a full circle with one gate, each gate turned from the last. */
export const GATE = 0.5;
export function gateStart(layer: number) {
  return layer * 2.1 + GATE / 2;
}
