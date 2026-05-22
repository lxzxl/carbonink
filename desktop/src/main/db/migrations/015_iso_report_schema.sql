-- 015_iso_report_schema.sql
-- ISO 14064-1 report schema additions (Phase 3 sub-project 1):
-- 1. organization: extend boundary_kind CHECK to add 'financial_control',
--    add responsible person + base year + recalc threshold fields.
--    Requires temp-table rebuild because SQLite cannot ALTER CHECK.
-- 2. reporting_period: ADD significant_changes_text + recalculation_reason.
-- 3. emission_factor: ADD biogenic_co2_factor.

-- Use defer_foreign_keys (not foreign_keys = OFF) — the migration runner
-- wraps each migration in a transaction, and `PRAGMA foreign_keys` is a
-- no-op inside an open transaction. `defer_foreign_keys = ON` is the
-- per-transaction equivalent and *does* take effect here; FK constraints
-- are checked at COMMIT, after the rebuild + rename are complete.
PRAGMA defer_foreign_keys = ON;

-- 1. Rebuild organization (CHECK constraint widening + new columns).
CREATE TABLE organization_new (
  id              TEXT PRIMARY KEY,
  singleton_key   INTEGER NOT NULL DEFAULT 1 CHECK (singleton_key = 1) UNIQUE,
  name_zh         TEXT,
  name_en         TEXT,
  industry        TEXT,
  country_code    TEXT NOT NULL,
  boundary_kind   TEXT NOT NULL
    CHECK(boundary_kind IN ('equity_share', 'financial_control', 'operational_control')),
  responsible_person_name TEXT,
  responsible_person_role TEXT,
  base_year_period_id     TEXT REFERENCES reporting_period(id),
  recalc_threshold_pct    REAL NOT NULL DEFAULT 5.0,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

INSERT INTO organization_new (
  id, singleton_key, name_zh, name_en, industry, country_code, boundary_kind,
  responsible_person_name, responsible_person_role, base_year_period_id,
  recalc_threshold_pct, created_at, updated_at
)
SELECT
  id, singleton_key, name_zh, name_en, industry, country_code, boundary_kind,
  NULL, NULL, NULL, 5.0, created_at, updated_at
FROM organization;

DROP TABLE organization;
ALTER TABLE organization_new RENAME TO organization;

-- 2. reporting_period: ADD COLUMN (additive, no rebuild).
ALTER TABLE reporting_period ADD COLUMN significant_changes_text TEXT;
ALTER TABLE reporting_period ADD COLUMN recalculation_reason     TEXT;

-- 3. emission_factor: ADD COLUMN (additive).
ALTER TABLE emission_factor ADD COLUMN biogenic_co2_factor REAL;
