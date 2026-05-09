# Phase 0 Task 9: Migration 002 — emission_factor + pinned_emission_factor

> Extracted from `docs/plans/2026-05-09-carbonbook-phase-0-foundation.md` lines 1204-1290.
> Pre-split for context-budget reasons; canonical source remains the full plan.

---

### Task 9: Migration 002 — emission_factor + pinned_emission_factor

**Files:**
- Create: `src/main/db/migrations/002_emission_factors.sql`

per spec §3 schema. EF 表本身在 app.sqlite（用户上传 EF + 也作为后续 ef_library.sqlite attach 的 schema 模板），pinned 表保证 activity_data FK 在 app.sqlite 同库内可用。

- [ ] **Step 1: 写 002_emission_factors.sql**

```sql
-- spec §3: emission_factor (UNION readonly RO + user-uploaded) + pinned_emission_factor (在 app.sqlite, FK 目标)

CREATE TABLE emission_factor (
  factor_code      TEXT NOT NULL,
  year             INTEGER NOT NULL,
  source           TEXT NOT NULL,
  geography        TEXT NOT NULL,
  dataset_version  TEXT NOT NULL,
  PRIMARY KEY (factor_code, year, source, geography, dataset_version),

  scope            INTEGER NOT NULL CHECK(scope IN (1, 2, 3)),
  category         TEXT,
  ghg_protocol_path TEXT,
  input_unit       TEXT NOT NULL,
  co2e_kg_per_unit REAL NOT NULL,
  ch4_kg_per_unit  REAL,
  n2o_kg_per_unit  REAL,
  hfc_kg_per_unit  REAL,
  pfc_kg_per_unit  REAL,
  sf6_kg_per_unit  REAL,
  nf3_kg_per_unit  REAL,
  gwp_basis        TEXT NOT NULL CHECK(gwp_basis IN ('AR5', 'AR6')),
  name_zh          TEXT,
  name_en          TEXT,
  description_zh   TEXT,
  description_en   TEXT,
  notes            TEXT,
  citation_url     TEXT
);
CREATE INDEX idx_ef_lookup ON emission_factor(factor_code, year, geography);
CREATE INDEX idx_ef_scope_cat ON emission_factor(scope, category);

CREATE TABLE pinned_emission_factor (
  factor_code      TEXT NOT NULL,
  year             INTEGER NOT NULL,
  source           TEXT NOT NULL,
  geography        TEXT NOT NULL,
  dataset_version  TEXT NOT NULL,
  PRIMARY KEY (factor_code, year, source, geography, dataset_version),

  scope            INTEGER NOT NULL CHECK(scope IN (1, 2, 3)),
  category         TEXT,
  ghg_protocol_path TEXT,
  input_unit       TEXT NOT NULL,
  co2e_kg_per_unit REAL NOT NULL,
  ch4_kg_per_unit  REAL,
  n2o_kg_per_unit  REAL,
  hfc_kg_per_unit  REAL,
  pfc_kg_per_unit  REAL,
  sf6_kg_per_unit  REAL,
  nf3_kg_per_unit  REAL,
  gwp_basis        TEXT NOT NULL CHECK(gwp_basis IN ('AR5', 'AR6')),
  name_zh          TEXT,
  name_en          TEXT,
  description_zh   TEXT,
  description_en   TEXT,
  citation_url     TEXT,

  pinned_at        TEXT NOT NULL,
  pinned_from      TEXT NOT NULL
);
```

- [ ] **Step 2: 跑现有测试确认 schema 加载不破**

Run: `pnpm test`
Expected: 所有现有测试 PASS（migrations 仍能干净跑完）

- [ ] **Step 3: Commit**

```bash
git add src/main/db/migrations/002_emission_factors.sql
git commit -m "Phase 0/Task 9: migration 002 (emission_factor + pinned_emission_factor)"
```

---

