# Phase 0 Task 11: Migration 004 — emission_source + activity_data + calculation_snapshot[_line]

> Extracted from `docs/plans/2026-05-09-carbonbook-phase-0-foundation.md` lines 1350-1475.
> Pre-split for context-budget reasons; canonical source remains the full plan.

---

### Task 11: Migration 004 — emission_source + activity_data + calculation_snapshot[_line]

**Files:**
- Create: `src/main/db/migrations/004_inventory.sql`

per spec §3 schema：emission_source 加 UNIQUE(id, site_id) 给 activity_data 复合 FK；activity_data 复合 FK 到 (emission_source_id, site_id) + 5 字段 EF FK + 真 extraction FK（因为 003 已建 extraction 表）。

- [ ] **Step 1: 写 004_inventory.sql**

```sql
-- spec §3: emission_source UNIQUE(id, site_id) → activity_data 复合 FK 锁住 site 一致性

CREATE TABLE emission_source (
  id              TEXT PRIMARY KEY,
  site_id         TEXT NOT NULL REFERENCES site(id),
  name            TEXT NOT NULL,
  scope           INTEGER NOT NULL CHECK(scope IN (1, 2, 3)),
  category        TEXT,
  ghg_protocol_path TEXT,
  default_ef_query TEXT CHECK(default_ef_query IS NULL OR json_valid(default_ef_query)),
  template_origin  TEXT,
  is_active        INTEGER NOT NULL DEFAULT 1,
  UNIQUE (id, site_id)
);
CREATE INDEX idx_emsrc_site ON emission_source(site_id);

CREATE TABLE activity_data (
  id               TEXT PRIMARY KEY,
  site_id          TEXT NOT NULL,
  emission_source_id TEXT NOT NULL,
  FOREIGN KEY (emission_source_id, site_id)
    REFERENCES emission_source(id, site_id),
  reporting_period_id TEXT NOT NULL REFERENCES reporting_period(id),

  occurred_at_start TEXT NOT NULL,
  occurred_at_end   TEXT NOT NULL,

  amount           REAL NOT NULL,
  unit             TEXT NOT NULL,

  ef_factor_code      TEXT NOT NULL,
  ef_year             INTEGER NOT NULL,
  ef_source           TEXT NOT NULL,
  ef_geography        TEXT NOT NULL,
  ef_dataset_version  TEXT NOT NULL,
  FOREIGN KEY (ef_factor_code, ef_year, ef_source, ef_geography, ef_dataset_version)
    REFERENCES pinned_emission_factor(factor_code, year, source, geography, dataset_version),

  computed_co2e_kg REAL NOT NULL,
  computed_at      TEXT NOT NULL,

  extraction_id    TEXT REFERENCES extraction(id),  -- 真 FK；NULL = 用户手填
  notes            TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX idx_activity_period ON activity_data(reporting_period_id, emission_source_id);
CREATE INDEX idx_activity_extraction ON activity_data(extraction_id);
CREATE INDEX idx_activity_ef ON activity_data(ef_factor_code, ef_year, ef_source, ef_geography, ef_dataset_version);

CREATE TABLE calculation_snapshot (
  id                  TEXT PRIMARY KEY,
  reporting_period_id TEXT NOT NULL REFERENCES reporting_period(id),
  frozen_at           TEXT NOT NULL,
  ef_dataset_versions TEXT NOT NULL CHECK(json_valid(ef_dataset_versions)),
  total_co2e_kg       REAL NOT NULL,
  scope1_kg           REAL NOT NULL,
  scope2_kg_location  REAL NOT NULL,
  scope2_kg_market    REAL,
  scope3_kg_by_cat    TEXT NOT NULL CHECK(json_valid(scope3_kg_by_cat)),
  report_metadata     TEXT CHECK(report_metadata IS NULL OR json_valid(report_metadata)),
  pdf_path            TEXT,
  excel_path          TEXT,
  parent_snapshot_id  TEXT REFERENCES calculation_snapshot(id),
  revision            INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_csnap_period_frozen ON calculation_snapshot(reporting_period_id, frozen_at);

CREATE TABLE calculation_snapshot_line (
  id                            TEXT PRIMARY KEY,
  calculation_snapshot_id       TEXT NOT NULL REFERENCES calculation_snapshot(id) ON DELETE RESTRICT,
  original_activity_data_id     TEXT,
  site_id_at_freeze             TEXT NOT NULL,
  site_name_at_freeze           TEXT NOT NULL,
  emission_source_id_at_freeze  TEXT NOT NULL,
  emission_source_name_at_freeze TEXT NOT NULL,
  reporting_period_id_at_freeze TEXT NOT NULL,
  occurred_at_start             TEXT NOT NULL,
  occurred_at_end               TEXT NOT NULL,
  amount                        REAL NOT NULL,
  unit                          TEXT NOT NULL,
  ef_input_unit                 TEXT NOT NULL,
  converted_amount              REAL NOT NULL,
  ef_factor_code                TEXT NOT NULL,
  ef_year                       INTEGER NOT NULL,
  ef_source                     TEXT NOT NULL,
  ef_geography                  TEXT NOT NULL,
  ef_dataset_version            TEXT NOT NULL,
  ef_co2e_kg_per_unit           REAL NOT NULL,
  ef_gwp_basis                  TEXT NOT NULL,
  computed_co2e_kg              REAL NOT NULL,
  scope                         INTEGER NOT NULL CHECK(scope IN (1, 2, 3)),
  category                      TEXT,
  ghg_protocol_path             TEXT,
  extraction_id_at_freeze       TEXT,
  document_id_at_freeze         TEXT,
  document_sha256_at_freeze     TEXT
);
CREATE INDEX idx_csl_snapshot ON calculation_snapshot_line(calculation_snapshot_id);
CREATE INDEX idx_csl_scope_cat ON calculation_snapshot_line(calculation_snapshot_id, scope, category);
```

- [ ] **Step 2: 跑测试**

Run: `pnpm test`
Expected: 所有测试通过

- [ ] **Step 3: Commit**

```bash
git add src/main/db/migrations/004_inventory.sql
git commit -m "Phase 0/Task 11: migration 004 (emission_source + activity_data + calc snapshots, FK to extraction)"
```

---

