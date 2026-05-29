# Phase 0 Task 8: Migration 001_core.sql — organization / site / reporting_period

> Extracted from `docs/plans/2026-05-09-carbonbook-phase-0-foundation.md` lines 1089-1203.
> Pre-split for context-budget reasons; canonical source remains the full plan.

---

### Task 8: Migration 001_core.sql — organization / site / reporting_period

**Files:**
- Create: `src/main/db/migrations/001_core.sql`
- Create: `tests/main/db/schema.test.ts` (FK 强制 smoke test)

per spec §3 ER 图：organization (1 row 单机) → site (N) ← reporting_period (N independent of site)

- [ ] **Step 1: 写 001_core.sql**

```sql
-- spec §1: 单机一个 organization；N 个 site；N 个 reporting_period

CREATE TABLE organization (
  id            TEXT PRIMARY KEY,
  -- spec §1: 单机一个 organization。用 singleton_key 列 + UNIQUE + CHECK 在 DB 层硬约束。
  -- 任何 INSERT 都会写 singleton_key = 1；第二次 INSERT 必失败（UNIQUE 冲突）。
  singleton_key INTEGER NOT NULL DEFAULT 1 CHECK (singleton_key = 1) UNIQUE,
  name_zh       TEXT,
  name_en       TEXT,
  industry      TEXT,
  country_code  TEXT NOT NULL,
  boundary_kind TEXT NOT NULL CHECK(boundary_kind IN ('equity_share', 'operational_control')),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE site (
  id            TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organization(id),
  name_zh       TEXT,
  name_en       TEXT,
  address       TEXT,
  country_code  TEXT NOT NULL,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX idx_site_org ON site(organization_id);

CREATE TABLE reporting_period (
  id            TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organization(id),
  year          INTEGER NOT NULL,
  granularity   TEXT NOT NULL CHECK(granularity IN ('annual', 'quarterly', 'monthly')),
  starts_at     TEXT NOT NULL,
  ends_at       TEXT NOT NULL,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  UNIQUE (organization_id, year, granularity)
);
CREATE INDEX idx_period_org_year ON reporting_period(organization_id, year);
```

- [ ] **Step 2: 写测试 tests/main/db/schema.test.ts**

```ts
import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { openAppDb, closeAppDb } from '@main/db/connection';
import { runMigrations } from '@main/db/migrate';

describe('schema integrity (FK enforcement smoke)', () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `carbonbook-schema-${Date.now()}-${Math.random()}.sqlite`);
  });

  afterEach(() => {
    closeAppDb();
    try { rmSync(dbPath); } catch { /* ignore */ }
  });

  it('rejects site row pointing to non-existent organization', () => {
    const db = openAppDb(dbPath);
    runMigrations(db);
    const insertBadSite = () =>
      db.prepare(
        'INSERT INTO site (id, organization_id, country_code, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      ).run('site_1', 'org_does_not_exist', 'CN', '2026-01-01', '2026-01-01');
    expect(insertBadSite).toThrow(/FOREIGN KEY/i);
  });

  it('accepts site row pointing to existing organization', () => {
    const db = openAppDb(dbPath);
    runMigrations(db);
    db.prepare(
      'INSERT INTO organization (id, country_code, boundary_kind, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run('org_1', 'CN', 'operational_control', '2026-01-01', '2026-01-01');
    expect(() =>
      db.prepare(
        'INSERT INTO site (id, organization_id, country_code, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      ).run('site_1', 'org_1', 'CN', '2026-01-01', '2026-01-01'),
    ).not.toThrow();
  });
});
```

- [ ] **Step 3: 跑测试确认通过**

Run: `pnpm test tests/main/db/schema.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 4: Commit**

```bash
git add src/main/db/migrations/001_core.sql tests/main/db/schema.test.ts
git commit -m "Phase 0/Task 8: migration 001 (organization, site, reporting_period) + FK smoke test"
```

---

