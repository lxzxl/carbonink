-- 023_extraction_raw_optional.sql
-- Allow a confirmed extraction to keep its parsed fields while its raw LLM
-- response is cleared.
--
-- Settings → Data → Clear LLM cache nulls `raw_response` on parsed rows to
-- reclaim the largest cache in the database. The original CHECK required a
-- parsed row to have a raw response, so that UPDATE failed with a constraint
-- error and the button could never do its job. The raw response is
-- diagnostic only once `parsed_json` is committed: clearing it must not
-- invalidate the row.
--
-- SQLite cannot ALTER a CHECK in place; rebuild the table. Migration 017
-- documents the defer_foreign_keys pattern this follows.

PRAGMA defer_foreign_keys = ON;

CREATE TABLE extraction_new (
  id            TEXT PRIMARY KEY,
  document_id   TEXT NOT NULL REFERENCES document(id),
  llm_provider  TEXT NOT NULL,
  llm_model     TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  raw_response  TEXT,
  parsed_json   TEXT CHECK(parsed_json IS NULL OR json_valid(parsed_json)),
  error_json    TEXT CHECK(error_json IS NULL OR json_valid(error_json)),
  status        TEXT NOT NULL CHECK(status IN ('pending', 'parsed', 'review_needed', 'rejected')),
  reviewed_by_user_at TEXT,
  cost_usd      REAL,
  created_at    TEXT NOT NULL,
  UNIQUE (document_id, prompt_version, llm_provider, llm_model),
  CHECK (
    (status = 'pending' AND raw_response IS NULL AND parsed_json IS NULL AND error_json IS NULL)
    OR
    (status IN ('parsed', 'review_needed') AND parsed_json IS NOT NULL AND error_json IS NULL)
    OR
    (status = 'rejected' AND parsed_json IS NULL AND (raw_response IS NOT NULL OR error_json IS NOT NULL))
  )
);

INSERT INTO extraction_new
  (id, document_id, llm_provider, llm_model, prompt_version, raw_response,
   parsed_json, error_json, status, reviewed_by_user_at, cost_usd, created_at)
  SELECT id, document_id, llm_provider, llm_model, prompt_version, raw_response,
         parsed_json, error_json, status, reviewed_by_user_at, cost_usd, created_at
  FROM extraction;

DROP TABLE extraction;
ALTER TABLE extraction_new RENAME TO extraction;
