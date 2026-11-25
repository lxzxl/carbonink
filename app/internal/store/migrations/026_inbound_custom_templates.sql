-- 026_inbound_custom_templates.sql
-- User-authored inbound supplier disclosure templates
-- (spec: docs/specs/2026-11-25-inbound-template-editor.md).

CREATE TABLE inbound_template (
  id                TEXT PRIMARY KEY,
  kind              TEXT NOT NULL UNIQUE,
  label_zh          TEXT NOT NULL,
  label_en          TEXT NOT NULL,
  scope             INTEGER NOT NULL DEFAULT 3 CHECK(scope = 3),
  category          TEXT NOT NULL,
  ghg_protocol_path TEXT NOT NULL,
  ef_category       TEXT,
  tier1_unit        TEXT,
  default_unit      TEXT,
  questions_json    TEXT NOT NULL CHECK(json_valid(questions_json)),
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
