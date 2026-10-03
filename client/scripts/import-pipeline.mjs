// Builds client/lib/mock/demo.json from the ML pipeline's own output
// (ml/data/<profile>/outputs), so the dashboard runs on what the pipeline
// actually produced until it is pointed at the Express API.
//
//   node scripts/import-pipeline.mjs [profile]        (profile defaults to "demo")
//
// What it changes on the way through:
//   - amounts go from integer paise to rupees
//   - `is_fraud` (ground truth) is dropped: it is never sent to the dashboard
//   - only the account fields the interface shows are kept

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const profile = process.argv[2] ?? "demo";
const source = join(here, "..", "..", "ml", "data", profile, "outputs");
const read = (name) => JSON.parse(readFileSync(join(source, name), "utf8"));
const rupees = (paise) => Math.round(paise) / 100;

const accounts = read("accounts.json");
const transactions = read("transactions.json").sort((a, b) => a.ts.localeCompare(b.ts));
const rings = read("rings.json");
const alerts = read("alerts.json");
const identifiers = read("identifiers.json");
const metrics = read("metrics.json");
let recruits = [];
try {
  recruits = read("recruits.json");
} catch {
  // The recruitment model is optional. It writes a 0-100 `score`; the API's
  // `probability` is 0 to 1.
}

const demo = {
  note: `Imported from ml/data/${profile}/outputs by client/scripts/import-pipeline.mjs. Do not edit by hand.`,
  window: { start: transactions[0].ts, end: transactions[transactions.length - 1].ts },
  metrics,
  alerts: alerts.map((a) => {
    const ring = rings.find((r) => r._id === a.ring_id);
    const members = new Set(ring.member_ids);
    const firstCash = transactions.find((t) => t.to === "CASH" && members.has(t.from) && t.ts >= a.fired_at);
    return {
      id: a._id,
      ring_id: a.ring_id,
      fired_at: a.fired_at,
      risk: ring.risk,
      members: ring.member_ids.length,
      volume: rupees(ring.volume),
      reason: a.reason,
      cashout_eta_min: firstCash ? Math.round((Date.parse(firstCash.ts) - Date.parse(a.fired_at)) / 60000) : undefined,
    };
  }),
  rings: rings.map((r) => ({
    id: r._id,
    risk: r.risk,
    volume: rupees(r.volume),
    geo_spread_km: r.geo_spread_km ?? 0,
    member_ids: r.member_ids,
    edges: r.edges.map((e) => ({ from: e.from, to: e.to, amount: rupees(e.amount), count: e.count ?? 1 })),
    identity_links: r.identity_links,
    victim_txn_ids: r.victim_txn_ids,
  })),
  recruits: Object.fromEntries(
    rings.map((r) => [r._id, recruits.filter((x) => x.ring_id === r._id).map((x) => ({ id: x.account_id ?? x.id, probability: x.probability ?? (x.score ?? 0) / 100, reasons: x.reasons ?? [] }))]),
  ),
  identifiers: identifiers.map((i) => ({ id: i._id, type: i.type, account_ids: i.account_ids })),
  accounts: accounts.map((a) => ({
    id: a._id,
    holder: a.holder,
    bank: a.bank,
    home: a.home,
    opened_at: a.opened_at,
    opening_balance: rupees(a.opening_balance),
    risk_v1: a.risk_v1,
    risk_v2: a.risk_v2,
    signals: a.signals ?? [],
    ring_id: a.ring_id,
    role: a.role,
    role_reason: a.role_reason,
  })),
  transactions: transactions.map((t) => ({
    id: t._id,
    from: t.from,
    to: t.to,
    amount: rupees(t.amount_paise),
    ts: t.ts,
    channel: t.channel,
    ...(t.location ? { location: t.location } : {}),
  })),
};

// One record per line keeps the file diffable without pretty-printing thousands of objects.
const lines = (list) => "[\n" + list.map((x) => "    " + JSON.stringify(x)).join(",\n") + "\n  ]";
const out = join(here, "..", "lib", "mock", "demo.json");
writeFileSync(
  out,
  `{\n  "note": ${JSON.stringify(demo.note)},\n  "window": ${JSON.stringify(demo.window)},\n  "metrics": ${JSON.stringify(demo.metrics)},\n  "recruits": ${JSON.stringify(demo.recruits)},\n  "alerts": ${lines(demo.alerts)},\n  "rings": ${lines(demo.rings)},\n  "identifiers": ${lines(demo.identifiers)},\n  "accounts": ${lines(demo.accounts)},\n  "transactions": ${lines(demo.transactions)}\n}\n`,
);
console.log(`${demo.accounts.length} accounts, ${demo.transactions.length} transactions, ${demo.rings.length} rings -> ${out}`);
