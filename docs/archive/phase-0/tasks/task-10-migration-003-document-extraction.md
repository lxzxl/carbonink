# Phase 0 Task 10: Migration 003 — document + extraction (含 lifecycle CHECK)

> Extracted from `docs/plans/2026-05-09-carbonbook-phase-0-foundation.md` lines 1291-1349.
> Pre-split for context-budget reasons; canonical source remains the full plan.

---

### Task 10: Migration 003 — document + extraction (含 lifecycle CHECK)

**Files:**
- Create: `src/main/db/migrations/003_extraction.sql`

per spec §3：extraction.status × 字段填充 lifecycle CHECK（最终版含 round-6 修订）。先于 inventory 落地，让 activity_data.extraction_id 能有真 FK。

- [ ] **Step 1: 写 003_extraction.sql**

```sql
CREATE TABLE document (
  id            TEXT PRIMARY KEY,
  sha256        TEXT NOT NULL UNIQUE,
  filename      TEXT NOT NULL,
  mime_type     TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  storage_path  TEXT NOT NULL,
  uploaded_at   TEXT NOT NULL,
  uploaded_by   TEXT
);

CREATE TABLE extraction (
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
    (status IN ('parsed', 'review_needed') AND raw_response IS NOT NULL AND parsed_json IS NOT NULL AND error_json IS NULL)
    OR
    (status = 'rejected' AND parsed_json IS NULL AND (raw_response IS NOT NULL OR error_json IS NOT NULL))
  )
);
```

- [ ] **Step 2: 跑测试**

Run: `pnpm test`
Expected: 所有现有测试通过

- [ ] **Step 3: Commit**

```bash
git add src/main/db/migrations/003_extraction.sql
git commit -m "Phase 0/Task 10: migration 003 (document + extraction lifecycle)"
```

---

