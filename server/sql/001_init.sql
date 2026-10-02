-- Chakravyuh schema. Ported from the JSON documents in TRD section 6.
--
-- Money is DOUBLE PRECISION, not NUMERIC, on purpose. node-postgres returns
-- NUMERIC as a string to protect precision, and PGlite does not, so the two
-- adapters would disagree on the wire and the API contract in TRD section 8
-- requires JSON numbers. The largest figure in this dataset is well inside
-- float64's exact-integer range, so this is safe and keeps both adapters
-- byte-identical.
--
-- Every id is the string supplied by the Python generator. Nothing here is
-- generated, so a reseed is idempotent.

-- Rings are created before accounts and alerts because those two reference them.
CREATE TABLE IF NOT EXISTS rings (
  id             TEXT PRIMARY KEY,
  member_ids     TEXT[]   NOT NULL DEFAULT '{}',
  edges          JSONB    NOT NULL DEFAULT '[]'::jsonb,
  identity_links JSONB    NOT NULL DEFAULT '[]'::jsonb,
  volume         DOUBLE PRECISION NOT NULL DEFAULT 0,
  risk           DOUBLE PRECISION NOT NULL DEFAULT 0,
  geo_spread_km  DOUBLE PRECISION NOT NULL DEFAULT 0,
  victim_txn_ids TEXT[]   NOT NULL DEFAULT '{}',
  -- Cached defaults so taint and freeze still answer when Python is down.
  default_taint  JSONB,
  default_freeze JSONB
);

CREATE TABLE IF NOT EXISTS accounts (
  id              TEXT PRIMARY KEY,
  holder          TEXT,
  bank            TEXT,
  -- { city, lat, lng }
  home            JSONB,
  opened_at       TIMESTAMPTZ,
  opening_balance DOUBLE PRECISION NOT NULL DEFAULT 0,
  features        JSONB    NOT NULL DEFAULT '{}'::jsonb,
  risk_v1         DOUBLE PRECISION,
  risk_v2         DOUBLE PRECISION,
  signals         JSONB    NOT NULL DEFAULT '[]'::jsonb,
  ring_id         TEXT REFERENCES rings(id) ON DELETE SET NULL,
  role            TEXT,
  role_reason     TEXT
);

CREATE INDEX IF NOT EXISTS accounts_ring_id_idx ON accounts (ring_id);

-- TRD section 6: identifiers are shared, so this is one row with an array of
-- linked accounts rather than a row per link.
CREATE TABLE IF NOT EXISTS identifiers (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL CHECK (type IN ('device', 'phone', 'ip')),
  account_ids TEXT[] NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS identifiers_account_ids_gin ON identifiers USING GIN (account_ids);
CREATE INDEX IF NOT EXISTS identifiers_type_idx ON identifiers (type);

-- No foreign keys on from_account and to_account: cash-out is a transfer to the
-- sentinel account id 'CASH' (TRD section 5, "Generator rules"), which is not a
-- row in accounts. The generator guarantees referential integrity for real ids.
CREATE TABLE IF NOT EXISTS transactions (
  id           TEXT PRIMARY KEY,
  from_account TEXT   NOT NULL,
  to_account   TEXT   NOT NULL,
  amount       DOUBLE PRECISION NOT NULL CHECK (amount >= 0),
  ts           TIMESTAMPTZ NOT NULL,
  channel      TEXT   NOT NULL CHECK (channel IN ('UPI', 'IMPS', 'NEFT', 'ATM')),
  -- { city, lat, lng } on ATM rows, null otherwise (TRD section 6).
  location     JSONB,
  -- Ground truth. Never serialised to the dashboard (TRD section 6).
  is_fraud     BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS transactions_ts_idx ON transactions (ts);
CREATE INDEX IF NOT EXISTS transactions_from_idx ON transactions (from_account);
CREATE INDEX IF NOT EXISTS transactions_to_idx ON transactions (to_account);

CREATE TABLE IF NOT EXISTS alerts (
  id       TEXT PRIMARY KEY,
  ring_id  TEXT REFERENCES rings(id) ON DELETE CASCADE,
  fired_at TIMESTAMPTZ NOT NULL,
  reason   TEXT
);

CREATE INDEX IF NOT EXISTS alerts_fired_at_idx ON alerts (fired_at);

-- Not in TRD section 6, but GET /rings/:id/recruits has to be answerable
-- without Python (TRD section 3 allows only taint and freeze to call it live),
-- so the pipeline output is stored here.
CREATE TABLE IF NOT EXISTS recruits (
  ring_id     TEXT NOT NULL REFERENCES rings(id) ON DELETE CASCADE,
  account_id  TEXT NOT NULL,
  probability DOUBLE PRECISION NOT NULL DEFAULT 0,
  reasons     JSONB NOT NULL DEFAULT '[]'::jsonb,
  PRIMARY KEY (ring_id, account_id)
);

-- Single row. TRD section 6 "metrics (single document)".
CREATE TABLE IF NOT EXISTS metrics (
  key  TEXT PRIMARY KEY DEFAULT 'main' CHECK (key = 'main'),
  rows JSONB NOT NULL DEFAULT '[]'::jsonb,
  note TEXT
);

-- Lets the demo report how fresh the data is, and makes "seed is safe to run
-- repeatedly" (TRD section 9) observable.
CREATE TABLE IF NOT EXISTS seed_meta (
  key   TEXT PRIMARY KEY,
  value JSONB NOT NULL
);