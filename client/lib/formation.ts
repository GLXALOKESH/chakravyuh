// Turns a ring into the formation it is drawn as: the victim at the centre,
// one concentric layer per hop of the money, "Cash withdrawn" on the rim.

import type { RingDetail, Role } from "./types";

export interface FormationNode {
  id: string;
  type: "account" | "victim" | "cash";
  role?: Role;
  risk: number;
  /** 0 is the centre; `layers` is the rim. */
  layer: number;
  angle: number;
}

export interface Formation {
  /** Number of arcs, counting the cash rim. */
  layers: number;
  nodes: FormationNode[];
  flows: { from: string; to: string; amount: number }[];
  /** Pairs of accounts that share a device, phone or IP. */
  links: [string, string][];
}

function circularMean(angles: number[]) {
  const x = angles.reduce((s, a) => s + Math.cos(a), 0);
  const y = angles.reduce((s, a) => s + Math.sin(a), 0);
  return Math.atan2(y, x);
}

export function buildFormation(ring: RingDetail, turn = 0): Formation {
  const people = ring.nodes.filter((n) => n.type === "account" || n.type === "victim");
  const victim = people.find((n) => n.type === "victim");
  const flows = ring.edges
    .filter((e) => e.kind === "txn")
    .map((e) => ({ from: e.source, to: e.target, amount: e.amount ?? 0 }));

  // Hop distance from the victim along money flows.
  const depth = new Map<string, number>();
  if (victim) depth.set(victim.id, 0);
  let frontier = victim ? [victim.id] : [];
  while (frontier.length) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const f of flows) {
        if (f.from === id && f.to !== "CASH" && !depth.has(f.to)) {
          depth.set(f.to, depth.get(id)! + 1);
          next.push(f.to);
        }
      }
    }
    frontier = next;
  }
  const outer = Math.max(1, ...depth.values());
  // Accounts the money never reaches (a coordinator) stand on the outer layer.
  for (const n of people) if (!depth.has(n.id)) depth.set(n.id, outer);
  const layers = outer + 1;

  const angle = new Map<string, number>();
  const nodes: FormationNode[] = [];
  let lastCount = 0;
  for (let layer = 0; layer <= outer; layer++) {
    const offset = -Math.PI / 2 + turn + layer * 0.7;
    const members = people
      .filter((n) => depth.get(n.id) === layer)
      .map((n) => {
        const parents = flows
          .filter((f) => f.to === n.id && angle.has(f.from) && depth.get(f.from)! > 0)
          .map((f) => angle.get(f.from)!);
        return { n, lean: parents.length ? circularMean(parents) : null };
      })
      .sort((a, b) => a.n.id.localeCompare(b.n.id));

    // Accounts stand near whoever paid them, kept a minimum distance apart, so
    // money reads as moving outwards instead of criss-crossing the formation.
    const gap = Math.min((Math.PI * 2) / members.length, 0.75);
    const led = members.filter((m) => m.lean !== null);
    const centre = led.length ? circularMean(led.map((m) => m.lean!)) : offset;
    const rel = (a: number) => Math.atan2(Math.sin(a - centre), Math.cos(a - centre));
    led.sort((a, b) => rel(a.lean!) - rel(b.lean!));
    const placed: number[] = [];
    led.forEach((m, i) => placed.push(i ? Math.max(rel(m.lean!), placed[i - 1] + gap) : rel(m.lean!)));
    const drift = placed.length
      ? led.reduce((s, m) => s + rel(m.lean!), 0) / led.length - placed.reduce((s, a) => s + a, 0) / placed.length
      : 0;
    // A chain of single accounts winds round the layers instead of running straight out.
    const wind = members.length === 1 && lastCount === 1 ? 0.85 : 0;
    const spot = new Map(led.map((m, i) => [m.n.id, centre + placed[i] + drift + wind]));
    for (const m of members.filter((x) => x.lean === null)) {
      // No payer on the stage (a coordinator): take the middle of the widest opening.
      const taken = [...spot.values()].sort((a, b) => a - b);
      let at = offset;
      let widest = -1;
      taken.forEach((a, i) => {
        const next = i + 1 < taken.length ? taken[i + 1] : taken[0] + Math.PI * 2;
        if (next - a > widest) {
          widest = next - a;
          at = a + (next - a) / 2;
        }
      });
      spot.set(m.n.id, at);
    }
    lastCount = members.length;

    members.forEach(({ n }) => {
      const a = spot.get(n.id)!;
      angle.set(n.id, a);
      nodes.push({
        id: n.id,
        type: n.type as "account" | "victim",
        role: n.role,
        risk: n.risk ?? 0.5,
        layer,
        angle: a,
      });
    });
  }

  const toCash = flows.filter((f) => f.to === "CASH").map((f) => angle.get(f.from)!);
  if (toCash.length) {
    nodes.push({ id: "CASH", type: "cash", risk: 0.5, layer: layers, angle: circularMean(toCash) + 0.35 });
  }

  const links: [string, string][] = [];
  for (const idNode of ring.nodes.filter((n) => n.type === "device" || n.type === "phone" || n.type === "ip")) {
    const sharing = ring.edges
      .filter((e) => e.kind === "identity" && e.target === idNode.id && angle.has(e.source))
      .map((e) => e.source)
      .sort((a, b) => angle.get(a)! - angle.get(b)!);
    for (let i = 1; i < sharing.length; i++) links.push([sharing[i - 1], sharing[i]]);
  }

  return { layers, nodes, flows, links };
}

/** Position of a node for a formation of radius `radius` centred on the origin. */
export function nodePoint(node: FormationNode, layers: number, radius: number) {
  const r = (radius * node.layer) / layers;
  return { x: Math.cos(node.angle) * r, y: Math.sin(node.angle) * r };
}

/** Start angle and sweep of layer `k`'s arc: a full circle with one gate, each gate turned from the last. */
export const GATE = 0.5;
export function gateStart(layer: number) {
  return layer * 2.1 + GATE / 2;
}
