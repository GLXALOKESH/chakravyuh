// The only module that fetches data. Each function is one endpoint of the
// Express API (TRD section 8); swap the mock bodies for `fetch` calls and
// nothing else has to change.

import { socket } from "./socket";
import { mockAccounts, mockAlerts, mockIdentifiers, mockMetrics, mockRecruits, mockRings, mockTransactions, mockWindow } from "./mock/data";
import { freezeFor, taintFor } from "./mock/engine";
import type {
  AccountDetail,
  Alert,
  FreezeRequest,
  FreezeResult,
  Metrics,
  Recruit,
  ReplayWindow,
  RingDetail,
  RingGeo,
  Role,
  TaintResult,
} from "./types";

const MOCK_DELAY_MS = 300;

function respond<T>(make: () => T): Promise<T> {
  return new Promise((resolve, reject) =>
    setTimeout(() => {
      try {
        resolve(structuredClone(make()));
      } catch (e) {
        reject(e);
      }
    }, MOCK_DELAY_MS),
  );
}

const ROLES: Role[] = ["source", "mule", "relay", "cashout", "coordinator", "member"];
/** The pipeline writes "cash-out"; anything it does not name is a plain member. */
export function toRole(value: string | null | undefined): Role {
  const role = (value ?? "").replace(/[^a-z]/gi, "").toLowerCase() as Role;
  return ROLES.includes(role) ? role : "member";
}

function ring(id: string) {
  const found = mockRings.get(id);
  if (!found) throw new Error(`Ring ${id} was not found`);
  return found;
}

/** GET /alerts. The mock only knows the alerts that have fired so far in the replay. */
export function getAlerts(): Promise<Alert[]> {
  return respond(() => mockAlerts.filter((a) => Date.parse(a.fired_at) <= socket.clock()));
}

/** GET /rings/:id */
export function getRing(id: string): Promise<RingDetail> {
  return respond(() => {
    const r = ring(id);
    return {
      id: r.id,
      risk: r.risk,
      volume: r.volume,
      nodes: [
        ...r.member_ids.map((m) => {
          const a = mockAccounts.get(m);
          return { id: m, type: "account" as const, role: toRole(a?.role), risk: a?.risk_v2 ?? 0 };
        }),
        ...r.identity_links.map((l) => ({ id: l.identifier, type: l.type as "device" | "phone" | "ip" })),
      ],
      edges: [
        ...r.edges.map((e) => ({ source: e.from, target: e.to, kind: "txn" as const, amount: e.amount })),
        ...r.identity_links.flatMap((l) =>
          l.account_ids.map((a) => ({ source: l.identifier, target: a, kind: "identity" as const })),
        ),
      ],
      victim_txn_ids: r.victim_txn_ids,
    };
  });
}

/** GET /accounts/:id */
export function getAccount(id: string): Promise<AccountDetail> {
  return respond(() => {
    const a = mockAccounts.get(id);
    if (!a) throw new Error(`Account ${id} was not found`);
    return {
      id: a.id,
      holder: a.holder,
      bank: a.bank,
      home: a.home,
      opened_at: a.opened_at,
      risk_v1: a.risk_v1,
      risk_v2: a.risk_v2,
      signals: a.signals,
      ring_id: a.ring_id,
      role: a.ring_id ? toRole(a.role) : null,
      role_reason: a.role_reason,
      linked_identifiers: mockIdentifiers.filter((i) => i.account_ids.includes(id)),
    };
  });
}

/** GET /rings/:id/taint?txn=&as_of= */
export function getTaint(id: string, query: { txn?: string; as_of?: string } = {}): Promise<TaintResult> {
  return respond(() => {
    ring(id);
    return taintFor(id, query.txn, query.as_of);
  });
}

/** POST /rings/:id/freeze */
export function postFreeze(id: string, body: FreezeRequest): Promise<FreezeResult> {
  return respond(() => {
    ring(id);
    return freezeFor(id, body);
  });
}

/** GET /rings/:id/recruits */
export function getRecruits(id: string): Promise<Recruit[]> {
  return respond(() => {
    ring(id);
    return mockRecruits[id] ?? [];
  });
}

/** GET /rings/:id/geo (P2) */
export function getRingGeo(id: string): Promise<RingGeo> {
  return respond(() => {
    const r = ring(id);
    const members = new Set(r.member_ids);
    const cashouts = mockTransactions
      .filter((t) => t.location && members.has(t.from) && t.to === "CASH")
      .map((t) => ({ txn_id: t.id, account_id: t.from, amount: t.amount, ts: t.ts, ...t.location! }));
    return {
      spread_km: r.geo_spread_km,
      cities: new Set(cashouts.map((c) => c.city)).size,
      homes: r.member_ids.flatMap((m) => {
        const home = mockAccounts.get(m)?.home;
        return home ? [{ account_id: m, ...home }] : [];
      }),
      cashouts,
    };
  });
}

/** GET /metrics */
export function getMetrics(): Promise<Metrics> {
  return respond(() => mockMetrics);
}

/** mock-only: not in the TRD contract yet. */
export function getReplayWindow(): Promise<ReplayWindow> {
  return respond(() => mockWindow);
}
