-- 024_inbound_v21.sql
-- Inbound supplier disclosure v2.1 schema updates (NSGo v2 line):
-- 1. Rename `customer` -> `counterparty` and widen `role` to allow 'both'
--    (an organization can act as both customer and supplier).
-- 2. Rename `customer_id` -> `counterparty_id` on `questionnaire` and
--    `question_mapping`.
-- 3. Widen `question.tier` and `activity_data.inbound_tier` CHECK constraints
--    from IN (1, 2) to IN (1, 2, 3) to support Tier 3 supplier activity data.

PRAGMA defer_foreign_keys = ON;

-- 1. customer -> counterparty (with role IN ('customer', 'supplier', 'both')).
CREATE TABLE counterparty (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL,
  notes TEXT,
  role  TEXT NOT NULL DEFAULT 'customer'
          CHECK(role IN ('customer', 'supplier', 'both')),
  email TEXT
);

INSERT INTO counterparty (id, name, notes, role, email)
  SELECT id, name, notes, role, email FROM customer;

DROP TABLE customer;

-- 2. Rebuild questionnaire: customer_id -> counterparty_id.
CREATE TABLE questionnaire_new (
  id              TEXT PRIMARY KEY,
  counterparty_id TEXT NOT NULL REFERENCES counterparty(id),
  document_id     TEXT REFERENCES document(id),
  template_kind   TEXT,
  reporting_year  INTEGER NOT NULL,
  status          TEXT NOT NULL CHECK(status IN
                    ('parsing', 'mapping', 'answering', 'finalized', 'exported',
                     'draft', 'sent', 'received', 'ingested')),
  direction       TEXT NOT NULL DEFAULT 'outbound'
                    CHECK(direction IN ('outbound', 'inbound')),
  due_date        TEXT,
  created_at      TEXT NOT NULL
);

INSERT INTO questionnaire_new
  (id, counterparty_id, document_id, template_kind, reporting_year, status,
   direction, due_date, created_at)
  SELECT id, customer_id, document_id, template_kind, reporting_year, status,
         direction, due_date, created_at
  FROM questionnaire;

DROP TABLE questionnaire;
ALTER TABLE questionnaire_new RENAME TO questionnaire;

-- 3. Rebuild question_mapping: customer_id -> counterparty_id.
CREATE TABLE question_mapping_new (
  question_signature  TEXT NOT NULL,
  signature_version   TEXT NOT NULL,
  counterparty_id     TEXT NOT NULL REFERENCES counterparty(id),
  mapping_kind        TEXT NOT NULL CHECK(mapping_kind IN ('inventory_path', 'literal', 'manual')),
  mapping_payload     TEXT NOT NULL CHECK(json_valid(mapping_payload)),
  confidence          REAL,
  reviewed_by_user_at TEXT,
  created_at          TEXT NOT NULL,
  PRIMARY KEY (question_signature, signature_version, counterparty_id)
);

INSERT INTO question_mapping_new
  (question_signature, signature_version, counterparty_id, mapping_kind,
   mapping_payload, confidence, reviewed_by_user_at, created_at)
  SELECT question_signature, signature_version, customer_id, mapping_kind,
         mapping_payload, confidence, reviewed_by_user_at, created_at
  FROM question_mapping;

DROP TABLE question_mapping;
ALTER TABLE question_mapping_new RENAME TO question_mapping;

-- 4. Rebuild question: widen tier CHECK to (1, 2, 3).
CREATE TABLE question_new (
  id                 TEXT PRIMARY KEY,
  questionnaire_id   TEXT NOT NULL REFERENCES questionnaire(id),
  question_signature TEXT NOT NULL,
  signature_version  TEXT NOT NULL,
  normalized_text    TEXT NOT NULL,
  raw_text           TEXT NOT NULL,
  parsed_intent      TEXT,
  question_kind      TEXT NOT NULL CHECK(question_kind IN ('numerical', 'categorical', 'narrative')),
  expected_unit      TEXT,
  position           TEXT,
  required           INTEGER NOT NULL DEFAULT 0,
  tier               INTEGER CHECK(tier IS NULL OR tier IN (1, 2, 3))
);

INSERT INTO question_new
  (id, questionnaire_id, question_signature, signature_version, normalized_text,
   raw_text, parsed_intent, question_kind, expected_unit, position, required, tier)
  SELECT id, questionnaire_id, question_signature, signature_version, normalized_text,
         raw_text, parsed_intent, question_kind, expected_unit, position, required, tier
  FROM question;

DROP TABLE question;
ALTER TABLE question_new RENAME TO question;

CREATE INDEX idx_question_signature ON question(question_signature, signature_version);
CREATE UNIQUE INDEX uq_question_questionnaire_position
  ON question(questionnaire_id, position)
  WHERE position IS NOT NULL;

-- 5. Rebuild activity_data: widen inbound_tier CHECK to (1, 2, 3).
CREATE TABLE activity_data_new (
  id                  TEXT PRIMARY KEY,
  site_id             TEXT NOT NULL,
  emission_source_id  TEXT NOT NULL,
  reporting_period_id TEXT NOT NULL REFERENCES reporting_period(id),

  occurred_at_start   TEXT NOT NULL,
  occurred_at_end     TEXT NOT NULL,

  amount              REAL NOT NULL,
  unit                TEXT NOT NULL,

  ef_factor_code      TEXT NOT NULL,
  ef_year             INTEGER NOT NULL,
  ef_source           TEXT NOT NULL,
  ef_geography        TEXT NOT NULL,
  ef_dataset_version  TEXT NOT NULL,

  computed_co2e_kg    REAL NOT NULL,
  computed_at         TEXT NOT NULL,

  extraction_id       TEXT REFERENCES extraction(id),
  notes               TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,

  inbound_question_id TEXT REFERENCES question(id),
  inbound_tier        INTEGER CHECK(inbound_tier IS NULL OR inbound_tier IN (1, 2, 3)),
  fuel_code           TEXT REFERENCES fuel_property(fuel_code),

  FOREIGN KEY (emission_source_id, site_id)
    REFERENCES emission_source(id, site_id),
  FOREIGN KEY (ef_factor_code, ef_year, ef_source, ef_geography, ef_dataset_version)
    REFERENCES pinned_emission_factor(factor_code, year, source, geography, dataset_version)
);

INSERT INTO activity_data_new
  (id, site_id, emission_source_id, reporting_period_id,
   occurred_at_start, occurred_at_end, amount, unit,
   ef_factor_code, ef_year, ef_source, ef_geography, ef_dataset_version,
   computed_co2e_kg, computed_at, extraction_id, notes, created_at, updated_at,
   inbound_question_id, inbound_tier, fuel_code)
  SELECT id, site_id, emission_source_id, reporting_period_id,
         occurred_at_start, occurred_at_end, amount, unit,
         ef_factor_code, ef_year, ef_source, ef_geography, ef_dataset_version,
         computed_co2e_kg, computed_at, extraction_id, notes, created_at, updated_at,
         inbound_question_id, inbound_tier, fuel_code
  FROM activity_data;

DROP TABLE activity_data;
ALTER TABLE activity_data_new RENAME TO activity_data;

CREATE INDEX idx_activity_period ON activity_data(reporting_period_id, emission_source_id);
CREATE INDEX idx_activity_extraction ON activity_data(extraction_id);
CREATE INDEX idx_activity_ef ON activity_data(ef_factor_code, ef_year, ef_source, ef_geography, ef_dataset_version);
CREATE INDEX idx_activity_inbound_q ON activity_data(inbound_question_id)
  WHERE inbound_question_id IS NOT NULL;
