/**
 * Contract-shaped mock payloads (TRD section 15).
 *
 * Hand-written against TRD section 8 so the frontend has a fixed contract to
 * build against before ml/pipeline.py exists. Set USE_MOCKS=true to serve these.
 *
 * Values are illustrative in the way the TRD says its examples are. They are
 * deliberately independent of the database: if a mock and a real response ever
 * disagree, that is a contract break and the test in test/contract.test.js is
 * what should catch it.
 */

export const alerts = [
  {
    id: 'ALT01',
    ring_id: 'RING01',
    fired_at: '2026-10-01T09:48:00Z',
    risk: 0.91,
    members: 9,
    volume: 1200000,
    reason: '6 linked accounts forwarding within minutes',
  },
  {
    id: 'ALT02',
    ring_id: 'RING02',
    fired_at: '2026-10-01T11:13:00Z',
    risk: 0.84,
    members: 5,
    volume: 900000,
    reason: '4 accounts chained by shared device, each hop under 4 min',
  },
  {
    id: 'ALT03',
    ring_id: 'RING03',
    fired_at: '2026-10-01T12:12:00Z',
    risk: 0.78,
    members: 10,
    volume: 600000,
    reason: '9 accounts opened within days of each other on 3 shared devices',
  },
];

export const ringsSummary = [
  { id: 'RING01', risk: 0.91, volume: 1200000, members: 9 },
  { id: 'RING02', risk: 0.84, volume: 900000, members: 5 },
  { id: 'RING03', risk: 0.78, volume: 600000, members: 10 },
];

export const rings = {
  RING01: {
    id: 'RING01',
    risk: 0.91,
    volume: 1200000,
    nodes: [
      { id: 'ACC0040', type: 'account', role: 'source', risk: 0.94 },
      { id: 'ACC0042', type: 'account', role: 'mule', risk: 0.88 },
      { id: 'ACC0045', type: 'account', role: 'mule', risk: 0.87 },
      { id: 'ACC0048', type: 'account', role: 'mule', risk: 0.9 },
      { id: 'ACC0051', type: 'account', role: 'mule', risk: 0.86 },
      { id: 'ACC0060', type: 'account', role: 'cash-out', risk: 0.89 },
      { id: 'ACC0063', type: 'account', role: 'cash-out', risk: 0.92 },
      { id: 'ACC0070', type: 'account', role: 'coordinator', risk: 0.81 },
      { id: 'DEV017', type: 'device' },
      { id: 'DEV018', type: 'device' },
      { id: 'PHN042', type: 'phone' },
      { id: 'IP033', type: 'ip' },
    ],
    edges: [
      { source: 'ACC0040', target: 'ACC0042', kind: 'txn', amount: 150000, count: 1 },
      { source: 'ACC0040', target: 'ACC0045', kind: 'txn', amount: 150000, count: 1 },
      { source: 'ACC0042', target: 'ACC0060', kind: 'txn', amount: 135000, count: 1 },
      { source: 'ACC0051', target: 'ACC0063', kind: 'txn', amount: 135000, count: 1 },
      { source: 'DEV017', target: 'ACC0042', kind: 'identity' },
      { source: 'DEV017', target: 'ACC0051', kind: 'identity' },
      { source: 'PHN042', target: 'ACC0070', kind: 'identity' },
    ],
    victim_txn_ids: ['TXN003975'],
  },
  RING02: {
    id: 'RING02',
    risk: 0.84,
    volume: 900000,
    nodes: [
      { id: 'ACC0100', type: 'account', role: 'source', risk: 0.85 },
      { id: 'ACC0110', type: 'account', role: 'relay', risk: 0.83 },
      { id: 'ACC0120', type: 'account', role: 'relay', risk: 0.82 },
      { id: 'ACC0140', type: 'account', role: 'cash-out', risk: 0.86 },
      { id: 'DEV101', type: 'device' },
    ],
    edges: [
      { source: 'ACC0100', target: 'ACC0110', kind: 'txn', amount: 846000, count: 1 },
      { source: 'ACC0110', target: 'ACC0120', kind: 'txn', amount: 795240, count: 1 },
      { source: 'DEV101', target: 'ACC0100', kind: 'identity' },
    ],
    victim_txn_ids: [],
  },
};

