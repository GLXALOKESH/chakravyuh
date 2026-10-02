// Lays out the accounts with a force simulation, off the main thread.
// Nothing here knows the data in advance: accounts and transfers are added as
// they arrive and the picture settles around whatever structure they have.
// Connected accounts pull together, everything pushes apart a little, and a
// weak pull keeps stragglers in view.
//
// A ring is not known until its alert arrives. When it does, its accounts are
// pinned where the ring's panel puts them and the panel becomes a place the
// other accounts are pushed out of.

import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationNodeDatum } from "d3-force";

export interface LayoutAdd {
  type: "add";
  /** How many accounts exist after this message. */
  count: number;
  /** Pairs of account numbers that have newly paid each other. */
  links: number[];
  /** Run the simulation ahead before answering, for a graph loaded all at once. */
  settle: boolean;
}
export interface LayoutRing {
  type: "ring";
  /** The ring's panel, by centre and half-size: other accounts keep clear of it. */
  site: { x: number; y: number; hw: number; hh: number };
  /** account number, x, y for each account that now stands in the panel. */
  pins: number[];
}
export interface LayoutReset {
  type: "reset";
}
export type LayoutMessage = LayoutAdd | LayoutRing | LayoutReset;

export interface LayoutFrame {
  /** x, y per account, in number order. */
  positions: Float32Array;
}

interface Node extends SimulationNodeDatum {
  x: number;
  y: number;
  /** How many links end here. */
  degree: number;
}
interface Link {
  source: Node;
  target: Node;
}

const LINK_LENGTH = 70;
/** Every account keeps this much room to itself, so a busy graph spreads out instead of piling up. */
const ROOM = 13;
const KEEP_OUT = 44;

let sites: LayoutRing["site"][] = [];
let nodes: Node[] = [];
let links: Link[] = [];

// A link pulls firmly between two quiet accounts and weakly on a busy one, so
// accounts that each deal with dozens of others are not dragged into one knot.
const link = forceLink<Node, Link>([])
  .distance(LINK_LENGTH)
  .strength((l) => Math.min(0.7, 0.5 / Math.max(1, Math.min(l.source.degree, l.target.degree))));
const simulation = forceSimulation<Node>([])
  .alphaDecay(0.018)
  .velocityDecay(0.45)
  // Repulsion only reaches nearby accounts: it spaces neighbours out without stretching links.
  .force("charge", forceManyBody<Node>().strength(-70).theta(0.95).distanceMax(260))
  .force("link", link)
  .force("room", forceCollide<Node>(ROOM).strength(0.8))
  .force("x", forceX<Node>(0).strength(0.014))
  .force("y", forceY<Node>(0).strength(0.04))
  .force("sites", () => {
    for (const n of nodes) {
      if (n.fx != null) continue;
      for (const s of sites) {
        const dx = n.x - s.x;
        const dy = n.y - s.y;
        // How deep the account is inside the panel and its margin, on each axis.
        const inX = s.hw + KEEP_OUT - Math.abs(dx);
        const inY = s.hh + KEEP_OUT - Math.abs(dy);
        if (inX <= 0 || inY <= 0) continue;
        // A push out through the nearer side that grows the deeper the account
        // is, and a hard stop at the panel's edge. The push spreads accounts out
        // round a panel; a wall alone would pile them up against it.
        if (inX < inY) {
          const side = dx < 0 ? -1 : 1;
          n.vx = (n.vx ?? 0) + side * inX * 0.22;
          if (inX > KEEP_OUT - 12) n.x = s.x + side * (s.hw + 12);
        } else {
          const side = dy < 0 ? -1 : 1;
          n.vy = (n.vy ?? 0) + side * inY * 0.22;
          if (inY > KEEP_OUT - 12) n.y = s.y + side * (s.hh + 12);
        }
      }
    }
  })
  .stop();

function send() {
  const positions = new Float32Array(nodes.length * 2);
  for (let i = 0; i < nodes.length; i++) {
    positions[i * 2] = nodes[i].x;
    positions[i * 2 + 1] = nodes[i].y;
  }
  (self as unknown as Worker).postMessage({ positions } satisfies LayoutFrame, [positions.buffer]);
}

function add(message: LayoutAdd) {
  const first = nodes.length;
  // A new account starts beside whoever it first dealt with, so it does not
  // fly in from far away; one with no known partner starts on the outskirts.
  const partner = new Map<number, number>();
  for (let i = 0; i < message.links.length; i += 2) {
    const a = message.links[i];
    const b = message.links[i + 1];
    if (a >= first && !partner.has(a)) partner.set(a, b);
    if (b >= first && !partner.has(b)) partner.set(b, a);
  }
  for (let id = first; id < message.count; id++) {
    const p = partner.get(id);
    const near = p !== undefined && p < id ? nodes[p] : undefined;
    const angle = Math.random() * Math.PI * 2;
    const reach = near ? LINK_LENGTH : 80 + 8 * Math.sqrt(id + 1);
    nodes.push({ x: (near?.x ?? 0) + Math.cos(angle) * reach, y: (near?.y ?? 0) + Math.sin(angle) * reach, degree: 0 });
  }
  for (let i = 0; i < message.links.length; i += 2) {
    const source = nodes[message.links[i]];
    const target = nodes[message.links[i + 1]];
    if (!source || !target) continue;
    source.degree++;
    target.degree++;
    links.push({ source, target });
  }
  simulation.nodes(nodes);
  link.links(links);
  simulation.alpha(Math.max(simulation.alpha(), message.settle ? 1 : 0.3));
  if (message.settle) {
    for (let i = 0; i < 200; i++) simulation.tick();
  }
}

function ring(message: LayoutRing) {
  sites.push(message.site);
  const pinned = new Set<Node>();
  for (let i = 0; i < message.pins.length; i += 3) {
    const n = nodes[message.pins[i]];
    if (!n) continue;
    n.x = n.fx = message.pins[i + 1];
    n.y = n.fy = message.pins[i + 2];
    n.vx = n.vy = 0;
    pinned.add(n);
  }
  // Links inside the formation are fixed at both ends; dropping them saves work.
  links = links.filter((l) => !(pinned.has(l.source) && pinned.has(l.target)));
  link.links(links);
  simulation.alpha(Math.max(simulation.alpha(), 0.6));
}

self.addEventListener("message", (event: MessageEvent<LayoutMessage>) => {
  const message = event.data;
  if (message.type === "reset") {
    sites = [];
    nodes = [];
    links = [];
    simulation.nodes([]);
    link.links([]);
  } else if (message.type === "ring") {
    ring(message);
  } else {
    add(message);
  }
  send();
});

// Keep settling, and report, for as long as anything is still moving.
setInterval(() => {
  if (!nodes.length || simulation.alpha() < 0.012) return;
  // As many steps as fit in the frame, so a large graph still settles briskly.
  const began = performance.now();
  do simulation.tick();
  while (performance.now() - began < 20 && simulation.alpha() >= 0.012);
  send();
}, 33);
