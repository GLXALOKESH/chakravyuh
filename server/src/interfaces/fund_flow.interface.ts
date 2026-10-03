/** The optional ML outputs/fund_flows.json artifact. Money stays in integer paise. */
export interface FundFlowStep {
  step: number;
  from_account: string;
  to_account: string;
  txn_id: string;
  timestamp: string;
  amount_paise: number;
  latency_from_prev_min: number | null;
}

export interface FundFlowPath {
  path_id: string;
  hops: number;
  start_time: string;
  end_time: string;
  duration_minutes: number;
  initial_amount_paise: number;
  final_amount_paise: number;
  /** Nominal transaction amount difference, not money loss or taint provenance. */
  amount_decay_pct: number;
  chain: FundFlowStep[];
}

export interface FundFlowSummary {
  total_paths_identified: number;
  avg_hop_latency_minutes: number;
  fastest_path_minutes: number | null;
  truncated: boolean;
}

export interface FundFlowsArtifact {
  summary: FundFlowSummary;
  paths: FundFlowPath[];
}
