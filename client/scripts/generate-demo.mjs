// Writes client/lib/mock/demo.json: the synthetic dataset the dashboard runs
// on until the real pipeline output replaces it. Seeded, so every run gives
// the same file.   Run with:  node scripts/generate-demo.mjs
//
// Shapes follow TRD sections 6 and 8. Two fields are additions for the
// overview graph and are optional when real data is dropped in:
//   accounts[].pos   where an ordinary account stands in the graph
//   rings[].site     centre and radius of a ring's formation

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ACCOUNTS = 5000;
const TXN_TOTAL = 12000;
const WORLD = { w: 2600, h: 1900 };
const MIN = 60_000;
const WINDOW_START = Date.parse("2026-10-01T03:30:00Z"); // 09:00 IST
const WINDOW_MIN = 180;

function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(26);
const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
const iso = (ms) => new Date(ms).toISOString();

// transfers: [from, to, amount, minutes after start]
const RING_SCRIPTS = [
  {
    // Pattern A, fan-out. This is the ring the demo script opens.
    id: "RING01",
    alertId: "ALT01",
    site: { x: 900, y: 990, r: 230 },
    startMin: 10,
    victim: "ACC0007",
    victimTxn: "TXN003975",
    risk: 0.91,
    reason: "5 linked accounts forwarding within minutes",
    accounts: [
      ["ACC0040", "source", 0.86],
      ["ACC0042", "mule", 0.88],
      ["ACC0051", "mule", 0.9],
      ["ACC0055", "mule", 0.84],
      ["ACC0058", "mule", 0.87],
      ["ACC0060", "mule", 0.82],
      ["ACC0061", "relay", 0.79],
      ["ACC0063", "cashout", 0.93],
      ["ACC0066", "coordinator", 0.74],
    ],
    transfers: [
      ["ACC0007", "ACC0040", 1200000, 0],
      ["ACC0040", "ACC0042", 240000, 3],
      ["ACC0040", "ACC0051", 240000, 4],
      ["ACC0040", "ACC0055", 230000, 6],
      ["ACC0040", "ACC0058", 230000, 7],
      ["ACC0040", "ACC0060", 220000, 9],
      ["ACC0042", "ACC0061", 225000, 11],
      ["ACC0051", "ACC0063", 230000, 13],
      ["ACC0055", "ACC0061", 215000, 14],
      ["ACC0058", "ACC0063", 220000, 16],
      ["ACC0060", "ACC0063", 205000, 18],
      ["ACC0061", "ACC0063", 420000, 21],
      ["ACC0063", "CASH", 100000, 24],
      ["ACC0063", "CASH", 100000, 27],
      ["ACC0063", "CASH", 110000, 31],
    ],
    identifiers: [
      ["DEV017", "device", ["ACC0042", "ACC0051", "ACC0055", "ACC0066"]],
      ["PHN009", "phone", ["ACC0058", "ACC0060", "ACC0066"]],
      ["DEV021", "device", ["ACC0061", "ACC0063", "ACC0066"]],
    ],
  },
  {
    // Pattern B, relay chain.
    id: "RING02",
    alertId: "ALT02",
    site: { x: 1830, y: 560, r: 150 },
    startMin: 70,
    victim: "ACC0019",
    victimTxn: "TXN004612",
    risk: 0.84,
    reason: "Chain of accounts forwarding within minutes, each keeping a small cut",
    accounts: [
      ["ACC0071", "source", 0.83],
      ["ACC0072", "relay", 0.86],
      ["ACC0073", "relay", 0.85],
      ["ACC0074", "relay", 0.81],
      ["ACC0075", "cashout", 0.9],
      ["ACC0076", "member", 0.62],
    ],
    transfers: [
      ["ACC0019", "ACC0071", 480000, 0],
      ["ACC0071", "ACC0072", 465000, 4],
      ["ACC0072", "ACC0073", 450000, 9],
      ["ACC0072", "ACC0076", 8000, 11],
      ["ACC0073", "ACC0074", 436000, 15],
      ["ACC0074", "ACC0075", 423000, 20],
      ["ACC0075", "CASH", 100000, 26],
      ["ACC0075", "CASH", 100000, 33],
    ],
    identifiers: [["PHN011", "phone", ["ACC0072", "ACC0076", "ACC0074"]]],
  },
  {
    // Pattern C, shared-device cluster.
    id: "RING03",
    alertId: "ALT03",
    site: { x: 1780, y: 1360, r: 150 },
    startMin: 125,
    victim: "ACC0023",
    victimTxn: "TXN004988",
    risk: 0.88,
    reason: "9 accounts opened within days of each other on 3 shared devices",
    accounts: [
      ["ACC0082", "source", 0.85],
      ["ACC0083", "mule", 0.87],
      ["ACC0084", "mule", 0.89],
      ["ACC0085", "mule", 0.86],
      ["ACC0086", "mule", 0.83],
      ["ACC0087", "cashout", 0.92],
      ["ACC0088", "cashout", 0.9],
      ["ACC0089", "member", 0.66],
      ["ACC0081", "coordinator", 0.77],
    ],
    transfers: [
      ["ACC0023", "ACC0082", 650000, 0],
      ["ACC0082", "ACC0083", 160000, 2],
      ["ACC0082", "ACC0084", 160000, 3],
      ["ACC0082", "ACC0085", 155000, 5],
      ["ACC0082", "ACC0086", 150000, 6],
      ["ACC0083", "ACC0087", 155000, 8],
      ["ACC0084", "ACC0087", 156000, 10],
      ["ACC0085", "ACC0088", 150000, 12],
      ["ACC0086", "ACC0088", 146000, 13],
      ["ACC0086", "ACC0089", 3000, 14],
      ["ACC0087", "CASH", 100000, 18],
      ["ACC0088", "CASH", 100000, 21],
      ["ACC0087", "CASH", 100000, 25],
    ],
    identifiers: [
      ["DEV031", "device", ["ACC0081", "ACC0083", "ACC0084", "ACC0085"]],
      ["DEV032", "device", ["ACC0081", "ACC0086", "ACC0087", "ACC0089"]],
      ["PHN014", "phone", ["ACC0081", "ACC0082", "ACC0088"]],
    ],
  },
];

