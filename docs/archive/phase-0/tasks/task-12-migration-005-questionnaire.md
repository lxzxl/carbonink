# Phase 0 Task 12: Migration 005 — questionnaire 全家桶

> Extracted from `docs/plans/2026-05-09-carbonbook-phase-0-foundation.md` lines 1476-1594.
> Pre-split for context-budget reasons; canonical source remains the full plan.

---

### Task 12: Migration 005 — questionnaire 全家桶

**Files:**
- Create: `src/main/db/migrations/005_questionnaire.sql`

per spec §3 schema：customer / questionnaire / question (含 signature_version + normalized_text) / question_mapping (无 sql) / answer (typed FK + 互斥 CHECK) / company_profile / narrative_bank。

- [ ] **Step 1: 写 005_questionnaire.sql**

```sql
CREATE TABLE customer (
  id      TEXT PRIMARY KEY,
  name    TEXT NOT NULL,
  notes   TEXT
);

CREATE TABLE questionnaire (
  id            TEXT PRIMARY KEY,
  customer_id   TEXT NOT NULL REFERENCES customer(id),
  document_id   TEXT NOT NULL REFERENCES document(id),
  template_kind TEXT,
  reporting_year INTEGER NOT NULL,
  status        TEXT NOT NULL CHECK(status IN ('parsing', 'mapping', 'answering', 'exported')),
  due_date      TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE question (
  id              TEXT PRIMARY KEY,
  questionnaire_id TEXT NOT NULL REFERENCES questionnaire(id),
  question_signature TEXT NOT NULL,
  signature_version TEXT NOT NULL,
  normalized_text TEXT NOT NULL,
  raw_text        TEXT NOT NULL,
  parsed_intent   TEXT,
  question_kind   TEXT NOT NULL CHECK(question_kind IN ('numerical', 'categorical', 'narrative')),
  expected_unit   TEXT,
  position        TEXT,
  required        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_question_signature ON question(question_signature, signature_version);
CREATE UNIQUE INDEX uq_question_questionnaire_position
  ON question(questionnaire_id, position)
  WHERE position IS NOT NULL;

CREATE TABLE question_mapping (
  question_signature TEXT NOT NULL,
  signature_version  TEXT NOT NULL,
  customer_id        TEXT NOT NULL REFERENCES customer(id),
  mapping_kind       TEXT NOT NULL CHECK(mapping_kind IN ('inventory_path', 'literal', 'manual')),
  mapping_payload    TEXT NOT NULL CHECK(json_valid(mapping_payload)),
  confidence         REAL,
  reviewed_by_user_at TEXT,
  created_at         TEXT NOT NULL,
  PRIMARY KEY (question_signature, signature_version, customer_id)
);

CREATE TABLE company_profile (
  key         TEXT PRIMARY KEY,
  value       TEXT,
  kind        TEXT NOT NULL CHECK(kind IN ('string', 'date', 'url', 'json', 'narrative')),
  updated_at  TEXT NOT NULL,
  notes       TEXT
);

CREATE TABLE narrative_bank (
  id          TEXT PRIMARY KEY,
  topic       TEXT NOT NULL,
  language    TEXT NOT NULL CHECK(language IN ('zh', 'en')),
  body        TEXT NOT NULL,
  last_used_at TEXT,
  used_count  INTEGER DEFAULT 0
);

CREATE TABLE answer (
  id              TEXT PRIMARY KEY,
  question_id     TEXT NOT NULL UNIQUE REFERENCES question(id),
  value           TEXT NOT NULL,
  unit            TEXT,
  source_kind     TEXT NOT NULL CHECK(source_kind IN ('mapped_inventory', 'manual', 'ai_suggested')),

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
    (source_kind IN ('manual', 'ai_suggested') AND
      ((source_calculation_snapshot_id IS NOT NULL) +
       (source_activity_data_id IS NOT NULL) +
       (source_company_profile_key IS NOT NULL) +
       (source_narrative_bank_id IS NOT NULL)) <= 1)
  )
);
```

- [ ] **Step 2: 跑测试**

Run: `pnpm test`
Expected: 所有测试通过

- [ ] **Step 3: Commit**

```bash
git add src/main/db/migrations/005_questionnaire.sql
git commit -m "Phase 0/Task 12: migration 005 (questionnaire + mapping + answer with constraints)"
```

---

