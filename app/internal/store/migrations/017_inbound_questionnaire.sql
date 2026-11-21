-- 017_inbound_questionnaire.sql
-- Inbound (supplier-driven Scope 3 Cat 1) questionnaire schema additions
-- (spec: docs/specs/2026-05-27-inbound-questionnaire-cat1.md).
--
-- 1. questionnaire: widen status CHECK to include the four inbound states
--    ('draft','sent','received','ingested'), add `direction` column
--    (default 'outbound' so existing rows backfill), and make `document_id`
--    nullable (inbound drafts are user-created — no source xlsx to attach).
--    SQLite cannot ALTER a CHECK constraint in place; rebuild the table.
-- 2. customer: ADD COLUMN role (default 'customer'; suppliers reuse this
--    table with role='supplier').
-- 3. question: ADD COLUMN tier (nullable; non-null only on inbound
--    template-derived questions).
-- 4. activity_data: ADD COLUMN inbound_question_id + inbound_tier, both
--    nullable. Provenance for rows materialized from supplier disclosures.
--
-- See migration 014 / 015 for the same table-rebuild pattern.

-- Use defer_foreign_keys (not foreign_keys = OFF) — the migration runner
-- wraps each migration in a transaction, and `PRAGMA foreign_keys` is a
-- no-op inside an open transaction. `defer_foreign_keys = ON` is the
-- per-transaction equivalent and *does* take effect here; FK constraints
-- are checked at COMMIT, after the rebuild + rename are complete.
PRAGMA defer_foreign_keys = ON;

-- 1. Rebuild questionnaire (widen status CHECK, add direction, nullable document_id).
CREATE TABLE questionnaire_new (
  id            TEXT PRIMARY KEY,
  customer_id   TEXT NOT NULL REFERENCES customer(id),
  document_id   TEXT REFERENCES document(id),
  template_kind TEXT,
  reporting_year INTEGER NOT NULL,
  status        TEXT NOT NULL CHECK(status IN
                  ('parsing', 'mapping', 'answering', 'finalized', 'exported',
                   'draft', 'sent', 'received', 'ingested')),
  direction     TEXT NOT NULL DEFAULT 'outbound'
                  CHECK(direction IN ('outbound', 'inbound')),
  due_date      TEXT,
  created_at    TEXT NOT NULL
);

INSERT INTO questionnaire_new
  (id, customer_id, document_id, template_kind, reporting_year, status,
   direction, due_date, created_at)
  SELECT id, customer_id, document_id, template_kind, reporting_year, status,
         'outbound', due_date, created_at
  FROM questionnaire;

DROP TABLE questionnaire;
ALTER TABLE questionnaire_new RENAME TO questionnaire;

-- (Migration 005 defined no indexes on questionnaire — nothing to recreate.)

-- 2. customer: ADD role.
ALTER TABLE customer ADD COLUMN role TEXT NOT NULL DEFAULT 'customer'
  CHECK(role IN ('customer', 'supplier'));

-- 3. question: ADD tier (NULL for outbound / metadata questions).
ALTER TABLE question ADD COLUMN tier INTEGER
  CHECK(tier IS NULL OR tier IN (1, 2));

-- 4. activity_data: ADD inbound provenance columns + partial index.
ALTER TABLE activity_data ADD COLUMN inbound_question_id TEXT
  REFERENCES question(id);
ALTER TABLE activity_data ADD COLUMN inbound_tier INTEGER
  CHECK(inbound_tier IS NULL OR inbound_tier IN (1, 2));
CREATE INDEX idx_activity_inbound_q ON activity_data(inbound_question_id)
  WHERE inbound_question_id IS NOT NULL;