// ---- ordinary accounts: clustered, like neighbourhoods of people who pay each other

const sites = RING_SCRIPTS.map((s) => s.site);
const clear = (x, y, pad) => sites.every((s) => Math.hypot(x - s.x, y - s.y) > s.r + pad);

const clusters = [];
while (clusters.length < 64) {
  const c = { x: 120 + rand() * (WORLD.w - 240), y: 120 + rand() * (WORLD.h - 240) };
  if (!clear(c.x, c.y, 90)) continue;
  if (clusters.some((o) => Math.hypot(o.x - c.x, o.y - c.y) < 190)) continue;
  clusters.push({ ...c, spread: 55 + rand() * 60, weight: 0.4 + rand(), members: [] });
}
const totalWeight = clusters.reduce((s, c) => s + c.weight, 0);
const pickCluster = () => {
  let roll = rand() * totalWeight;
  for (const c of clusters) if ((roll -= c.weight) <= 0) return c;
  return clusters[0];
};

const CELL = 11;
const taken = new Set();
const accounts = [];
while (accounts.length < ACCOUNTS) {
  const c = pickCluster();
  const x = Math.round(c.x + gauss() * c.spread);
  const y = Math.round(c.y + gauss() * c.spread);
  if (x < 20 || y < 20 || x > WORLD.w - 20 || y > WORLD.h - 20 || !clear(x, y, 34)) continue;
  const cell = `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;
  if (taken.has(cell)) continue;
  taken.add(cell);
  const account = { id: `ACC${10000 + accounts.length}`, pos: [x, y], cluster: c };
  c.members.push(account);
  accounts.push(account);
}

// True when the straight line between two points passes through a formation.
const crosses = (a, b) =>
  sites.some((s) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((s.x - a[0]) * dx + (s.y - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(a[0] + dx * t - s.x, a[1] + dy * t - s.y) < s.r + 24;
  });

// Each cluster knows its two nearest neighbours; money that leaves a cluster goes there.
for (const c of clusters) {
  c.near = clusters
    .filter((o) => o !== c)
    .sort((p, q) => Math.hypot(p.x - c.x, p.y - c.y) - Math.hypot(q.x - c.x, q.y - c.y))
    .slice(0, 2);
}

// Each account mostly pays a few nearby contacts, and now and then someone a cluster away.
for (const c of clusters) {
  for (const a of c.members) {
    const near = c.members
      .filter((b) => b !== a)
      .map((b) => ({ b, d: Math.hypot(b.pos[0] - a.pos[0], b.pos[1] - a.pos[1]) }))
      .sort((p, q) => p.d - q.d)
      .slice(0, 6);
    a.contacts = near.filter((n) => rand() < 0.55 && !crosses(a.pos, n.b.pos)).map((n) => n.b);
    if (!a.contacts.length) a.contacts = [near[0].b];
  }
}

// ---- transactions

const txns = [];
const victimIds = new Map();
for (const s of RING_SCRIPTS) {
  const start = WINDOW_START + s.startMin * MIN;
  s.transfers.forEach(([from, to, amount, offset], i) => {
    // A few seconds of jitter so transfers in the same minute do not land together.
    const t = { from, to, amount, ts: iso(start + offset * MIN + Math.floor(rand() * 40_000)), channel: to === "CASH" ? "ATM" : "IMPS" };
    if (i === 0) victimIds.set(t, s.victimTxn);
    txns.push(t);
  });
}
const ringTxns = txns.length;
for (let i = 0; i < TXN_TOTAL - ringTxns; i++) {
  const from = accounts[Math.floor(rand() * ACCOUNTS)];
  const roll = rand();
  const channel = roll < 0.62 ? "UPI" : roll < 0.78 ? "IMPS" : roll < 0.92 ? "NEFT" : "ATM";
  let to = "CASH";
  if (channel !== "ATM") {
    let other = from.contacts[Math.floor(rand() * from.contacts.length)];
    if (rand() < 0.07) {
      const away = from.cluster.near[Math.floor(rand() * 2)].members;
      const far = away[Math.floor(rand() * away.length)];
      if (far && !crosses(from.pos, far.pos)) other = far;
    }
    to = other.id;
  }
  txns.push({
    from: from.id,
    to,
    amount: Math.round(Math.exp(5.5 + rand() * 5) / 10) * 10,
    ts: iso(WINDOW_START + Math.floor(rand() * WINDOW_MIN * MIN)),
    channel,
  });
}
txns.sort((a, b) => a.ts.localeCompare(b.ts));
let serial = 1;
const transactions = txns.map((t) => ({ id: victimIds.get(t) ?? `TXN${String(serial++).padStart(6, "0")}`, ...t }));

// ---- rings and alerts

const rings = RING_SCRIPTS.map((s) => {
  const flows = new Map();
  for (const [from, to, amount] of s.transfers) {
    const key = `${from}>${to}`;
    const edge = flows.get(key);
    if (edge) edge.amount += amount;
    else flows.set(key, { source: from, target: to, kind: "txn", amount });
  }
  return {
    id: s.id,
    risk: s.risk,
    volume: s.transfers[0][2],
    site: s.site,
    nodes: [
      { id: s.victim, type: "victim" },
      ...s.accounts.map(([id, role, risk]) => ({ id, type: "account", role, risk })),
      { id: "CASH", type: "cash" },
      ...s.identifiers.map(([id, type]) => ({ id, type })),
    ],
    edges: [
      ...flows.values(),
      ...s.identifiers.flatMap(([id, , members]) => members.map((a) => ({ source: a, target: id, kind: "identity" }))),
    ],
    victim_txn_ids: [s.victimTxn],
  };
});

const alerts = RING_SCRIPTS.map((s) => {
  const start = WINDOW_START + s.startMin * MIN;
  // TRD 9: an alert fires at the ring's third member-to-member transfer.
  const third = s.transfers.filter(([from, to]) => from !== s.victim && to !== "CASH")[2];
  const firstCash = s.transfers.find(([, to]) => to === "CASH");
  return {
    id: s.alertId,
    ring_id: s.id,
    fired_at: iso(start + third[3] * MIN),
    risk: s.risk,
    members: s.accounts.length,
    volume: s.transfers[0][2],
    reason: s.reason,
    cashout_eta_min: firstCash ? firstCash[3] - third[3] : undefined,
  };
});

const demo = {
  note: "Synthetic data generated by client/scripts/generate-demo.mjs. Do not edit by hand.",
  window: { start: iso(WINDOW_START), end: iso(WINDOW_START + WINDOW_MIN * MIN) },
  accounts: accounts.map(({ id, pos }) => ({ id, pos })),
  rings,
  alerts,
  transactions,
  // Invented for layout. PRODUCT.md: never present these as results.
  metrics: {
    rows: [
      { model: "V1 transaction only", pr_auc: 0.62, ring_recall: 0.58, pattern_d_recall: 0.34 },
      { model: "V2 with identity", pr_auc: 0.87, ring_recall: 0.91, pattern_d_recall: 0.78 },
      { model: "V3 GraphSAGE", pr_auc: null, ring_recall: null, pattern_d_recall: null },
    ],
    note: "Synthetic data. Rings planted by the team.",
  },
};

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "lib", "mock", "demo.json");
// One record per line keeps the file diffable without pretty-printing 17,000 objects.
const lines = (list) => "[\n" + list.map((x) => "    " + JSON.stringify(x)).join(",\n") + "\n  ]";
writeFileSync(
  out,
  `{\n  "note": ${JSON.stringify(demo.note)},\n  "window": ${JSON.stringify(demo.window)},\n  "metrics": ${JSON.stringify(demo.metrics)},\n  "alerts": ${lines(demo.alerts)},\n  "rings": ${lines(demo.rings)},\n  "accounts": ${lines(demo.accounts)},\n  "transactions": ${lines(demo.transactions)}\n}\n`,
);
const pairs = new Set(transactions.filter((t) => t.to !== "CASH").map((t) => [t.from, t.to].sort().join()));
console.log(`${demo.accounts.length} accounts, ${transactions.length} transactions, ${pairs.size} distinct links -> ${out}`);
