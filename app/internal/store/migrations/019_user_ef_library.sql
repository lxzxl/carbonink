-- 019_user_ef_library.sql
-- User-imported emission-factor libraries
-- (spec: docs/specs/2026-07-11-user-ef-library-import.md, ROADMAP §8.1-④).
--
-- Imported factors are written straight into `emission_factor` — migration
-- 002's header comment already declares that table a "UNION readonly RO +
-- user-uploaded". Namespace isolation rides the composite PK: every imported
-- row gets `source = 'user:' || library name`, which cannot collide with the
-- built-in sources (DEFRA, IPCC_AR6, MEE_China, ...). Because `name` is
-- UNIQUE here, `source` is UNIQUE too, so library membership is fully
-- derivable from the `source` string — `emission_factor` itself needs no new
-- column, and the FTS5 mirror (migration 010) syncs via its existing
-- triggers.
--
-- `document_id` points at the original uploaded file in the content-addressed
-- document store (doc_type = 'ef_library'), so an auditor can verify which
-- exact file (sha256) a library came from. FK is the schema-default NO ACTION
-- — deleting a library keeps the document row/file, mirroring the
-- evidence_attachment decision in 018 (content-addressed files may be
-- shared; orphan cleanup is a non-goal).

CREATE TABLE user_ef_library (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL UNIQUE,
  source          TEXT NOT NULL UNIQUE,
  version         TEXT NOT NULL,
  source_filename TEXT,
  document_id     TEXT REFERENCES document(id),
  factor_count    INTEGER NOT NULL DEFAULT 0,
  imported_at     TEXT NOT NULL,
  created_at      TEXT NOT NULL
);
