-- 014_answer_source_kind_reused.sql
-- Extend answer.source_kind enum to allow 'reused' (auto-prefill from a
-- prior questionnaire of the same customer). SQLite can't ALTER CHECK;
-- rebuild the table.

-- Use defer_foreign_keys (not foreign_keys = OFF) — the migration runner
-- wraps each migration in a transaction, and `PRAGMA foreign_keys` is a
-- no-op inside an open transaction. `defer_foreign_keys = ON` is the
-- per-transaction equivalent and *does* take effect here.
PRAGMA defer_foreign_keys = ON;

CREATE TABLE answer_new (
  id              TEXT PRIMARY KEY,
  question_id     TEXT NOT NULL UNIQUE REFERENCES question(id),
  value           TEXT NOT NULL,
  unit            TEXT,
  source_kind     TEXT NOT NULL CHECK(source_kind IN ('mapped_inventory', 'manual', 'ai_suggested', 'reused')),

  source_calculation_snapshot_id TEXT REFERENCES calculation_snapshot(id),
  source_activity_data_id        TEXT REFERENCES activity_data(id),
  source_company_profile_key     TEXT REFERENCES company_profile(key),
  source_narrative_bank_id       TEXT REFERENCES narrative_bank(id),

  source_summary  TEXT CHECK(source_summary IS NULL OR json_valid(source_summary)),
  finalized_at    TEXT,

  CHECK (
    (source_kind = 'mapped_inventory' AND
      ((source_calculation_snapshot_id IS NOT NULL) +
       (source_activity_data_id IS NOT NULL) +
       (source_company_profile_key IS NOT NULL) +
       (source_narrative_bank_id IS NOT NULL)) = 1)
    OR
    (source_kind IN ('manual', 'ai_suggested', 'reused') AND
      ((source_calculation_snapshot_id IS NOT NULL) +
       (source_activity_data_id IS NOT NULL) +
       (source_company_profile_key IS NOT NULL) +
       (source_narrative_bank_id IS NOT NULL)) <= 1)
  )
);

INSERT INTO answer_new SELECT
  id,
  question_id,
  value,
  unit,
  source_kind,
  source_calculation_snapshot_id,
  source_activity_data_id,
  source_company_profile_key,
  source_narrative_bank_id,
  source_summary,
  finalized_at
FROM answer;

DROP TABLE answer;

ALTER TABLE answer_new RENAME TO answer;

-- No indexes or triggers existed on answer in the original schema.
