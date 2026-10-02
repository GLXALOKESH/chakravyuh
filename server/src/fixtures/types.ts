/**
 * Types for the dev fixture bundle.
 *
 * These are the shapes the seeder writes. They match the generator's output in
 * data/<profile>/ (TRD section 5) closely enough that the seeder does not need
 * to know which of the two it was given.
 */
import type { AccountRole } from '../constants/index.js';
import type { GeoPoint } from '../interfaces/domain.interface.js';
import type { AccountWrite, RingWrite, TransactionWrite } from '../interfaces/repository.interface.js';
import type { GroundTruth, MetricRow } from '../interfaces/domain.interface.js';

export interface FixtureFeatures {
  amount_in: number;
  amount_out: number;
  txn_in: number;
  txn_out: number;
  pass_through: number;
  median_hold_min: number;
  velocity_per_hr: number;
  burst_10min: number;
  counterparty_diversity: number;
  in_degree: number;
  out_degree: number;
  account_age_days: number;
  atm_share: number;
  shared_device_n: number;
  shared_phone_n: number;
  shared_ip_n: number;
  shared_any_new_n: number;
}

export interface FixtureSignal {
  feature: string;
  label: string;
  weight: number;
}

export interface FixtureAccount extends Omit<AccountWrite, 'features' | 'signals' | 'home'> {
  home: GeoPoint;
  features: FixtureFeatures;
  signals: FixtureSignal[];
  role: AccountRole | null;
}

export interface FixtureIdentifier {
  id: string;
  type: 'device' | 'phone' | 'ip';
  account_ids: string[];
}

export type FixtureTransaction = TransactionWrite;

export type FixtureRing = RingWrite;

export interface FixtureAlert {
  id: string;
  ring_id: string | null;
  fired_at: string;
  reason: string | null;
}

export interface FixtureRecruit {
  id: string;
  probability: number;
  reasons: string[];
}

export interface FixtureRecruitEntry {
  ring_id: string;
  recruits: FixtureRecruit[];
}

export interface FixtureMetrics {
  rows: MetricRow[];
  note: string;
}

export interface FixtureBundle {
  accounts: FixtureAccount[];
  identifiers: FixtureIdentifier[];
  transactions: FixtureTransaction[];
  rings: FixtureRing[];
  alerts: FixtureAlert[];
  recruits: FixtureRecruitEntry[];
  metrics: FixtureMetrics;
  ground_truth: GroundTruth;
}
