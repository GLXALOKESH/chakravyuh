// Synthetic demo data for building the dashboard without a backend.
// Everything here is invented; the real values come from ml/pipeline.py.

import type { Alert, Metrics, ReplayWindow, RingDetail, RingEdge, RingNode, Role, Txn } from "../types";

const MIN = 60_000;
const WINDOW_START = Date.parse("2026-10-01T03:30:00Z"); // 09:00 IST
const WINDOW_MIN = 180;
const TXN_TOTAL = 5000;
const NORMAL_ACCOUNTS = 571;

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface RingScript {
  id: string;
  alertId: string;
  startMin: number;
  victim: string;
  victimTxn: string;
  risk: number;
  reason: string;
  accounts: [id: string, role: Role, risk: number][];
  /** [from, to, amount, minutes after start] */
  transfers: [string, string, number, number][];
  identifiers: [id: string, type: "device" | "phone", accounts: string[]][];
}

const RING_SCRIPTS: RingScript[] = [
  {
    // Pattern A, fan-out. This is the ring the demo script opens.
    id: "RING01",
    alertId: "ALT01",
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

const iso = (ms: number) => new Date(ms).toISOString();

function buildRing(s: RingScript): RingDetail {
  const nodes: RingNode[] = [
    { id: s.victim, type: "victim" },
    ...s.accounts.map(([id, role, risk]): RingNode => ({ id, type: "account", role, risk })),
    { id: "CASH", type: "cash" },
    ...s.identifiers.map(([id, type]): RingNode => ({ id, type })),
  ];
  const flows = new Map<string, RingEdge>();
  for (const [from, to, amount] of s.transfers) {
    const key = `${from}>${to}`;
    const edge = flows.get(key);
    if (edge) edge.amount = (edge.amount ?? 0) + amount;
    else flows.set(key, { source: from, target: to, kind: "txn", amount });
  }
  const identity = s.identifiers.flatMap(([id, , accounts]) =>
    accounts.map((a): RingEdge => ({ source: a, target: id, kind: "identity" })),
  );
  return {
    id: s.id,
    risk: s.risk,
    volume: s.transfers[0][2],
    nodes,
    edges: [...flows.values(), ...identity],
    victim_txn_ids: [s.victimTxn],
  };
}

function buildAlert(s: RingScript): Alert {
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
}

function buildTransactions(): Txn[] {
  const rand = mulberry32(26);
  const txns: Omit<Txn, "id">[] = [];
  const victimTxnAt = new Map<number, string>();

  for (const s of RING_SCRIPTS) {
    const start = WINDOW_START + s.startMin * MIN;
    s.transfers.forEach(([from, to, amount, offset], i) => {
      // A few seconds of jitter so transfers in the same minute do not land together.
      const ts = start + offset * MIN + Math.floor(rand() * 40_000);
      if (i === 0) victimTxnAt.set(txns.length, s.victimTxn);
      txns.push({ from, to, amount, ts: iso(ts), channel: to === "CASH" ? "ATM" : "IMPS" });
    });
  }

  const acc = (i: number) => `ACC${String(100 + i).padStart(4, "0")}`;
  const ringCount = txns.length;
  for (let i = 0; i < TXN_TOTAL - ringCount; i++) {
    const from = Math.floor(rand() * NORMAL_ACCOUNTS);
    let to = Math.floor(rand() * NORMAL_ACCOUNTS);
    if (to === from) to = (to + 1) % NORMAL_ACCOUNTS;
    const roll = rand();
    const channel: Txn["channel"] = roll < 0.6 ? "UPI" : roll < 0.75 ? "IMPS" : roll < 0.86 ? "NEFT" : "ATM";
    txns.push({
      from: acc(from),
      to: channel === "ATM" ? "CASH" : acc(to),
      amount: Math.round(Math.exp(5.5 + rand() * 5) / 10) * 10,
      ts: iso(WINDOW_START + Math.floor(rand() * WINDOW_MIN * MIN)),
      channel,
    });
  }

  const victimIds = new Map([...victimTxnAt].map(([i, id]) => [txns[i], id]));
  txns.sort((a, b) => a.ts.localeCompare(b.ts));
  let serial = 1;
  return txns.map((t) => ({ id: victimIds.get(t) ?? `TXN${String(serial++).padStart(6, "0")}`, ...t }));
}

export const mockRings: Record<string, RingDetail> = Object.fromEntries(
  RING_SCRIPTS.map((s) => [s.id, buildRing(s)]),
);

export const mockAlerts: Alert[] = RING_SCRIPTS.map(buildAlert);

export const mockTransactions: Txn[] = buildTransactions();

export const mockWindow: ReplayWindow = {
  start: iso(WINDOW_START),
  end: iso(WINDOW_START + WINDOW_MIN * MIN),
};

// Invented for layout. PRODUCT.md: never present these as results.
export const mockMetrics: Metrics = {
  rows: [
    { model: "V1 transaction only", pr_auc: 0.62, ring_recall: 0.58, pattern_d_recall: 0.34 },
    { model: "V2 with identity", pr_auc: 0.87, ring_recall: 0.91, pattern_d_recall: 0.78 },
    { model: "V3 GraphSAGE", pr_auc: null, ring_recall: null, pattern_d_recall: null },
  ],
  note: "Synthetic data. Rings planted by the team.",
};
