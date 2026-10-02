/**
 * Repository contracts.
 *
 * Controllers depend on these, not on Mongoose, so the persistence layer can be
 * swapped or faked without a controller changing. Each method is named for the
 * question the API asks rather than for the collection it reads.
 */
import type {
  Account,
  Alert,
  AlertWithRing,
  Identifier,
  MetricRow,
  Metrics,
  Recruit,
  Ring,
  RingSummary,
  Transaction,
} from './domain.interface.js';
import type { ClientSession } from 'mongoose';

/**
 * A write in progress: a MongoDB session belonging to an open transaction.
 *
 * The seeder opens one with withTransaction and passes it to every repository,
 * so the whole load commits or rolls back together. A repository called without
 * one runs on the shared connection outside any transaction, which is what every
 * read path wants.
 */
export type Writer = ClientSession;

export interface AccountRepository {
  getById(id: string): Promise<Account | null>;
  listByIds(ids: string[]): Promise<Account[]>;
  listByRing(ringId: string): Promise<Account[]>;
  /** Node projection for the ring graph, TRD section 8. */
  graphNodesForRing(ringId: string): Promise<{ id: string; role: string | null; risk_v2: number | null }[]>;
  count(): Promise<number>;
  insertMany(rows: AccountWrite[], tx?: Writer): Promise<void>;
}

export interface AccountWrite {
  id: string;
  holder: string | null;
  bank: string | null;
  home: unknown;
  opened_at: string | null;
  opening_balance: number;
  features: unknown;
  risk_v1: number | null;
  risk_v2: number | null;
  signals: unknown;
  ring_id: string | null;
  role: string | null;
  role_reason: string | null;
}

export interface TransactionRepository {
  getById(id: string): Promise<Transaction | null>;
  /** Every transaction in timestamp order. Builds the replay script. */
  listOrdered(options?: { asOf?: Date | null; fromId?: string | null; limit?: number | null }): Promise<Transaction[]>;
  /** Cash-out withdrawals by ring members, for the map tab. */
  cashoutsForRing(ringIds: string[]): Promise<(Transaction & { from_account: string })[]>;
  /** Most recent activity touching an account, for the entity panel. */
  recentForAccount(accountId: string, limit?: number): Promise<Transaction[]>;
  count(): Promise<number>;
  insertMany(rows: TransactionWrite[], tx?: Writer): Promise<void>;
}

export interface TransactionWrite {
  id: string;
  from: string;
  to: string;
  amount: number;
  ts: string;
  channel: string;
  location: unknown;
  is_fraud: boolean;
}

export interface RingRepository {
  getById(id: string): Promise<Ring | null>;
  list(): Promise<Ring[]>;
  listSummaries(): Promise<RingSummary[]>;
  count(): Promise<number>;
  insertMany(rows: RingWrite[], tx?: Writer): Promise<void>;
}

export interface RingWrite {
  id: string;
  member_ids: string[];
  edges: unknown;
  identity_links: unknown;
  volume: number;
  risk: number;
  geo_spread_km: number;
  victim_txn_ids: string[];
  default_taint: unknown;
  default_freeze: unknown;
}

export interface IdentifierRepository {
  getById(id: string): Promise<Identifier | null>;
  /** Every identifier touching any of the given accounts, for the entity panel. */
  listForAccounts(accountIds: string[]): Promise<Identifier[]>;
  /** Identifier ids linked to one account. */
  listForAccount(accountId: string): Promise<Identifier[]>;
  count(): Promise<number>;
  insertMany(rows: { id: string; type: string; account_ids: string[] }[], tx?: Writer): Promise<void>;
}

export interface AlertRepository {
  listWithRingSummary(): Promise<AlertWithRing[]>;
  listWithRingByFiredAt(): Promise<AlertWithRing[]>;
  count(): Promise<number>;
  insertMany(rows: { id: string; ring_id: string | null; fired_at: string; reason: string | null }[], tx?: Writer): Promise<void>;
}

export interface RecruitRepository {
  listForRing(ringId: string): Promise<Recruit[]>;
  insertMany(
    entries: { ring_id: string; recruits: { id: string; probability: number; reasons: string[] }[] }[],
    tx?: Writer,
  ): Promise<void>;
}

export interface MetricsRepository {
  get(): Promise<Metrics>;
  set(value: { rows: MetricRow[]; note?: string | null }, tx?: Writer): Promise<void>;
}