export const taint = {
  victim_amount: 1200000,
  as_of: '2026-10-01T10:31:00Z',
  cached: false,
  accounts: [
    { id: 'ACC0040', balance: 360000, tainted: 345600, lien: 345600 },
    { id: 'ACC0060', balance: 250000, tainted: 244000, lien: 244000 },
    { id: 'ACC0063', balance: 230000, tainted: 225000, lien: 225000 },
    { id: 'ACC0042', balance: 15000, tainted: 14400, lien: 14400 },
    { id: 'ACC0045', balance: 15000, tainted: 14400, lien: 14400 },
    { id: 'ACC0048', balance: 15000, tainted: 14400, lien: 14400 },
    { id: 'ACC0051', balance: 15000, tainted: 14400, lien: 14400 },
  ],
  // Accounts plus lost_to_cash must equal victim_amount, exactly as the real
  // route guarantees. The mock is only useful if the dashboard's totals maths
  // behaves identically against it.
  lost_to_cash: 327800,
  links: [
    { source: 'ACC0040', target: 'ACC0042', value: 144000 },
    { source: 'ACC0040', target: 'ACC0045', value: 144000 },
    { source: 'ACC0042', target: 'ACC0060', value: 129600 },
    { source: 'ACC0060', target: 'CASH', value: 120000 },
  ],
};

export const freeze = {
  freeze: ['ACC0040', 'ACC0060', 'ACC0063'],
  at_risk_before: 1200000,
  secured: 1032000,
  pct_stopped: 0.86,
  cached: false,
};

export const recruits = [
  {
    id: 'ACC0311',
    probability: 0.82,
    reasons: ['Shares device DEV017 with ACC0051', 'Account is 2 days old', 'No transactions yet'],
  },
  {
    id: 'ACC0318',
    probability: 0.41,
    reasons: ['Shares phone PHN042 with ACC0042', 'Median hold 9 min', 'Forwards 88% of what it receives'],
  },
  {
    id: 'ACC0325',
    probability: 0.28,
    reasons: ['Shares IP033 with ACC0057', 'Opened 5 days before first transaction'],
  },
];

export const geo = {
  spread_km: 1759,
  cities: 2,
  homes: [
    { account_id: 'ACC0040', city: 'Kolkata', lat: 22.5726, lng: 88.3639 },
    { account_id: 'ACC0063', city: 'Chennai', lat: 13.0827, lng: 80.2707 },
  ],
  cashouts: [
    {
      txn_id: 'TXN005033',
      account_id: 'ACC0060',
      city: 'Delhi',
      lat: 28.6291,
      lng: 77.2213,
      amount: 60000,
      ts: '2026-10-01T10:05:00Z',
    },
    {
      txn_id: 'TXN005034',
      account_id: 'ACC0063',
      city: 'Chennai',
      lat: 13.0912,
      lng: 80.2831,
      amount: 75000,
      ts: '2026-10-01T10:31:00Z',
    },
  ],
};

export const accounts = {
  ACC0042: {
    id: 'ACC0042',
    holder: 'R. Sharma',
    bank: 'Bank B',
    home: { city: 'Kolkata', lat: 22.5726, lng: 88.3639 },
    opened_at: '2026-09-28T10:15:00Z',
    opening_balance: 1200,
    features: {
      amount_in: 150000,
      amount_out: 135000,
      txn_in: 1,
      txn_out: 1,
      pass_through: 0.9,
      median_hold_min: 6,
      velocity_per_hr: 3.2,
      shared_device_n: 3,
    },
    risk_v1: 0.41,
    risk_v2: 0.88,
    signals: [
      { feature: 'pass_through', label: 'Forwards 90% of what it receives', weight: 0.31 },
      { feature: 'median_hold_min', label: 'Median hold 6 min', weight: 0.24 },
      { feature: 'shared_device_n', label: 'Device shared with 3 other accounts', weight: 0.19 },
    ],
    ring_id: 'RING01',
    role: 'mule',
    role_reason: 'Receives from a source, forwards within 6 min',
    linked_identifiers: [
      { id: 'DEV017', type: 'device', account_ids: ['ACC0042', 'ACC0051', 'ACC0057', 'ACC0311'] },
      { id: 'PHN042', type: 'phone', account_ids: ['ACC0042', 'ACC0051', 'ACC0070'] },
    ],
    recent_transactions: [
      {
        id: 'TXN005021',
        from: 'ACC0040',
        to: 'ACC0042',
        amount: 150000,
        ts: '2026-10-01T09:44:00Z',
        channel: 'UPI',
        location: null,
      },
    ],
  },
};

export const metrics = {
  rows: [
    { model: 'V1 transaction only', pr_auc: 0, ring_recall: 0, pattern_d_recall: 0 },
    { model: 'V2 with identity', pr_auc: 0, ring_recall: 0, pattern_d_recall: 0 },
  ],
  note: 'Synthetic data, rings planted by the team',
};

export default {
  alerts,
  ringsSummary,
  rings,
  taint,
  freeze,
  recruits,
  geo,
  accounts,
  metrics,
};