/**
 * Domain object -> the exact wire shape in TRD section 8.
 *
 * Keeping "what the database says" and "what the client receives" as separate
 * steps means a column can be renamed without silently changing the contract,
 * and the contract can be asserted key by key in one place.
 */
import { iso } from '../utilities/serialize.util.js';
import type {
  Account,
  AccountDetail,
  GeoPoint,
  Identifier,
  Ring,
  RingGeo,
  RingGraph,
  Recruit,
  Transaction,
} from '../interfaces/domain.interface.js';

type CityPoint = { city?: string; lat?: number; lng?: number } | null;

/**
 * GET /rings/:id.
 *
 * The graph is account nodes plus identifier nodes, joined by one `txn` edge per
 * member-to-member hop and one `identity` edge per member sharing an
 * identifier, so the picture shows the link that actually ties the ring
 * together rather than a claim that they are connected.
 */
export const toRingGraph = (
  ring: Ring,
  members: { id: string; role: string | null; risk_v2: number | null }[],
  identifierRows: Identifier[],
): RingGraph => ({
  id: ring.id,
  risk: ring.risk,
  volume: ring.volume,
  nodes: [
    ...members.map((m) => ({
      id: m.id,
      type: 'account' as const,
      role: (m.role ?? 'member') as RingGraph['nodes'][number]['role'],
      risk: m.risk_v2 ?? 0,
    })),
    ...identifierRows.map((i) => ({ id: i.id, type: i.type })),
  ],
  edges: [
    ...ring.edges.map((e) => ({
      source: e.from,
      target: e.to,
      kind: 'txn' as const,
      amount: e.amount,
      count: e.count ?? 1,
    })),
    ...ring.identity_links.flatMap((link) =>
      (link.account_ids ?? []).map((accountId) => ({
        source: link.identifier,
        target: accountId,
        kind: 'identity' as const,
      })),
    ),
  ],
  victim_txn_ids: ring.victim_txn_ids,
});

/**
 * GET /rings/:id/geo.
 *
 * Homes come from the accounts, cash-out points from the ATM withdrawals, and
 * `cities` is the count of distinct cities that actually have a cash-out in
 * them. The cash-out city is deliberately not the member's home city in the
 * fixtures, which is the signal the map tab exists to show.
 */
export const toRingGeo = (ring: Ring, members: Account[], cashouts: (Transaction & { from_account?: string })[]): RingGeo => {
  const homes = members
    .filter((a) => a.home?.city)
    .map((a) => ({ account_id: a.id, city: a.home!.city, lat: a.home!.lat, lng: a.home!.lng }));

  const points = cashouts
    .filter((c) => c.location)
    .map((c) => ({
      txn_id: c.id,
      account_id: c.from ?? (c.from_account ?? ''),
      city: (c.location as CityPoint)?.city ?? '',
      lat: (c.location as CityPoint)?.lat ?? 0,
      lng: (c.location as CityPoint)?.lng ?? 0,
      amount: c.amount,
      ts: iso(c.ts),
    }));

  return {
    spread_km: ring.geo_spread_km ?? 0,
    cities: new Set(points.map((p) => p.city)).size,
    homes,
    cashouts: points,
  };
};

/** GET /accounts/:id, the entity panel. */
export const toAccountDetail = (
  account: Account,
  linkedIdentifiers: Identifier[],
  recent: Transaction[],
): AccountDetail => ({
  ...account,
  linked_identifiers: linkedIdentifiers,
  recent_transactions: recent,
});

/** GET /rings/:id/recruits. */
export const toRecruit = (row: { account_id: string; probability: number; reasons: unknown }): Recruit => ({
  id: row.account_id,
  probability: row.probability ?? 0,
  reasons: Array.isArray(row.reasons) ? (row.reasons as string[]) : [],
});

export const geoPointOf = (value: unknown): GeoPoint | null => {
  if (!value || typeof value !== 'object') return null;
  const point = value as { city?: string; lat?: number; lng?: number };
  return point.city ? { city: point.city, lat: point.lat ?? 0, lng: point.lng ?? 0 } : null;
};
