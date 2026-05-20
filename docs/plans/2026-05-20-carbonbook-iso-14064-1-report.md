# ISO 14064-1 Inventory Report — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/reports` route producing an ISO 14064-1-inspired PDF (main report) + Excel (appendix) for any `reporting_period`, with LLM-generated narrative the user reviews/edits before export.

**Architecture:** Schema-additive migration (015) for organizational boundary metadata + biogenic CO2 factor. New `ReportDataService` (pure read) → `LlmReportNarrativeService` (AI SDK `streamObject` with `abortSignal`) → renderer preview/edit → `ReportExportService` (hidden BrowserWindow + `printToPDF` for PDF, `exceljs` for xlsx). One visual React component for both preview and print render — same DOM, different CSS via `printMode` prop. 4 invoke IPC channels + 1 push channel for progress events.

**Tech Stack:** TypeScript strict, Electron 41 `printToPDF`, AI SDK 6 `streamObject`, Effect TS 3.21 (typed errors), zod, React 18, TanStack Router/Query, better-sqlite3, exceljs (already in deps), paraglide JS i18n, vitest.

**Spec:** `docs/specs/2026-05-20-iso-14064-1-report-design.md` (commits `0bc31fb` + `9e5aa9c` corrections).

**Baseline:** 553 tests on `main`. Target after Phase 3 sub-project 1: ~578 tests.

**Sub-project context:** This is sub-project 1 of 4 in Phase 3. The other 3 candidates (PDF rearrange export, EF rebind UI, audit_event UI) each get their own brainstorm → spec → plan → implement cycle later.

**Recurring environmental hazard:** better-sqlite3 ABI flip between Node (vitest) and Electron (dev/build). If a task suddenly produces 184+ test failures all citing `NODE_MODULE_VERSION 145`, recover with:

```bash
rm node_modules/.pnpm/better-sqlite3@12.9.0/node_modules/better-sqlite3/build/Release/better_sqlite3.node
pnpm rebuild better-sqlite3
```

This is environmental, not a regression — do not try to "fix" it in code.

---

## Task 1: Migration 015 + Zod schema updates

**Files:**
- Create: `src/main/db/migrations/015_iso_report_schema.sql`
- Modify: `src/shared/schemas/organization.ts`
- Modify: `src/shared/schemas/reporting-period.ts`
- Modify: `src/shared/types.ts` — `EmissionFactor` gets `biogenic_co2_factor`
- Modify: `tests/main/db/migrations.test.ts` (or whatever name the existing migration test has)
- Create: `tests/main/db/migration-015.test.ts`

Migration extends `organization.boundary_kind` CHECK (requires temp-table rebuild — same pattern as 014), adds 4 new nullable columns to `organization`, 2 to `reporting_period`, 1 to `emission_factor`.

- [ ] **Step 1: Write the failing migration test**

Create `tests/main/db/migration-015.test.ts`:

```ts
import { runMigrations } from '@main/db/migrate';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

describe('migration 015 — ISO 14064-1 schema additions', () => {
  it('applies cleanly on a fresh DB and adds the expected columns', () => {
    const db = new Database(':memory:');
    runMigrations(db);

    const orgCols = db
      .prepare(`PRAGMA table_info(organization)`)
      .all() as Array<{ name: string }>;
    const orgColNames = new Set(orgCols.map((c) => c.name));
    expect(orgColNames).toContain('boundary_kind');
    expect(orgColNames).toContain('responsible_person_name');
    expect(orgColNames).toContain('responsible_person_role');
    expect(orgColNames).toContain('base_year_period_id');
    expect(orgColNames).toContain('recalc_threshold_pct');

    const periodCols = db
      .prepare(`PRAGMA table_info(reporting_period)`)
      .all() as Array<{ name: string }>;
    const periodColNames = new Set(periodCols.map((c) => c.name));
    expect(periodColNames).toContain('significant_changes_text');
    expect(periodColNames).toContain('recalculation_reason');

    const efCols = db
      .prepare(`PRAGMA table_info(emission_factor)`)
      .all() as Array<{ name: string }>;
    const efColNames = new Set(efCols.map((c) => c.name));
    expect(efColNames).toContain('biogenic_co2_factor');

    db.close();
  });

  it('extends organization.boundary_kind CHECK to allow financial_control', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    // Insert an org with the newly-allowed value — should not throw.
    db.prepare(
      `INSERT INTO organization (id, name_zh, country_code, boundary_kind, created_at, updated_at)
       VALUES ('org-1', '测试', 'CN', 'financial_control', '2026-01-01', '2026-01-01')`,
    ).run();
    const row = db
      .prepare(`SELECT boundary_kind FROM organization WHERE id = 'org-1'`)
      .get() as { boundary_kind: string };
    expect(row.boundary_kind).toBe('financial_control');
    db.close();
  });

  it('preserves existing organization rows after the boundary_kind rebuild', () => {
    const db = new Database(':memory:');
    // Run migrations through 014 only by aborting before 015.
    // Easiest: run all migrations, insert a row with the existing values,
    // re-run migrations (no-op), confirm row preserved.
    runMigrations(db);
    db.prepare(
      `INSERT INTO organization (id, name_zh, country_code, boundary_kind, created_at, updated_at)
       VALUES ('org-keep', '保留', 'CN', 'equity_share', '2026-01-01', '2026-01-01')`,
    ).run();
    // Migrations are idempotent via the version table — running again is a no-op.
    runMigrations(db);
    const row = db
      .prepare(`SELECT * FROM organization WHERE id = 'org-keep'`)
      .get() as { boundary_kind: string; responsible_person_name: string | null };
    expect(row.boundary_kind).toBe('equity_share');
    expect(row.responsible_person_name).toBeNull();
    db.close();
  });
});
```

- [ ] **Step 2: Run, confirm fail**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/main/db/migration-015.test.ts --pool=threads 2>&1 | tail -15
```

Expected: FAIL — `expect(orgColNames).toContain('responsible_person_name')` because the migration doesn't exist yet.

- [ ] **Step 3: Write the migration SQL**

Create `src/main/db/migrations/015_iso_report_schema.sql`. NOTE: no inner `BEGIN`/`COMMIT` — `migrate.ts` wraps the whole file in a `db.transaction()`. Inner BEGIN will throw "cannot start a transaction within a transaction".

```sql
-- 015_iso_report_schema.sql
-- ISO 14064-1 report schema additions (Phase 3 sub-project 1):
-- 1. organization: extend boundary_kind CHECK to add 'financial_control',
--    add responsible person + base year + recalc threshold fields.
--    Requires temp-table rebuild because SQLite cannot ALTER CHECK.
-- 2. reporting_period: ADD significant_changes_text + recalculation_reason.
-- 3. emission_factor: ADD biogenic_co2_factor.

PRAGMA foreign_keys = OFF;

-- 1. Rebuild organization (CHECK constraint widening + new columns).
CREATE TABLE organization_new (
  id              TEXT PRIMARY KEY,
  singleton_key   INTEGER NOT NULL DEFAULT 1 CHECK (singleton_key = 1) UNIQUE,
  name_zh         TEXT,
  name_en         TEXT,
  industry        TEXT,
  country_code    TEXT NOT NULL,
  boundary_kind   TEXT NOT NULL
    CHECK(boundary_kind IN ('equity_share', 'financial_control', 'operational_control')),
  responsible_person_name TEXT,
  responsible_person_role TEXT,
  base_year_period_id     TEXT REFERENCES reporting_period(id),
  recalc_threshold_pct    REAL NOT NULL DEFAULT 5.0,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

INSERT INTO organization_new (
  id, singleton_key, name_zh, name_en, industry, country_code, boundary_kind,
  responsible_person_name, responsible_person_role, base_year_period_id,
  recalc_threshold_pct, created_at, updated_at
)
SELECT
  id, singleton_key, name_zh, name_en, industry, country_code, boundary_kind,
  NULL, NULL, NULL, 5.0, created_at, updated_at
FROM organization;

DROP TABLE organization;
ALTER TABLE organization_new RENAME TO organization;

-- 2. reporting_period: ADD COLUMN (additive, no rebuild).
ALTER TABLE reporting_period ADD COLUMN significant_changes_text TEXT;
ALTER TABLE reporting_period ADD COLUMN recalculation_reason     TEXT;

-- 3. emission_factor: ADD COLUMN (additive).
ALTER TABLE emission_factor ADD COLUMN biogenic_co2_factor REAL;

PRAGMA foreign_keys = ON;
```

- [ ] **Step 4: Run migration test alone — confirm pass**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/main/db/migration-015.test.ts --pool=threads 2>&1 | tail -10
```

Expected: 3/3 pass.

- [ ] **Step 5: Update Zod schemas**

Edit `src/shared/schemas/organization.ts`. Replace the file body:

```ts
import { z } from 'zod';
import { optionalString } from './_helpers.js';

export const organizationKindEnum = z.enum([
  'equity_share',
  'financial_control',
  'operational_control',
]);

export const organizationCreateInput = z
  .object({
    name_zh: optionalString({ max: 255 }),
    name_en: optionalString({ max: 255 }),
    industry: optionalString({ max: 100 }),
    country_code: z.string().min(2).max(3),
    boundary_kind: organizationKindEnum,
  })
  .refine((v) => v.name_zh || v.name_en, {
    message: 'At least one of name_zh / name_en is required',
  });

export const organization = z.object({
  id: z.string(),
  name_zh: z.string().nullable(),
  name_en: z.string().nullable(),
  industry: z.string().nullable(),
  country_code: z.string(),
  boundary_kind: organizationKindEnum,
  responsible_person_name: z.string().nullable(),
  responsible_person_role: z.string().nullable(),
  base_year_period_id: z.string().nullable(),
  recalc_threshold_pct: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type Organization = z.infer<typeof organization>;
export type OrganizationCreateInput = z.infer<typeof organizationCreateInput>;
```

Edit `src/shared/schemas/reporting-period.ts`. Replace the `reportingPeriod` const:

```ts
export const reportingPeriod = z.object({
  id: z.string(),
  organization_id: z.string(),
  year: z.number().int(),
  granularity: granularityDbEnum,
  starts_at: z.string(),
  ends_at: z.string(),
  is_active: z.number(),
  created_at: z.string(),
  significant_changes_text: z.string().nullable(),
  recalculation_reason: z.string().nullable(),
});
```

Edit `src/shared/types.ts`. Inside the `EmissionFactor` type, add (after `notes`):

```ts
  biogenic_co2_factor: number | null;
```

Do the same for `PinnedEmissionFactor` — it's defined as `Omit<EmissionFactor, 'notes'> & { ... }`; since the new column is on `emission_factor` only (not `pinned_emission_factor`), explicitly omit it from the Pinned type:

Search for `PinnedEmissionFactor` in `src/shared/types.ts`. Change:
```ts
export type PinnedEmissionFactor = Omit<EmissionFactor, 'notes'> & {
```
to:
```ts
export type PinnedEmissionFactor = Omit<EmissionFactor, 'notes' | 'biogenic_co2_factor'> & {
```

- [ ] **Step 6: Verify typecheck + full test suite**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck 2>&1 | tail -10
pnpm vitest run --pool=threads 2>&1 | tail -8
```

Expected: typecheck clean; ~556 tests passing (553 + 3 new migration tests).

- [ ] **Step 7: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add src/main/db/migrations/015_iso_report_schema.sql \
        src/shared/schemas/organization.ts \
        src/shared/schemas/reporting-period.ts \
        src/shared/types.ts \
        tests/main/db/migration-015.test.ts
git commit -m "feat(db): migration 015 — ISO 14064-1 schema (boundary_kind widen + report fields)"
git branch --show-current
```

Expected: branch `main`.

---

## Task 2: OrganizationService extensions + Settings UI section

**Files:**
- Modify: `src/main/services/organization-service.ts`
- Modify: `tests/main/services/organization-service.test.ts`
- Modify: `src/renderer/components/SettingsDrawerContent.tsx`
- Modify: `messages/en.json`, `messages/zh-CN.json`

The user must be able to set `boundary_kind` (extended enum), `responsible_person_name`, `responsible_person_role`, `base_year_period_id` from the Settings drawer. `recalc_threshold_pct` stays hidden in v1.

- [ ] **Step 1: Write the failing service test**

Open `tests/main/services/organization-service.test.ts`. Append:

```ts
describe('OrganizationService.updateReportingProfile', () => {
  it('updates responsible person + boundary + base_year_period_id', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const svc = new OrganizationService({ db });

    // Seed an org first via the existing onboarding helper or direct insert.
    db.prepare(
      `INSERT INTO organization (id, name_zh, country_code, boundary_kind, created_at, updated_at)
       VALUES ('org-1', '测试公司', 'CN', 'equity_share', '2026-01-01', '2026-01-01')`,
    ).run();
    db.prepare(
      `INSERT INTO reporting_period (id, organization_id, year, granularity, starts_at, ends_at, is_active, created_at)
       VALUES ('per-2024', 'org-1', 2024, 'annual', '2024-01-01', '2024-12-31', 0, '2024-01-01')`,
    ).run();

    svc.updateReportingProfile({
      id: 'org-1',
      boundary_kind: 'financial_control',
      responsible_person_name: '张三',
      responsible_person_role: '可持续发展负责人',
      base_year_period_id: 'per-2024',
    });

    const row = db.prepare(`SELECT * FROM organization WHERE id = 'org-1'`).get() as {
      boundary_kind: string;
      responsible_person_name: string;
      base_year_period_id: string;
    };
    expect(row.boundary_kind).toBe('financial_control');
    expect(row.responsible_person_name).toBe('张三');
    expect(row.base_year_period_id).toBe('per-2024');
    db.close();
  });
});
```

- [ ] **Step 2: Run, confirm fail**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/main/services/organization-service.test.ts --pool=threads 2>&1 | tail -10
```

Expected: FAIL — `svc.updateReportingProfile is not a function`.

- [ ] **Step 3: Implement the service method**

Open `src/main/services/organization-service.ts`. Add this method to the class:

```ts
  updateReportingProfile(input: {
    id: string;
    boundary_kind: 'equity_share' | 'financial_control' | 'operational_control';
    responsible_person_name: string | null;
    responsible_person_role: string | null;
    base_year_period_id: string | null;
  }): void {
    const now = new Date().toISOString();
    this.deps.db
      .prepare(
        `UPDATE organization
            SET boundary_kind = ?,
                responsible_person_name = ?,
                responsible_person_role = ?,
                base_year_period_id = ?,
                updated_at = ?
          WHERE id = ?`,
      )
      .run(
        input.boundary_kind,
        input.responsible_person_name,
        input.responsible_person_role,
        input.base_year_period_id,
        now,
        input.id,
      );
  }
```

- [ ] **Step 4: Wire the IPC channel for the renderer**

Edit `src/main/ipc/types.ts`. Add to the `IpcTypeMap`:

```ts
  'org:update-reporting-profile': (input: {
    id: string;
    boundary_kind: 'equity_share' | 'financial_control' | 'operational_control';
    responsible_person_name: string | null;
    responsible_person_role: string | null;
    base_year_period_id: string | null;
  }) => void;
```

Edit `src/main/ipc/handlers/organization.ts` — append a new handler entry that calls `svc.updateReportingProfile(input)`.

Edit `src/preload/bridge.ts` — add `'org:update-reporting-profile'` to `allowedChannels` (organization domain section).

Edit `tests/preload/bridge.test.ts` — extend the `allowedChannels` assertion to include the new channel.

Edit `src/renderer/lib/api/organization.ts` (or whatever the existing renderer client file is). Add:

```ts
  updateReportingProfile: (input: { /* same shape */ }) =>
    invoke('org:update-reporting-profile', input),
```

- [ ] **Step 5: Settings UI section**

Open `src/renderer/components/SettingsDrawerContent.tsx`. Add a new section AFTER the MCP section (which lives at the bottom of the drawer per the Phase 2 layout). The new section's heading is "组织档案 (ISO 14064-1)" / "Organization Profile (ISO 14064-1)".

Add a TanStack Query `useQuery` for the current org (via existing `org:get-current` channel) and an `useMutation` for `org:update-reporting-profile`. The section contains:

- A radio group for `boundary_kind` with 3 options: 股权法 / 财务控制法 / 运营控制法 (zh-CN), Equity share / Financial control / Operational control (en)
- Text input for `responsible_person_name`
- Text input for `responsible_person_role`
- Dropdown for `base_year_period_id` populated from `org:list-reporting-periods` (existing channel)
- Save button → calls mutation → invalidates org query

Code shape (using existing component patterns from the MCP section):

```tsx
function OrganizationProfileSection() {
  const orgQuery = useQuery({ queryKey: ['org:get-current'], queryFn: () => orgApi.getCurrent() });
  const periodsQuery = useQuery({
    queryKey: ['org:list-reporting-periods', orgQuery.data?.id],
    queryFn: () => orgApi.listReportingPeriods({ organization_id: orgQuery.data!.id }),
    enabled: !!orgQuery.data?.id,
  });
  const mutate = useMutation({
    mutationFn: (input: ReportingProfileInput) => orgApi.updateReportingProfile(input),
    onSuccess: () => {
      toast.success(m.settings_reporting_profile_saved());
      queryClient.invalidateQueries({ queryKey: ['org:get-current'] });
    },
  });
  // ... form state + render
}
```

- [ ] **Step 6: i18n keys**

Add to `messages/en.json` and `messages/zh-CN.json` (alphabetically near other `settings_*` keys):

```
settings_org_profile_heading              "Organization Profile (ISO 14064-1)"  /  "组织档案 (ISO 14064-1)"
settings_org_profile_subheading           "Used by the inventory report."        /  "用于盘查报告。"
settings_boundary_label                   "Consolidation approach"               /  "合并方法"
settings_boundary_equity_share            "Equity share"                         /  "股权法"
settings_boundary_financial_control       "Financial control"                    /  "财务控制法"
settings_boundary_operational_control     "Operational control"                  /  "运营控制法"
settings_responsible_name_label           "Responsible person — name"            /  "责任人 — 姓名"
settings_responsible_role_label           "Responsible person — role"            /  "责任人 — 职务"
settings_base_year_label                  "Base year"                            /  "基准年"
settings_base_year_none                   "(not selected)"                       /  "(未选)"
settings_reporting_profile_save           "Save profile"                         /  "保存档案"
settings_reporting_profile_saved          "Organization profile updated."        /  "组织档案已更新。"
```

If paraglide needs explicit compile:

```bash
cd /Users/lxz/ws/personal/carbonbook
npx paraglide-js compile --project ./project.inlang --outdir ./src/renderer/paraglide
```

- [ ] **Step 7: Verify**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck 2>&1 | tail -10
pnpm vitest run --pool=threads 2>&1 | tail -8
```

Expected: typecheck clean; ~557 tests (556 + 1 service test).

- [ ] **Step 8: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add -A
git commit -m "feat(settings): organization profile section + updateReportingProfile service"
git branch --show-current
```

---

## Task 3: ReportDataService — assembles InventoryReportData

**Files:**
- Create: `src/main/services/report-data-service.ts`
- Create: `tests/main/services/report-data-service.test.ts`

Pure read-side query layer. Joins org + period + sites + sources + activities + EFs. Computes scope totals + biogenic separated total + top-source share percentages. No LLM, no I/O beyond db.

- [ ] **Step 1: Write the failing test**

Create `tests/main/services/report-data-service.test.ts`:

```ts
import { ReportDataService } from '@main/services/report-data-service';
import { runMigrations } from '@main/db/migrate';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

function seedInventory(db: Database.Database) {
  // Organization with 1 site, 1 period, 3 sources across scope 1+2+3, 4 activities.
  db.prepare(
    `INSERT INTO organization (id, name_zh, name_en, industry, country_code, boundary_kind,
       responsible_person_name, responsible_person_role, recalc_threshold_pct, created_at, updated_at)
     VALUES ('org-1', '测试公司', 'Test Co', '制造业', 'CN', 'operational_control',
       '张三', '可持续发展负责人', 5.0, '2026-01-01', '2026-01-01')`,
  ).run();
  db.prepare(
    `INSERT INTO site (id, organization_id, name_zh, name_en, address, country_code, is_active, created_at, updated_at)
     VALUES ('site-1', 'org-1', '北京工厂', 'Beijing Plant', '北京市朝阳区', 'CN', 1, '2026-01-01', '2026-01-01')`,
  ).run();
  db.prepare(
    `INSERT INTO reporting_period (id, organization_id, year, granularity, starts_at, ends_at, is_active, created_at)
     VALUES ('per-2025', 'org-1', 2025, 'annual', '2025-01-01', '2025-12-31', 1, '2025-01-01')`,
  ).run();
  // Need 3 emission_sources to exercise scope 1/2/3.
  db.prepare(
    `INSERT INTO emission_source (id, organization_id, site_id, name, scope, created_at)
     VALUES ('src-1', 'org-1', 'site-1', '公司车队柴油', 1, '2026-01-01'),
            ('src-2', 'org-1', 'site-1', '电网电力', 2, '2026-01-01'),
            ('src-3', 'org-1', 'site-1', '外购运输', 3, '2026-01-01')`,
  ).run();
  // Pin 3 EFs (one per source). Schema: pinned_emission_factor has composite PK.
  db.prepare(
    `INSERT INTO pinned_emission_factor (
       factor_code, year, source, geography, dataset_version, scope, category,
       ghg_protocol_path, input_unit, co2e_kg_per_unit, gwp_basis,
       pinned_at, pinned_from
     ) VALUES
     ('diesel_kg', 2025, 'IPCC', 'CN', '2025.1', 1, 'fuel', 'scope1', 'kg', 3.16, 'AR5', '2025-01-01', 'app.sqlite'),
     ('grid_kwh',  2025, 'MEE',  'CN', '2025.1', 2, 'electricity', 'scope2', 'kWh', 0.5703, 'AR5', '2025-01-01', 'app.sqlite'),
     ('truck_tkm', 2025, 'IPCC', 'CN', '2025.1', 3, 'transport', 'scope3', 't*km', 0.11, 'AR5', '2025-01-01', 'app.sqlite')`,
  ).run();
  // 4 activities — note co2e_kg is precomputed
  db.prepare(
    `INSERT INTO activity_data (id, emission_source_id, reporting_period_id, amount, unit,
       pinned_ef_factor_code, pinned_ef_year, pinned_ef_source, pinned_ef_geography, pinned_ef_dataset_version,
       co2e_kg, created_at)
     VALUES
     ('act-1', 'src-1', 'per-2025', 1000, 'kg',  'diesel_kg', 2025, 'IPCC', 'CN', '2025.1', 3160, '2025-03-01'),
     ('act-2', 'src-2', 'per-2025', 50000, 'kWh', 'grid_kwh', 2025, 'MEE', 'CN', '2025.1', 28515, '2025-03-01'),
     ('act-3', 'src-2', 'per-2025', 10000, 'kWh', 'grid_kwh', 2025, 'MEE', 'CN', '2025.1', 5703, '2025-03-01'),
     ('act-4', 'src-3', 'per-2025', 200,   't*km', 'truck_tkm', 2025, 'IPCC', 'CN', '2025.1', 22, '2025-03-01')`,
  ).run();
}

describe('ReportDataService.assembleReportData', () => {
  it('assembles full InventoryReportData with scope totals', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    seedInventory(db);
    const svc = new ReportDataService({ db });
    const data = svc.assembleReportData({
      reporting_period_id: 'per-2025',
      language: 'zh-CN',
    });

    expect(data.org.name_zh).toBe('测试公司');
    expect(data.org.boundary_kind).toBe('operational_control');
    expect(data.org.responsible.name).toBe('张三');
    expect(data.period.year).toBe(2025);
    expect(data.period.granularity).toBe('annual');
    expect(data.sites).toHaveLength(1);
    expect(data.sites[0].name_zh).toBe('北京工厂');
    expect(data.scope_totals.scope1_kg).toBe(3160);
    expect(data.scope_totals.scope2_kg).toBe(34218); // 28515 + 5703
    expect(data.scope_totals.scope3_kg).toBe(22);
    expect(data.scope_totals.total_kg).toBe(37400);
    expect(data.scope_totals.biogenic_kg).toBe(0);
    expect(data.all_sources).toHaveLength(3);
    expect(data.activities).toHaveLength(4);
    expect(data.activities[0].source_name).toBeTruthy();
    expect(data.activities[0].unit).toBeTruthy();
    db.close();
  });

  it('computes share_pct per source against total emissions', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    seedInventory(db);
    const svc = new ReportDataService({ db });
    const data = svc.assembleReportData({
      reporting_period_id: 'per-2025',
      language: 'zh-CN',
    });
    const grid = data.all_sources.find((s) => s.name === '电网电力')!;
    expect(grid.co2e_kg).toBe(34218);
    // 34218 / 37400 ≈ 91.49%
    expect(grid.share_pct).toBeCloseTo(91.49, 1);
  });

  it('returns null prior_period_summary when no prior period exists', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    seedInventory(db);
    const svc = new ReportDataService({ db });
    const data = svc.assembleReportData({
      reporting_period_id: 'per-2025',
      language: 'zh-CN',
    });
    expect(data.prior_period_summary).toBeNull();
    expect(data.base_year_summary).toBeNull();
  });

  it('throws when reporting_period_id is unknown', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const svc = new ReportDataService({ db });
    expect(() =>
      svc.assembleReportData({ reporting_period_id: 'ghost', language: 'zh-CN' }),
    ).toThrow(/not found/i);
  });
});
```

- [ ] **Step 2: Run, confirm fail**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/main/services/report-data-service.test.ts --pool=threads 2>&1 | tail -15
```

Expected: FAIL — `Cannot find module '@main/services/report-data-service'`.

- [ ] **Step 3: Implement the service**

Create `src/main/services/report-data-service.ts`:

```ts
import type Database from 'better-sqlite3';

export interface ReportDataDeps {
  db: Database.Database;
}

export interface InventoryReportData {
  org: {
    id: string;
    name_zh: string | null;
    name_en: string | null;
    industry: string | null;
    country_code: string;
    boundary_kind: 'equity_share' | 'financial_control' | 'operational_control';
    responsible: { name: string | null; role: string | null };
  };
  period: {
    id: string;
    year: number;
    granularity: 'annual' | 'quarterly' | 'monthly';
    start: string;
    end: string;
    is_base_year: boolean;
    significant_changes_text: string | null;
  };
  sites: Array<{
    id: string;
    name_zh: string | null;
    name_en: string | null;
    address: string | null;
  }>;
  scope_totals: {
    scope1_kg: number;
    scope2_kg: number;
    scope3_kg: number;
    total_kg: number;
    /** Biogenic CO2 reported separately per 14064-1 §6.4.7. */
    biogenic_kg: number;
  };
  all_sources: Array<{
    id: string;
    name: string;
    scope: 1 | 2 | 3;
    co2e_kg: number;
    share_pct: number;
  }>;
  /** Every activity row — used by the Excel appendix's "Activities" sheet
   *  and shown to the LLM (which is instructed to use aggregates only). */
  activities: Array<{
    id: string;
    site_name: string | null;
    source_name: string;
    scope: 1 | 2 | 3;
    amount: number;
    unit: string;
    pinned_ef_source: string;
    co2e_kg: number;
  }>;
  ef_sources_used: Array<{ source: string; count: number; gwp_basis: 'AR5' | 'AR6' }>;
  language: 'zh-CN' | 'en';
  prior_period_summary: { year: number; total_kg: number } | null;
  base_year_summary: { year: number; total_kg: number } | null;
}

export class ReportDataService {
  constructor(private deps: ReportDataDeps) {}

  assembleReportData(input: {
    reporting_period_id: string;
    language: 'zh-CN' | 'en';
  }): InventoryReportData {
    const period = this.deps.db
      .prepare(
        `SELECT id, organization_id, year, granularity, starts_at, ends_at,
                significant_changes_text
           FROM reporting_period WHERE id = ?`,
      )
      .get(input.reporting_period_id) as
      | undefined
      | {
          id: string;
          organization_id: string;
          year: number;
          granularity: 'annual' | 'quarterly' | 'monthly';
          starts_at: string;
          ends_at: string;
          significant_changes_text: string | null;
        };
    if (!period) {
      throw new Error(`reporting_period not found: ${input.reporting_period_id}`);
    }

    const org = this.deps.db
      .prepare(
        `SELECT id, name_zh, name_en, industry, country_code, boundary_kind,
                responsible_person_name, responsible_person_role, base_year_period_id
           FROM organization WHERE id = ?`,
      )
      .get(period.organization_id) as {
      id: string;
      name_zh: string | null;
      name_en: string | null;
      industry: string | null;
      country_code: string;
      boundary_kind: 'equity_share' | 'financial_control' | 'operational_control';
      responsible_person_name: string | null;
      responsible_person_role: string | null;
      base_year_period_id: string | null;
    };

    const sites = this.deps.db
      .prepare(
        `SELECT id, name_zh, name_en, address FROM site WHERE organization_id = ? AND is_active = 1`,
      )
      .all(period.organization_id) as Array<{
      id: string;
      name_zh: string | null;
      name_en: string | null;
      address: string | null;
    }>;

    const rawActivities = this.deps.db
      .prepare(
        `SELECT a.id AS activity_id, a.co2e_kg, a.amount, a.unit,
                es.id AS source_id, es.name AS source_name, es.scope,
                s.name_zh AS site_name_zh, s.name_en AS site_name_en,
                a.pinned_ef_source, ef.gwp_basis
           FROM activity_data a
           JOIN emission_source es ON es.id = a.emission_source_id
           LEFT JOIN site s ON s.id = es.site_id
           LEFT JOIN pinned_emission_factor ef
             ON ef.factor_code = a.pinned_ef_factor_code
            AND ef.year = a.pinned_ef_year
            AND ef.source = a.pinned_ef_source
            AND ef.geography = a.pinned_ef_geography
            AND ef.dataset_version = a.pinned_ef_dataset_version
          WHERE a.reporting_period_id = ?`,
      )
      .all(input.reporting_period_id) as Array<{
      activity_id: string;
      co2e_kg: number;
      amount: number;
      unit: string;
      source_id: string;
      source_name: string;
      scope: 1 | 2 | 3;
      site_name_zh: string | null;
      site_name_en: string | null;
      pinned_ef_source: string;
      gwp_basis: 'AR5' | 'AR6' | null;
    }>;

    // Roll up by source.
    const sourceMap = new Map<
      string,
      { id: string; name: string; scope: 1 | 2 | 3; co2e_kg: number }
    >();
    for (const row of rawActivities) {
      const existing = sourceMap.get(row.source_id);
      if (existing) {
        existing.co2e_kg += row.co2e_kg;
      } else {
        sourceMap.set(row.source_id, {
          id: row.source_id,
          name: row.source_name,
          scope: row.scope,
          co2e_kg: row.co2e_kg,
        });
      }
    }
    const sourcesArr = [...sourceMap.values()].sort((a, b) => b.co2e_kg - a.co2e_kg);

    const scope1_kg = sourcesArr.filter((s) => s.scope === 1).reduce((acc, s) => acc + s.co2e_kg, 0);
    const scope2_kg = sourcesArr.filter((s) => s.scope === 2).reduce((acc, s) => acc + s.co2e_kg, 0);
    const scope3_kg = sourcesArr.filter((s) => s.scope === 3).reduce((acc, s) => acc + s.co2e_kg, 0);
    const total_kg = scope1_kg + scope2_kg + scope3_kg;

    const all_sources = sourcesArr.map((s) => ({
      ...s,
      share_pct: total_kg > 0 ? (s.co2e_kg / total_kg) * 100 : 0,
    }));

    // Group EF source provenance.
    const efSourceMap = new Map<string, { source: string; count: number; gwp_basis: 'AR5' | 'AR6' }>();
    for (const row of rawActivities) {
      const k = row.pinned_ef_source;
      const ex = efSourceMap.get(k);
      if (ex) {
        ex.count++;
      } else {
        efSourceMap.set(k, {
          source: k,
          count: 1,
          gwp_basis: row.gwp_basis ?? 'AR5',
        });
      }
    }

    // Biogenic separated total.
    const biogenicRow = this.deps.db
      .prepare(
        `SELECT COALESCE(SUM(a.amount * pef.biogenic_co2_factor), 0) AS biogenic_kg
           FROM activity_data a
           JOIN pinned_emission_factor pef
             ON pef.factor_code = a.pinned_ef_factor_code
            AND pef.year = a.pinned_ef_year
            AND pef.source = a.pinned_ef_source
            AND pef.geography = a.pinned_ef_geography
            AND pef.dataset_version = a.pinned_ef_dataset_version
          WHERE a.reporting_period_id = ?`,
      )
      .get(input.reporting_period_id) as { biogenic_kg: number };

    // Prior period (immediately previous year).
    const priorRow = this.deps.db
      .prepare(
        `SELECT id, year FROM reporting_period
          WHERE organization_id = ? AND year < ?
          ORDER BY year DESC LIMIT 1`,
      )
      .get(period.organization_id, period.year) as { id: string; year: number } | undefined;
    let prior_period_summary: { year: number; total_kg: number } | null = null;
    if (priorRow) {
      const sum = this.deps.db
        .prepare(`SELECT COALESCE(SUM(co2e_kg), 0) AS total_kg FROM activity_data WHERE reporting_period_id = ?`)
        .get(priorRow.id) as { total_kg: number };
      prior_period_summary = { year: priorRow.year, total_kg: sum.total_kg };
    }

    // Base year summary.
    let base_year_summary: { year: number; total_kg: number } | null = null;
    if (org.base_year_period_id && org.base_year_period_id !== period.id) {
      const baseRow = this.deps.db
        .prepare(`SELECT id, year FROM reporting_period WHERE id = ?`)
        .get(org.base_year_period_id) as { id: string; year: number } | undefined;
      if (baseRow) {
        const sum = this.deps.db
          .prepare(`SELECT COALESCE(SUM(co2e_kg), 0) AS total_kg FROM activity_data WHERE reporting_period_id = ?`)
          .get(baseRow.id) as { total_kg: number };
        base_year_summary = { year: baseRow.year, total_kg: sum.total_kg };
      }
    }

    return {
      org: {
        id: org.id,
        name_zh: org.name_zh,
        name_en: org.name_en,
        industry: org.industry,
        country_code: org.country_code,
        boundary_kind: org.boundary_kind,
        responsible: {
          name: org.responsible_person_name,
          role: org.responsible_person_role,
        },
      },
      period: {
        id: period.id,
        year: period.year,
        granularity: period.granularity,
        start: period.starts_at,
        end: period.ends_at,
        is_base_year: org.base_year_period_id === period.id,
        significant_changes_text: period.significant_changes_text,
      },
      sites,
      scope_totals: {
        scope1_kg,
        scope2_kg,
        scope3_kg,
        total_kg,
        biogenic_kg: biogenicRow.biogenic_kg,
      },
      all_sources,
      activities: rawActivities.map((r) => ({
        id: r.activity_id,
        site_name: input.language === 'zh-CN' ? r.site_name_zh : r.site_name_en,
        source_name: r.source_name,
        scope: r.scope,
        amount: r.amount,
        unit: r.unit,
        pinned_ef_source: r.pinned_ef_source,
        co2e_kg: r.co2e_kg,
      })),
      ef_sources_used: [...efSourceMap.values()],
      language: input.language,
      prior_period_summary,
      base_year_summary,
    };
  }
}
```

- [ ] **Step 4: Verify**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck 2>&1 | tail -10
pnpm vitest run tests/main/services/report-data-service.test.ts --pool=threads 2>&1 | tail -10
pnpm vitest run --pool=threads 2>&1 | tail -8
```

Expected: typecheck clean; 4/4 new tests pass; ~561 tests total.

- [ ] **Step 5: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add src/main/services/report-data-service.ts tests/main/services/report-data-service.test.ts
git commit -m "feat(report): ReportDataService — assembles InventoryReportData from sqlite"
git branch --show-current
```

---

## Task 4: LLM Report Narrative — streamObject + progress events

**Files:**
- Create: `src/main/llm/report-narrative.ts`
- Create: `tests/main/llm/report-narrative.test.ts`

Single LLM call returning a 6-section narrative via AI SDK `streamObject`. Uses `abortSignal` for cancellation. Emits progress events as partial deltas arrive.

- [ ] **Step 1: Write the failing test**

Create `tests/main/llm/report-narrative.test.ts`:

```ts
import { generateReportNarrative, ReportNarrativeSchema } from '@main/llm/report-narrative';
import type { InventoryReportData } from '@main/services/report-data-service';
import { describe, expect, it, vi } from 'vitest';

function fakeData(): InventoryReportData {
  return {
    org: {
      id: 'org-1',
      name_zh: '测试公司',
      name_en: 'Test Co',
      industry: '制造业',
      country_code: 'CN',
      boundary_kind: 'operational_control',
      responsible: { name: '张三', role: '可持续发展负责人' },
    },
    period: {
      id: 'per-2025',
      year: 2025,
      granularity: 'annual',
      start: '2025-01-01',
      end: '2025-12-31',
      is_base_year: false,
      significant_changes_text: null,
    },
    sites: [{ id: 'site-1', name_zh: '北京工厂', name_en: 'Beijing Plant', address: '北京市' }],
    scope_totals: { scope1_kg: 3160, scope2_kg: 34218, scope3_kg: 22, total_kg: 37400, biogenic_kg: 0 },
    all_sources: [],
    ef_sources_used: [{ source: 'MEE', count: 2, gwp_basis: 'AR5' }],
    language: 'zh-CN',
    prior_period_summary: null,
    base_year_summary: null,
  };
}

const FAKE_NARRATIVE = {
  boundary_description: '本盘查采用运营控制法定义组织边界，覆盖测试公司的北京工厂。该方法符合 ISO 14064-1:2018 §5.1 要求。',
  reporting_boundary_description: '报告范围涵盖范围一直接排放、范围二外购电力的间接排放，以及范围三外购运输服务。本期未涉及生物质排放，单独披露为零。',
  methodology_description: '排放量按 IPCC 与生态环境部公布的排放因子计算，所有因子均采用 AR5 GWP 基准。所有活动数据均通过单据来源识别并人工复核。',
  emissions_summary: '本期总排放量约 37.4 吨 CO2e，其中范围二占比最高，主要来自外购电力 50000 + 10000 kWh。范围一柴油使用与范围三外购运输各占小份额。',
  significant_changes: '本盘查为首次进行的 2025 年度盘查，无历史可比期，亦未设定基准年。',
  notable_observations: '电网电力为最大排放源，年度排放量约 34.2 吨 CO2e，占总量 91% 以上。',
};

describe('generateReportNarrative', () => {
  it('validates a well-shaped LLM response against the schema', () => {
    const result = ReportNarrativeSchema.safeParse(FAKE_NARRATIVE);
    expect(result.success).toBe(true);
  });

  it('returns the narrative + emits progress events for each section', async () => {
    const progressCalls: Array<{ sub_phase: string | null }> = [];
    // Stub the streamObject call by intercepting the provider hook.
    const provider = {
      streamObjectMock: vi.fn().mockResolvedValue({
        object: Promise.resolve(FAKE_NARRATIVE),
        partialObjectStream: (async function* () {
          yield { boundary_description: '...' };
          yield { boundary_description: '...full...', reporting_boundary_description: '...' };
          yield { reporting_boundary_description: '...full...', methodology_description: '...' };
          yield { methodology_description: '...full...', emissions_summary: '...' };
          yield { emissions_summary: '...full...', significant_changes: '...' };
          yield { significant_changes: '...full...', notable_observations: '...' };
          yield FAKE_NARRATIVE;
        })(),
      }),
    };
    const narrative = await generateReportNarrative({
      data: fakeData(),
      provider: {
        kind: 'mock',
        streamObject: provider.streamObjectMock,
      } as never,
      onProgress: (ev) => progressCalls.push({ sub_phase: ev.sub_phase }),
      abortSignal: new AbortController().signal,
    });
    expect(narrative).toEqual(FAKE_NARRATIVE);
    // At least 5 sub-phase transitions seen.
    const phases = progressCalls.map((c) => c.sub_phase);
    expect(phases).toContain('boundary');
    expect(phases).toContain('methodology');
    expect(phases).toContain('emissions');
    expect(phases).toContain('changes');
  });

  it('throws LlmNarrativeCanceled when AbortSignal fires before completion', async () => {
    const controller = new AbortController();
    controller.abort();
    const provider = {
      streamObject: vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError')),
    };
    await expect(
      generateReportNarrative({
        data: fakeData(),
        provider: provider as never,
        onProgress: () => {},
        abortSignal: controller.signal,
      }),
    ).rejects.toThrow(/canceled/i);
  });
});
```

- [ ] **Step 2: Run, confirm fail**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/main/llm/report-narrative.test.ts --pool=threads 2>&1 | tail -15
```

Expected: FAIL — `Cannot find module '@main/llm/report-narrative'`.

- [ ] **Step 3: Implement**

Create `src/main/llm/report-narrative.ts`:

```ts
import type { InventoryReportData } from '@main/services/report-data-service';
import { z } from 'zod';

export const ReportNarrativeSchema = z.object({
  boundary_description: z.string().min(50).max(800),
  reporting_boundary_description: z.string().min(50).max(800),
  methodology_description: z.string().min(100).max(1200),
  emissions_summary: z.string().min(100).max(1500),
  significant_changes: z.string().min(20).max(800),
  notable_observations: z.string().min(50).max(800),
});

export type ReportNarrative = z.infer<typeof ReportNarrativeSchema>;

export type ReportNarrativeSubPhase =
  | 'boundary'
  | 'reporting-boundary'
  | 'methodology'
  | 'emissions'
  | 'changes'
  | 'observations';

export interface ReportNarrativeProgressEvent {
  sub_phase: ReportNarrativeSubPhase | null;
}

/**
 * The "provider" abstraction is intentionally narrow — it is whatever wraps
 * `streamObject` from AI SDK 6. In production it's bound by
 * `LlmClient.streamObjectFor('report-narrative')`; in tests we hand-roll a
 * shim that yields partial deltas.
 */
export interface ReportNarrativeProvider {
  streamObject: (args: {
    schema: typeof ReportNarrativeSchema;
    system: string;
    user: string;
    abortSignal: AbortSignal;
  }) => Promise<{
    object: Promise<ReportNarrative>;
    partialObjectStream: AsyncIterable<Partial<ReportNarrative>>;
  }>;
}

export class LlmNarrativeCanceled extends Error {
  readonly _tag = 'LlmNarrativeCanceled' as const;
  constructor() {
    super('Report narrative generation canceled');
  }
}

export class LlmNarrativeRefused extends Error {
  readonly _tag = 'LlmNarrativeRefused' as const;
}

const FIELD_TO_SUBPHASE: Record<keyof ReportNarrative, ReportNarrativeSubPhase> = {
  boundary_description: 'boundary',
  reporting_boundary_description: 'reporting-boundary',
  methodology_description: 'methodology',
  emissions_summary: 'emissions',
  significant_changes: 'changes',
  notable_observations: 'observations',
};

function buildSystemPrompt(lang: 'zh-CN' | 'en'): string {
  if (lang === 'zh-CN') {
    return `你是 ISO 14064-1:2018 GHG 盘查报告撰稿人。严格遵循以下规则:

1. 你只能使用 <inventory> 块中提供的数字与名称。任何 <inventory> 中不存在的事实, 一律写 "本期未评估"。严禁推测、补充或虚构。
2. 不要在文本中改动 <inventory> 给出的数字 (允许换算单位时另当别论)。
3. 语气专业、克制、不夸张。每个 section 250-450 字之间。
4. 边界方法措辞: equity_share → "股权法"; financial_control → "财务控制法"; operational_control → "运营控制法"。
5. 排放因子来源信息若 <inventory> 提供, 在 methodology_description 中必须披露 GWP 基准 (AR5 / AR6)。
6. 输出必须是 JSON, 完全符合给定 schema, 不要添加 schema 外的字段。`;
  }
  return `You are an ISO 14064-1:2018 GHG inventory report writer. Strict rules:

1. You may only use numbers and names from the <inventory> block. For any fact not present in <inventory>, write "Not assessed in this inventory". No speculation, no extrapolation, no fabrication.
2. Do not alter numbers from <inventory> (unit conversion is allowed when explicit).
3. Tone: professional, restrained, never promotional. Each section 250-450 words.
4. Boundary phrasing: equity_share → "equity share"; financial_control → "financial control"; operational_control → "operational control".
5. If <inventory> includes EF source provenance, the methodology_description must disclose the GWP basis (AR5 / AR6).
6. Output must be JSON matching the schema exactly, no extra fields.`;
}

function buildUserMessage(data: InventoryReportData): string {
  return `<inventory>\n${JSON.stringify(data, null, 2)}\n</inventory>`;
}

export async function generateReportNarrative(args: {
  data: InventoryReportData;
  provider: ReportNarrativeProvider;
  onProgress: (ev: ReportNarrativeProgressEvent) => void;
  abortSignal: AbortSignal;
}): Promise<ReportNarrative> {
  const { data, provider, onProgress, abortSignal } = args;
  try {
    const { object, partialObjectStream } = await provider.streamObject({
      schema: ReportNarrativeSchema,
      system: buildSystemPrompt(data.language),
      user: buildUserMessage(data),
      abortSignal,
    });

    // Watch which key is currently filling.
    const seen = new Set<keyof ReportNarrative>();
    let lastEmitted: ReportNarrativeSubPhase | null = null;
    for await (const partial of partialObjectStream) {
      for (const k of Object.keys(partial) as Array<keyof ReportNarrative>) {
        if (!seen.has(k)) {
          seen.add(k);
          const phase = FIELD_TO_SUBPHASE[k];
          if (phase && phase !== lastEmitted) {
            lastEmitted = phase;
            onProgress({ sub_phase: phase });
          }
        }
      }
    }
    const final = await object;
    const parsed = ReportNarrativeSchema.safeParse(final);
    if (!parsed.success) {
      throw new LlmNarrativeRefused(`LLM returned schema-invalid narrative: ${parsed.error.message}`);
    }
    return parsed.data;
  } catch (err) {
    if (abortSignal.aborted) throw new LlmNarrativeCanceled();
    if ((err as Error)?.name === 'AbortError') throw new LlmNarrativeCanceled();
    throw err;
  }
}
```

- [ ] **Step 4: Verify**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck 2>&1 | tail -10
pnpm vitest run tests/main/llm/report-narrative.test.ts --pool=threads 2>&1 | tail -10
```

Expected: 3/3 new tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add src/main/llm/report-narrative.ts tests/main/llm/report-narrative.test.ts
git commit -m "feat(llm): report narrative generator — streamObject + progress + abort"
git branch --show-current
```

Expected: ~564 tests.

---

## Task 5: IPC channels — report:generate / report:cancel / report:progress

**Files:**
- Create: `src/main/ipc/handlers/report.ts`
- Modify: `src/main/ipc/types.ts` — add 4 invoke channels + 1 push channel
- Modify: `src/main/ipc/context.ts` — add `reportDataService`
- Modify: `src/main/ipc/setup.ts` (or wherever handlers are wired) — wire `reportHandlers(ctx)`
- Modify: `src/preload/bridge.ts` — invoke + push allowlists
- Modify: `tests/preload/bridge.test.ts` — extend allowlist assertions
- Create: `tests/main/ipc/report-handlers.test.ts`

Holds the AbortController map for in-flight generation requests. `report:export-pdf` and `report:export-xlsx` are stubbed in this task — full implementation lands in Task 6.

- [ ] **Step 0: Reconnaissance**

Read these to understand existing handler shape:

```
src/main/ipc/handlers/extraction.ts   (the extraction:progress push pattern)
src/main/ipc/context.ts                (where services are wired)
src/main/ipc/setup.ts                  (or whatever bootstraps handlers)
tests/main/ipc/extraction-handlers.test.ts  (push-channel mocking; if missing, use the bridge test patterns)
```

Find how main pushes events to renderer (`webContents.send`) and which BrowserWindow reference is used. Find the existing `extraction:progress` emitter for reference.

- [ ] **Step 1: Write the failing handler test**

Create `tests/main/ipc/report-handlers.test.ts`:

```ts
import { reportHandlers } from '@main/ipc/handlers/report';
import { describe, expect, it, vi } from 'vitest';

function makeCtx() {
  const reportDataService = {
    assembleReportData: vi.fn().mockReturnValue({
      org: { id: 'org-1' },
      period: { id: 'per-1', year: 2025, granularity: 'annual' },
    }),
  };
  const llmNarrativeProvider = {
    streamObject: vi.fn().mockResolvedValue({
      object: Promise.resolve({
        boundary_description: 'a'.repeat(60),
        reporting_boundary_description: 'b'.repeat(60),
        methodology_description: 'c'.repeat(120),
        emissions_summary: 'd'.repeat(120),
        significant_changes: 'e'.repeat(30),
        notable_observations: 'f'.repeat(60),
      }),
      partialObjectStream: (async function* () {
        yield { boundary_description: 'a' };
      })(),
    }),
  };
  const pushEvent = vi.fn();
  return {
    reportDataService,
    llmNarrativeProvider,
    pushEvent,
    settingsService: { getProvider: vi.fn().mockReturnValue({}) },
  };
}

describe('reportHandlers', () => {
  it('report:generate returns assembled data + narrative', async () => {
    const ctx = makeCtx();
    const handlers = reportHandlers(ctx as never);
    const result = await handlers['report:generate']!({
      report_id: 'rep-1',
      reporting_period_id: 'per-1',
      language: 'zh-CN',
    });
    expect('canceled' in result).toBe(false);
    if (!('canceled' in result)) {
      expect(result.data.org.id).toBe('org-1');
      expect(result.narrative.boundary_description.length).toBeGreaterThan(50);
    }
  });

  it('report:generate emits progress events with sub_phase mapping', async () => {
    const ctx = makeCtx();
    const handlers = reportHandlers(ctx as never);
    await handlers['report:generate']!({
      report_id: 'rep-2',
      reporting_period_id: 'per-1',
      language: 'zh-CN',
    });
    // At least one progress event with sub_phase === 'boundary'
    expect(ctx.pushEvent).toHaveBeenCalledWith(
      'report:progress',
      expect.objectContaining({ report_id: 'rep-2', sub_phase: 'boundary' }),
    );
  });

  it('report:cancel aborts an inflight generation and returns canceled marker', async () => {
    const ctx = makeCtx();
    // Make the streamObject hang until aborted.
    ctx.llmNarrativeProvider.streamObject = vi.fn().mockImplementation(({ abortSignal }) => {
      return new Promise((_resolve, reject) => {
        abortSignal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    });
    const handlers = reportHandlers(ctx as never);
    const inflight = handlers['report:generate']!({
      report_id: 'rep-3',
      reporting_period_id: 'per-1',
      language: 'zh-CN',
    });
    // Cancel after a tick.
    setTimeout(() => {
      handlers['report:cancel']!({ report_id: 'rep-3' });
    }, 10);
    const result = await inflight;
    expect(result).toEqual({ canceled: true });
  });

  it('report:generate returns LlmNarrativeNoProvider when settings missing', async () => {
    const ctx = makeCtx();
    ctx.settingsService.getProvider = vi.fn().mockReturnValue(null);
    const handlers = reportHandlers(ctx as never);
    const result = await handlers['report:generate']!({
      report_id: 'rep-4',
      reporting_period_id: 'per-1',
      language: 'zh-CN',
    });
    expect(result).toEqual({ canceled: false, error: { _tag: 'NoProvider' } });
  });
});
```

- [ ] **Step 2: Run, confirm fail**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/main/ipc/report-handlers.test.ts --pool=threads 2>&1 | tail -15
```

Expected: FAIL — `Cannot find module '@main/ipc/handlers/report'`.

- [ ] **Step 3: Extend IpcTypeMap + IpcPushTypeMap**

Edit `src/main/ipc/types.ts`. Add to `IpcTypeMap`:

```ts
  // report domain (Phase 3 — ISO 14064-1 inventory report)
  'report:generate': (input: {
    report_id: string;
    reporting_period_id: string;
    language: 'zh-CN' | 'en';
  }) => Promise<
    | { canceled: true }
    | { canceled: false; data: import('@main/services/report-data-service').InventoryReportData;
        narrative: import('@main/llm/report-narrative').ReportNarrative }
    | { canceled: false; error: { _tag: 'NoProvider' | 'Refused' | 'RateLimit' | 'Timeout'; message?: string } }
  >;
  'report:cancel': (input: { report_id: string }) => void;
  'report:export-pdf': (input: {
    data: import('@main/services/report-data-service').InventoryReportData;
    narrative: import('@main/llm/report-narrative').ReportNarrative;
    language: 'zh-CN' | 'en';
  }) => Promise<{ canceled: true } | { ok: true; path: string } | { ok: false; error: string }>;
  'report:export-xlsx': (input: {
    data: import('@main/services/report-data-service').InventoryReportData;
    narrative: import('@main/llm/report-narrative').ReportNarrative;
    language: 'zh-CN' | 'en';
  }) => Promise<{ canceled: true } | { ok: true; path: string } | { ok: false; error: string }>;
```

Add to `IpcPushTypeMap`:

```ts
  'report:progress': {
    report_id: string;
    phase: 'assembling' | 'narrative' | 'finalizing';
    sub_phase:
      | 'boundary'
      | 'reporting-boundary'
      | 'methodology'
      | 'emissions'
      | 'changes'
      | 'observations'
      | null;
  };
```

- [ ] **Step 4: Implement the handler**

Create `src/main/ipc/handlers/report.ts`:

```ts
import { generateReportNarrative } from '@main/llm/report-narrative';
import type { IpcContext } from '../context.js';
import type { IpcTypeMap } from '../types.js';
import { z } from 'zod';

const generateInput = z.object({
  report_id: z.string().min(1),
  reporting_period_id: z.string().min(1),
  language: z.enum(['zh-CN', 'en']),
});
const cancelInput = z.object({ report_id: z.string().min(1) });

interface ReportHandlerCtx extends IpcContext {
  pushEvent: (
    channel: 'report:progress',
    payload: {
      report_id: string;
      phase: 'assembling' | 'narrative' | 'finalizing';
      sub_phase:
        | 'boundary'
        | 'reporting-boundary'
        | 'methodology'
        | 'emissions'
        | 'changes'
        | 'observations'
        | null;
    },
  ) => void;
  llmNarrativeProvider: import('@main/llm/report-narrative').ReportNarrativeProvider;
}

export function reportHandlers(ctx: ReportHandlerCtx): {
  [K in keyof IpcTypeMap]?: IpcTypeMap[K];
} {
  const inflight = new Map<string, AbortController>();

  return {
    'report:generate': async (raw) => {
      const input = generateInput.parse(raw);
      const provider = ctx.settingsService.getProvider();
      if (!provider) {
        return { canceled: false as const, error: { _tag: 'NoProvider' as const } };
      }

      const controller = new AbortController();
      inflight.set(input.report_id, controller);
      try {
        ctx.pushEvent('report:progress', {
          report_id: input.report_id,
          phase: 'assembling',
          sub_phase: null,
        });
        const data = ctx.reportDataService.assembleReportData({
          reporting_period_id: input.reporting_period_id,
          language: input.language,
        });

        ctx.pushEvent('report:progress', {
          report_id: input.report_id,
          phase: 'narrative',
          sub_phase: null,
        });
        const narrative = await generateReportNarrative({
          data,
          provider: ctx.llmNarrativeProvider,
          onProgress: (ev) => {
            ctx.pushEvent('report:progress', {
              report_id: input.report_id,
              phase: 'narrative',
              sub_phase: ev.sub_phase,
            });
          },
          abortSignal: controller.signal,
        });

        ctx.pushEvent('report:progress', {
          report_id: input.report_id,
          phase: 'finalizing',
          sub_phase: null,
        });
        return { canceled: false as const, data, narrative };
      } catch (err) {
        const e = err as { _tag?: string; message?: string; name?: string };
        if (controller.signal.aborted || e.name === 'AbortError' || e._tag === 'LlmNarrativeCanceled') {
          return { canceled: true as const };
        }
        if (e._tag === 'LlmNarrativeRefused') {
          return { canceled: false as const, error: { _tag: 'Refused' as const, message: e.message } };
        }
        return {
          canceled: false as const,
          error: { _tag: 'Refused' as const, message: e.message ?? String(err) },
        };
      } finally {
        inflight.delete(input.report_id);
      }
    },

    'report:cancel': (raw) => {
      const input = cancelInput.parse(raw);
      const controller = inflight.get(input.report_id);
      if (controller) {
        controller.abort();
      }
    },

    // Stubs — Task 6 implements these properly.
    'report:export-pdf': async () => ({ ok: false as const, error: 'not_implemented' }),
    'report:export-xlsx': async () => ({ ok: false as const, error: 'not_implemented' }),
  };
}
```

- [ ] **Step 5: Wire it into context + setup**

Edit `src/main/ipc/context.ts`. Add `reportDataService: ReportDataService` and `llmNarrativeProvider: ReportNarrativeProvider` to the `IpcContext` type and the construction site. The `llmNarrativeProvider` should be built by wrapping the existing `LlmClient` — add a helper inside `src/main/llm/llm-client.ts` if needed:

```ts
// In LlmClient (or a small adapter):
buildReportNarrativeProvider(): ReportNarrativeProvider {
  return {
    streamObject: ({ schema, system, user, abortSignal }) =>
      streamObject({
        model: this.model,
        schema,
        system,
        prompt: user,
        abortSignal,
      }),
  };
}
```

(Adapt the call to whatever the existing LlmClient exposes — likely `this.aiSdkModel()` or similar.)

Edit `src/main/ipc/setup.ts` to register `reportHandlers(ctx)` in the handlers loop.

- [ ] **Step 6: Allowlist updates**

Edit `src/preload/bridge.ts`. Add to `allowedChannels` (in a new section):

```ts
  // report domain (Phase 3 — ISO 14064-1 inventory report)
  'report:generate',
  'report:cancel',
  'report:export-pdf',
  'report:export-xlsx',
```

Add to `allowedPushChannels`:

```ts
export const allowedPushChannels: ReadonlyArray<keyof IpcPushTypeMap> = [
  'extraction:progress',
  'report:progress',
];
```

Edit `tests/preload/bridge.test.ts` — extend the `allowedChannels` assertion and add a similar block for push channels if there isn't one yet:

```ts
expect(allowedChannels).toEqual([
  // ... existing entries ...
  'mcp:get-status',
  'mcp:write-claude-config',
  'report:generate',
  'report:cancel',
  'report:export-pdf',
  'report:export-xlsx',
]);
```

And if there's a push allowlist test, extend it. If not, add one alongside:

```ts
it('push allowlist covers exactly the registered push channels', () => {
  expect(allowedPushChannels).toEqual(['extraction:progress', 'report:progress']);
});
```

- [ ] **Step 7: Verify**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck 2>&1 | tail -10
pnpm vitest run tests/main/ipc/report-handlers.test.ts --pool=threads 2>&1 | tail -15
pnpm vitest run tests/preload/bridge.test.ts --pool=threads 2>&1 | tail -10
pnpm vitest run --pool=threads 2>&1 | tail -8
```

Expected: typecheck clean; 4/4 report handler tests pass; bridge test passes; ~568 tests.

- [ ] **Step 8: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add -A
git commit -m "feat(ipc): report:generate + report:cancel + report:progress channels"
git branch --show-current
```

---

## Task 6: ReportExportService — PDF (printToPDF) + Excel (exceljs)

**Files:**
- Create: `src/main/services/report-export-service.ts`
- Create: `tests/main/services/report-export-service.test.ts`
- Modify: `src/main/ipc/handlers/report.ts` — replace stubs with real export calls
- Modify: `src/main/ipc/context.ts` — add `reportExportService`

The PDF path uses a hidden Electron `BrowserWindow` + `webContents.printToPDF()`. Tests focus on the Excel path (PDF is an Electron API; we test orchestration via mocks).

- [ ] **Step 1: Write the failing Excel test**

Create `tests/main/services/report-export-service.test.ts`:

```ts
import { writeAppendixXlsx } from '@main/services/report-export-service';
import type { InventoryReportData } from '@main/services/report-data-service';
import type { ReportNarrative } from '@main/llm/report-narrative';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

function fakeData(): InventoryReportData {
  return {
    org: {
      id: 'org-1',
      name_zh: '测试',
      name_en: 'Test',
      industry: null,
      country_code: 'CN',
      boundary_kind: 'operational_control',
      responsible: { name: '张三', role: null },
    },
    period: {
      id: 'per-2025',
      year: 2025,
      granularity: 'annual',
      start: '2025-01-01',
      end: '2025-12-31',
      is_base_year: false,
      significant_changes_text: null,
    },
    sites: [{ id: 'site-1', name_zh: '北京', name_en: 'Beijing', address: null }],
    scope_totals: { scope1_kg: 100, scope2_kg: 200, scope3_kg: 50, total_kg: 350, biogenic_kg: 0 },
    all_sources: [
      { id: 's1', name: 'A', scope: 1, co2e_kg: 100, share_pct: 28.6 },
      { id: 's2', name: 'B', scope: 2, co2e_kg: 200, share_pct: 57.1 },
    ],
    activities: [
      { id: 'a1', site_name: '北京', source_name: 'A', scope: 1, amount: 32, unit: 'kg', pinned_ef_source: 'IPCC', co2e_kg: 100 },
      { id: 'a2', site_name: '北京', source_name: 'B', scope: 2, amount: 1000, unit: 'kWh', pinned_ef_source: 'IPCC', co2e_kg: 200 },
    ],
    ef_sources_used: [{ source: 'IPCC', count: 2, gwp_basis: 'AR5' }],
    language: 'zh-CN',
    prior_period_summary: null,
    base_year_summary: null,
  };
}
const fakeNarrative: ReportNarrative = {
  boundary_description: 'a'.repeat(60),
  reporting_boundary_description: 'b'.repeat(60),
  methodology_description: 'c'.repeat(120),
  emissions_summary: 'd'.repeat(120),
  significant_changes: 'e'.repeat(30),
  notable_observations: 'f'.repeat(60),
};

describe('writeAppendixXlsx', () => {
  it('produces a workbook with 5 sheets in zh-CN', async () => {
    const buf = await writeAppendixXlsx({
      data: fakeData(),
      narrative: fakeNarrative,
      language: 'zh-CN',
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const names = wb.worksheets.map((w) => w.name);
    expect(names).toEqual(['概览', '活动明细', '排放因子', '排放源', '叙述']);
  });

  it('produces a workbook with 5 sheets in en', async () => {
    const buf = await writeAppendixXlsx({
      data: { ...fakeData(), language: 'en' },
      narrative: fakeNarrative,
      language: 'en',
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const names = wb.worksheets.map((w) => w.name);
    expect(names).toEqual([
      'Overview',
      'Activities',
      'Emission Factors',
      'Emission Sources',
      'Narrative',
    ]);
  });

  it('writes one narrative row per section (6 total)', async () => {
    const buf = await writeAppendixXlsx({
      data: fakeData(),
      narrative: fakeNarrative,
      language: 'zh-CN',
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const narrative = wb.getWorksheet('叙述')!;
    // Header row + 6 narrative rows = 7 rows.
    expect(narrative.rowCount).toBe(7);
  });

  it('lists each emission source on the Sources sheet', async () => {
    const buf = await writeAppendixXlsx({
      data: fakeData(),
      narrative: fakeNarrative,
      language: 'zh-CN',
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const sources = wb.getWorksheet('排放源')!;
    // Header + 2 data rows.
    expect(sources.rowCount).toBe(3);
  });

  it('lists each activity on the Activities sheet', async () => {
    const buf = await writeAppendixXlsx({
      data: fakeData(),
      narrative: fakeNarrative,
      language: 'zh-CN',
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const activities = wb.getWorksheet('活动明细')!;
    // Header + 2 data rows.
    expect(activities.rowCount).toBe(3);
  });
});
```

- [ ] **Step 2: Run, confirm fail**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/main/services/report-export-service.test.ts --pool=threads 2>&1 | tail -15
```

Expected: FAIL — `Cannot find module '@main/services/report-export-service'`.

- [ ] **Step 3: Implement Excel writer + PDF orchestration**

Create `src/main/services/report-export-service.ts`:

```ts
import { BrowserWindow, type WebContents } from 'electron';
import ExcelJS from 'exceljs';
import * as fs from 'node:fs/promises';
import type { ReportNarrative } from '@main/llm/report-narrative';
import type { InventoryReportData } from './report-data-service.js';

const SHEET_NAMES = {
  'zh-CN': {
    overview: '概览',
    activities: '活动明细',
    factors: '排放因子',
    sources: '排放源',
    narrative: '叙述',
  },
  en: {
    overview: 'Overview',
    activities: 'Activities',
    factors: 'Emission Factors',
    sources: 'Emission Sources',
    narrative: 'Narrative',
  },
} as const;

const NARRATIVE_HEADERS = {
  'zh-CN': { section: '章节', text: '内容' },
  en: { section: 'Section', text: 'Text' },
} as const;

const SECTION_LABELS = {
  'zh-CN': {
    boundary_description: '组织边界',
    reporting_boundary_description: '报告范围',
    methodology_description: '方法学',
    emissions_summary: '排放概要',
    significant_changes: '重大变动',
    notable_observations: '观察发现',
  },
  en: {
    boundary_description: 'Organizational boundary',
    reporting_boundary_description: 'Reporting boundary',
    methodology_description: 'Methodology',
    emissions_summary: 'Emissions summary',
    significant_changes: 'Significant changes',
    notable_observations: 'Notable observations',
  },
} as const;

export async function writeAppendixXlsx(args: {
  data: InventoryReportData;
  narrative: ReportNarrative;
  language: 'zh-CN' | 'en';
}): Promise<Buffer> {
  const { data, narrative, language } = args;
  const labels = SHEET_NAMES[language];
  const narrativeHdr = NARRATIVE_HEADERS[language];
  const sectionLabels = SECTION_LABELS[language];

  const wb = new ExcelJS.Workbook();

  // 1. Overview
  const overview = wb.addWorksheet(labels.overview);
  overview.addRow([language === 'zh-CN' ? '组织' : 'Organization', data.org.name_zh ?? data.org.name_en ?? '']);
  overview.addRow([language === 'zh-CN' ? '报告期' : 'Reporting period', `${data.period.year} ${data.period.granularity}`]);
  overview.addRow([language === 'zh-CN' ? '范围一 (kg CO2e)' : 'Scope 1 (kg CO2e)', data.scope_totals.scope1_kg]);
  overview.addRow([language === 'zh-CN' ? '范围二 (kg CO2e)' : 'Scope 2 (kg CO2e)', data.scope_totals.scope2_kg]);
  overview.addRow([language === 'zh-CN' ? '范围三 (kg CO2e)' : 'Scope 3 (kg CO2e)', data.scope_totals.scope3_kg]);
  overview.addRow([language === 'zh-CN' ? '合计 (kg CO2e)' : 'Total (kg CO2e)', data.scope_totals.total_kg]);
  overview.addRow([language === 'zh-CN' ? '生物质 (单独)' : 'Biogenic (separate)', data.scope_totals.biogenic_kg]);

  // 2. Activities — every activity_data row from data.activities.
  const activities = wb.addWorksheet(labels.activities);
  activities.addRow(
    language === 'zh-CN'
      ? ['活动 ID', '场地', '排放源', '范围', '数量', '单位', 'EF 来源', 'CO2e (kg)']
      : ['Activity ID', 'Site', 'Source', 'Scope', 'Amount', 'Unit', 'EF Source', 'CO2e (kg)'],
  );
  for (const a of data.activities) {
    activities.addRow([
      a.id,
      a.site_name ?? '',
      a.source_name,
      a.scope,
      a.amount,
      a.unit,
      a.pinned_ef_source,
      a.co2e_kg,
    ]);
  }

  // 3. Factors — derived from ef_sources_used aggregate.
  const factors = wb.addWorksheet(labels.factors);
  factors.addRow(
    language === 'zh-CN'
      ? ['来源', '使用次数', 'GWP 基准']
      : ['Source', 'Count', 'GWP basis'],
  );
  for (const f of data.ef_sources_used) {
    factors.addRow([f.source, f.count, f.gwp_basis]);
  }

  // 4. Emission Sources
  const sourcesSheet = wb.addWorksheet(labels.sources);
  sourcesSheet.addRow(
    language === 'zh-CN'
      ? ['名称', '范围', 'CO2e (kg)', '占比 %']
      : ['Name', 'Scope', 'CO2e (kg)', 'Share %'],
  );
  for (const s of data.all_sources) {
    sourcesSheet.addRow([s.name, s.scope, s.co2e_kg, s.share_pct.toFixed(2)]);
  }

  // 5. Narrative
  const narrativeSheet = wb.addWorksheet(labels.narrative);
  narrativeSheet.addRow([narrativeHdr.section, narrativeHdr.text]);
  for (const key of Object.keys(sectionLabels) as Array<keyof typeof sectionLabels>) {
    narrativeSheet.addRow([sectionLabels[key], narrative[key]]);
  }

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}

export interface ExportPdfDeps {
  /**
   * Path the print-render window should load. In production this is a
   * file:// URL to the built renderer's print-render route; in dev it's
   * the Vite dev server URL.
   */
  printRenderUrl: string;
}

export async function renderReportPdf(
  args: {
    data: InventoryReportData;
    narrative: ReportNarrative;
    language: 'zh-CN' | 'en';
  },
  deps: ExportPdfDeps,
): Promise<Buffer> {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      offscreen: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  try {
    await win.loadURL(deps.printRenderUrl);
    // Hand the data to the renderer via executeJavaScript — the renderer
    // route reads window.__REPORT_PAYLOAD__ on mount.
    await win.webContents.executeJavaScript(
      `window.__REPORT_PAYLOAD__ = ${JSON.stringify({
        data: args.data,
        narrative: args.narrative,
        language: args.language,
      })};`,
    );
    // Give layout + fonts a beat to settle. Renderer signals readiness by
    // setting document.title to "READY"; main waits for it.
    await waitForTitle(win.webContents, 'READY', 30_000);
    const buf = await win.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      margins: { top: 0.78, bottom: 0.78, left: 0.71, right: 0.71 }, // inches ~ 20/18mm
    });
    return buf;
  } finally {
    win.close();
  }
}

function waitForTitle(wc: WebContents, expected: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      wc.removeAllListeners('page-title-updated');
      reject(new Error(`PDF render did not signal ready within ${timeoutMs}ms`));
    }, timeoutMs);
    const handler = (_e: unknown, title: string) => {
      if (title === expected) {
        clearTimeout(timer);
        wc.removeListener('page-title-updated', handler);
        resolve();
      }
    };
    wc.on('page-title-updated', handler);
    // Already loaded with matching title?
    if (wc.getTitle() === expected) {
      clearTimeout(timer);
      wc.removeListener('page-title-updated', handler);
      resolve();
    }
  });
}

export function slugifyOrgName(data: InventoryReportData): string {
  const candidate = data.org.name_en ?? data.org.name_zh ?? data.org.id.slice(0, 8);
  return candidate
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || data.org.id.slice(0, 8);
}

export function defaultExportFilename(args: {
  data: InventoryReportData;
  language: 'zh-CN' | 'en';
  kind: 'pdf' | 'xlsx';
}): string {
  const slug = slugifyOrgName(args.data);
  const granSuffix = args.data.period.granularity === 'annual' ? '' : `-${args.data.period.granularity}`;
  const base = `${slug}-iso-14064-1-${args.data.period.year}${granSuffix}-${args.language}`;
  return args.kind === 'pdf' ? `${base}.pdf` : `${base}-appendix.xlsx`;
}
```

- [ ] **Step 4: Wire export handlers into report.ts**

Edit `src/main/ipc/handlers/report.ts`. Replace the two stub handlers:

```ts
import { dialog } from 'electron';
import * as fs from 'node:fs/promises';
import {
  defaultExportFilename,
  renderReportPdf,
  writeAppendixXlsx,
} from '@main/services/report-export-service';

// inside reportHandlers(ctx):
    'report:export-pdf': async (raw) => {
      const input = raw as Parameters<IpcTypeMap['report:export-pdf']>[0];
      const result = await dialog.showSaveDialog({
        title: 'Export ISO 14064-1 report (PDF)',
        defaultPath: defaultExportFilename({
          data: input.data,
          language: input.language,
          kind: 'pdf',
        }),
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });
      if (result.canceled || !result.filePath) return { canceled: true as const };
      try {
        const buf = await renderReportPdf(
          { data: input.data, narrative: input.narrative, language: input.language },
          { printRenderUrl: ctx.printRenderUrl },
        );
        await fs.writeFile(result.filePath, buf);
        return { ok: true as const, path: result.filePath };
      } catch (err) {
        return { ok: false as const, error: (err as Error).message };
      }
    },

    'report:export-xlsx': async (raw) => {
      const input = raw as Parameters<IpcTypeMap['report:export-xlsx']>[0];
      const result = await dialog.showSaveDialog({
        title: 'Export ISO 14064-1 appendix (Excel)',
        defaultPath: defaultExportFilename({
          data: input.data,
          language: input.language,
          kind: 'xlsx',
        }),
        filters: [{ name: 'Excel', extensions: ['xlsx'] }],
      });
      if (result.canceled || !result.filePath) return { canceled: true as const };
      try {
        const buf = await writeAppendixXlsx({
          data: input.data,
          narrative: input.narrative,
          language: input.language,
        });
        await fs.writeFile(result.filePath, buf);
        return { ok: true as const, path: result.filePath };
      } catch (err) {
        return { ok: false as const, error: (err as Error).message };
      }
    },
```

Update `IpcContext` (`src/main/ipc/context.ts`) to add `printRenderUrl: string`. In the bootstrap site, set it to the same renderer URL used in dev/prod plus a `?print=1` query param (or `/print-render` path — match whatever the renderer route uses).

- [ ] **Step 5: Verify**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck 2>&1 | tail -10
pnpm vitest run tests/main/services/report-export-service.test.ts --pool=threads 2>&1 | tail -15
pnpm vitest run --pool=threads 2>&1 | tail -8
```

Expected: typecheck clean; 4/4 export tests pass; ~572 tests.

- [ ] **Step 6: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add -A
git commit -m "feat(report): export service — printToPDF (hidden window) + exceljs appendix"
git branch --show-current
```

---

## Task 7: ReportPreview component + 6 section subcomponents

**Files:**
- Create: `src/renderer/components/report/ReportPreview.tsx`
- Create: `src/renderer/components/report/sections/CoverPage.tsx`
- Create: `src/renderer/components/report/sections/OrgProfile.tsx`
- Create: `src/renderer/components/report/sections/BoundarySection.tsx`
- Create: `src/renderer/components/report/sections/ScopeTable.tsx`
- Create: `src/renderer/components/report/sections/MethodologySection.tsx`
- Create: `src/renderer/components/report/sections/NarrativeSection.tsx`
- Create: `src/renderer/styles/report-preview.css`
- Create: `tests/renderer/report-preview.test.tsx`

The single visual component used for both the in-app preview and the hidden-window print render. `printMode` prop toggles print CSS class. Narrative sections accept `editable: boolean` + `onChange` callback so the preview route can hook into the same component.

- [ ] **Step 1: Write the failing test**

Create `tests/renderer/report-preview.test.tsx`:

```ts
import { ReportPreview } from '@renderer/components/report/ReportPreview';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { InventoryReportData } from '@main/services/report-data-service';
import type { ReportNarrative } from '@main/llm/report-narrative';

const data: InventoryReportData = {
  org: {
    id: 'org-1',
    name_zh: '测试公司',
    name_en: 'Test Co',
    industry: '制造业',
    country_code: 'CN',
    boundary_kind: 'operational_control',
    responsible: { name: '张三', role: '可持续发展负责人' },
  },
  period: {
    id: 'per-2025',
    year: 2025,
    granularity: 'annual',
    start: '2025-01-01',
    end: '2025-12-31',
    is_base_year: false,
    significant_changes_text: null,
  },
  sites: [{ id: 's', name_zh: '北京', name_en: 'Beijing', address: null }],
  scope_totals: { scope1_kg: 100, scope2_kg: 200, scope3_kg: 50, total_kg: 350, biogenic_kg: 0 },
  all_sources: [{ id: 'a', name: 'A', scope: 1, co2e_kg: 100, share_pct: 28.6 }],
  activities: [],
  ef_sources_used: [{ source: 'IPCC', count: 1, gwp_basis: 'AR5' }],
  language: 'zh-CN',
  prior_period_summary: null,
  base_year_summary: null,
};

const narrative: ReportNarrative = {
  boundary_description: 'BOUNDARY TEXT',
  reporting_boundary_description: 'REPORTING BOUNDARY TEXT',
  methodology_description: 'METHODOLOGY TEXT',
  emissions_summary: 'EMISSIONS SUMMARY TEXT',
  significant_changes: 'SIGNIFICANT CHANGES TEXT',
  notable_observations: 'NOTABLE OBSERVATIONS TEXT',
};

describe('ReportPreview', () => {
  it('renders all 6 narrative sections', () => {
    render(<ReportPreview data={data} narrative={narrative} printMode={false} />);
    expect(screen.getByText('BOUNDARY TEXT')).toBeTruthy();
    expect(screen.getByText('REPORTING BOUNDARY TEXT')).toBeTruthy();
    expect(screen.getByText('METHODOLOGY TEXT')).toBeTruthy();
    expect(screen.getByText('EMISSIONS SUMMARY TEXT')).toBeTruthy();
    expect(screen.getByText('SIGNIFICANT CHANGES TEXT')).toBeTruthy();
    expect(screen.getByText('NOTABLE OBSERVATIONS TEXT')).toBeTruthy();
  });

  it('renders the scope totals table', () => {
    render(<ReportPreview data={data} narrative={narrative} printMode={false} />);
    expect(screen.getByText('100')).toBeTruthy(); // scope1
    expect(screen.getByText('200')).toBeTruthy(); // scope2
    expect(screen.getByText('350')).toBeTruthy(); // total
  });

  it('applies print mode class when printMode=true', () => {
    const { container } = render(
      <ReportPreview data={data} narrative={narrative} printMode={true} />,
    );
    expect(container.querySelector('.report-preview--print')).toBeTruthy();
  });

  it('shows editable inputs when editable=true and calls onChange', async () => {
    const onChange = vi.fn();
    render(
      <ReportPreview
        data={data}
        narrative={narrative}
        printMode={false}
        editable
        onChange={onChange}
      />,
    );
    const boundary = screen.getByDisplayValue('BOUNDARY TEXT');
    expect(boundary.tagName.toLowerCase()).toBe('textarea');
  });
});
```

- [ ] **Step 2: Run, confirm fail**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/renderer/report-preview.test.tsx --pool=threads 2>&1 | tail -15
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component + subcomponents**

Create `src/renderer/components/report/ReportPreview.tsx`:

```tsx
import type { ReportNarrative } from '@main/llm/report-narrative';
import type { InventoryReportData } from '@main/services/report-data-service';

export interface ReportPreviewProps {
  data: InventoryReportData;
  narrative: ReportNarrative;
  printMode: boolean;
  editable?: boolean;
  onChange?: (narrative: ReportNarrative) => void;
}

const SECTION_ORDER: Array<keyof ReportNarrative> = [
  'boundary_description',
  'reporting_boundary_description',
  'methodology_description',
  'emissions_summary',
  'significant_changes',
  'notable_observations',
];

const SECTION_HEADINGS = {
  'zh-CN': {
    boundary_description: '5.1 组织边界',
    reporting_boundary_description: '5.2 报告范围',
    methodology_description: '7.1 方法学',
    emissions_summary: '8 排放概要',
    significant_changes: '9.3.11 重大变动',
    notable_observations: '附录 A 观察发现',
  },
  en: {
    boundary_description: '5.1 Organizational boundary',
    reporting_boundary_description: '5.2 Reporting boundary',
    methodology_description: '7.1 Methodology',
    emissions_summary: '8 Emissions summary',
    significant_changes: '9.3.11 Significant changes',
    notable_observations: 'Appendix A Notable observations',
  },
} as const;

export function ReportPreview({
  data,
  narrative,
  printMode,
  editable,
  onChange,
}: ReportPreviewProps) {
  const lang = data.language;
  const headings = SECTION_HEADINGS[lang];

  const handleNarrativeEdit = (key: keyof ReportNarrative, value: string) => {
    if (onChange) {
      onChange({ ...narrative, [key]: value });
    }
  };

  return (
    <div className={`report-preview ${printMode ? 'report-preview--print' : ''}`}>
      <CoverPage data={data} />
      <OrgProfile data={data} />
      <ScopeTable data={data} />
      {SECTION_ORDER.map((key) => (
        <section key={key} className="report-preview__section">
          <h2>{headings[key]}</h2>
          {editable && !printMode ? (
            <textarea
              defaultValue={narrative[key]}
              rows={6}
              onChange={(e) => handleNarrativeEdit(key, e.target.value)}
              style={{ width: '100%' }}
            />
          ) : (
            <p>{narrative[key]}</p>
          )}
        </section>
      ))}
    </div>
  );
}

function CoverPage({ data }: { data: InventoryReportData }) {
  const lang = data.language;
  const orgName = lang === 'zh-CN'
    ? (data.org.name_zh ?? data.org.name_en ?? '')
    : (data.org.name_en ?? data.org.name_zh ?? '');
  const title = lang === 'zh-CN' ? 'ISO 14064-1 温室气体盘查报告' : 'ISO 14064-1 GHG Inventory Report';
  return (
    <section className="report-preview__cover">
      <h1>{title}</h1>
      <h2>{orgName}</h2>
      <p>
        {lang === 'zh-CN' ? '报告期' : 'Reporting period'}: {data.period.year} ({data.period.granularity})
      </p>
    </section>
  );
}

function OrgProfile({ data }: { data: InventoryReportData }) {
  const lang = data.language;
  return (
    <section className="report-preview__org-profile">
      <h2>{lang === 'zh-CN' ? '1 组织信息' : '1 Organization profile'}</h2>
      <dl>
        <dt>{lang === 'zh-CN' ? '行业' : 'Industry'}</dt>
        <dd>{data.org.industry ?? (lang === 'zh-CN' ? '未填写' : 'Not provided')}</dd>
        <dt>{lang === 'zh-CN' ? '边界方法' : 'Consolidation approach'}</dt>
        <dd>{data.org.boundary_kind}</dd>
        <dt>{lang === 'zh-CN' ? '责任人' : 'Responsible person'}</dt>
        <dd>
          {data.org.responsible.name ?? '—'}
          {data.org.responsible.role ? ` (${data.org.responsible.role})` : ''}
        </dd>
      </dl>
    </section>
  );
}

function ScopeTable({ data }: { data: InventoryReportData }) {
  const lang = data.language;
  const labels = lang === 'zh-CN'
    ? { scope: '范围', kg: 'kg CO2e', scope1: '范围一', scope2: '范围二', scope3: '范围三', total: '合计', biogenic: '生物质 (单独披露)' }
    : { scope: 'Scope', kg: 'kg CO2e', scope1: 'Scope 1', scope2: 'Scope 2', scope3: 'Scope 3', total: 'Total', biogenic: 'Biogenic (separately disclosed)' };
  return (
    <section className="report-preview__scope-table">
      <h2>{lang === 'zh-CN' ? '2 排放汇总' : '2 Emissions summary'}</h2>
      <table>
        <thead>
          <tr>
            <th>{labels.scope}</th>
            <th>{labels.kg}</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>{labels.scope1}</td><td>{data.scope_totals.scope1_kg}</td></tr>
          <tr><td>{labels.scope2}</td><td>{data.scope_totals.scope2_kg}</td></tr>
          <tr><td>{labels.scope3}</td><td>{data.scope_totals.scope3_kg}</td></tr>
          <tr><td><strong>{labels.total}</strong></td><td><strong>{data.scope_totals.total_kg}</strong></td></tr>
          <tr><td>{labels.biogenic}</td><td>{data.scope_totals.biogenic_kg}</td></tr>
        </tbody>
      </table>
    </section>
  );
}
```

(The CoverPage / OrgProfile / ScopeTable are inlined for brevity — they could also live in `sections/` files. If you split, mirror the imports.)

Create `src/renderer/styles/report-preview.css`:

```css
.report-preview {
  font-family: system-ui, -apple-system, sans-serif;
  color: #111;
  max-width: 800px;
  margin: 0 auto;
  padding: 1rem;
}
.report-preview__section { margin: 1.5rem 0; }
.report-preview__cover { text-align: center; padding: 3rem 0; }
.report-preview table { width: 100%; border-collapse: collapse; }
.report-preview th, .report-preview td { border: 1px solid #ccc; padding: 0.4rem 0.6rem; text-align: left; }

@media print {
  .report-preview { padding: 0; max-width: none; }
  @page { size: A4; margin: 20mm 18mm; }
  @page :first { margin-top: 0; }
}
.report-preview--print { background: white; }
```

Import the CSS once in `src/renderer/components/report/ReportPreview.tsx` (at the top): `import '@renderer/styles/report-preview.css';`.

- [ ] **Step 4: Verify**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck 2>&1 | tail -10
pnpm vitest run tests/renderer/report-preview.test.tsx --pool=threads 2>&1 | tail -10
```

Expected: typecheck clean; 4/4 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add src/renderer/components/report/ \
        src/renderer/styles/report-preview.css \
        tests/renderer/report-preview.test.tsx
git commit -m "feat(ui): ReportPreview component — single visual for in-app + print"
git branch --show-current
```

Expected: ~576 tests.

---

## Task 8: /reports route — list + generate flow + preview + export buttons

**Files:**
- Create: `src/renderer/routes/reports.tsx`
- Create: `src/renderer/routes/reports_.$id.tsx`
- Create: `src/renderer/lib/api/report.ts`
- Modify: `src/renderer/components/Sidebar.tsx` — add Reports nav item
- Modify: `messages/en.json` + `messages/zh-CN.json` — i18n keys
- Modify: `src/renderer/routeTree.gen.ts` — auto-regenerated by TanStack Router vite plugin (commit it)
- Create: `tests/renderer/reports-page.test.tsx`

Two routes following flat-routes convention: `reports.tsx` (list) + `reports_.$id.tsx` (detail/generate).

The list route shows existing `reporting_period` rows with a "新建报告 / New report" CTA. The detail route handles the generate flow: form (language picker) → generate-mutation → progress subscription → preview (using `<ReportPreview editable>`) → export buttons (chains PDF then Excel).

- [ ] **Step 1: Renderer API client**

Create `src/renderer/lib/api/report.ts`:

```ts
import { invoke } from '../ipc';

export const reportApi = {
  generate: (input: { report_id: string; reporting_period_id: string; language: 'zh-CN' | 'en' }) =>
    invoke('report:generate', input),
  cancel: (input: { report_id: string }) => invoke('report:cancel', input),
  exportPdf: (input: { data: unknown; narrative: unknown; language: 'zh-CN' | 'en' }) =>
    invoke('report:export-pdf', input as never),
  exportXlsx: (input: { data: unknown; narrative: unknown; language: 'zh-CN' | 'en' }) =>
    invoke('report:export-xlsx', input as never),
};
```

(Use proper types pulled from `@main/services/report-data-service` and `@main/llm/report-narrative` instead of `unknown` if your existing shared-types pattern allows — match what the other `*Api` files do.)

- [ ] **Step 2: i18n keys**

Add to `messages/en.json` + `messages/zh-CN.json`:

```
reports_nav                "Reports"                                 / "报告"
reports_list_heading       "Inventory reports"                       / "盘查报告"
reports_list_subheading    "Generate ISO 14064-1-style reports."     / "生成 ISO 14064-1 风格的报告。"
reports_new_cta            "New report"                              / "新建报告"
reports_no_periods         "No reporting periods yet."               / "暂无报告期。"
reports_setup_required     "Set organization profile in Settings first." / "请先在设置中填写组织档案。"
reports_lang_label         "Language"                                / "语言"
reports_lang_zh            "Chinese (zh-CN)"                         / "中文 (zh-CN)"
reports_lang_en            "English"                                 / "英语"
reports_generate_button    "Generate report"                         / "生成报告"
reports_progress_assembling   "Assembling inventory data..."         / "正在装配清单数据..."
reports_progress_boundary     "Writing organizational boundary..."   / "正在撰写组织边界..."
reports_progress_reporting_boundary "Writing reporting boundary..."  / "正在撰写报告范围..."
reports_progress_methodology  "Writing methodology..."               / "正在撰写方法学..."
reports_progress_emissions    "Writing emissions summary..."         / "正在撰写排放概要..."
reports_progress_changes      "Writing significant changes..."       / "正在撰写重大变动..."
reports_progress_observations "Writing notable observations..."      / "正在撰写观察发现..."
reports_progress_finalizing   "Finalizing..."                        / "正在收尾..."
reports_cancel_button         "Cancel"                               / "取消"
reports_no_provider           "No LLM provider configured. Open Settings." / "未配置 LLM 提供商，请打开设置。"
reports_generate_failed       "Generation failed: {message}"         / "生成失败: {message}"
reports_export_pdf_button     "Export PDF"                           / "导出 PDF"
reports_export_xlsx_button    "Export Excel appendix"                / "导出 Excel 附录"
reports_export_both_button    "Confirm and export (PDF + Excel)"     / "确认导出 (PDF + Excel)"
reports_export_success        "Exported {kind} → {path}"             / "已导出 {kind} → {path}"
reports_export_failed         "Export failed: {message}"             / "导出失败: {message}"
reports_regenerate_button     "Regenerate"                           / "重新生成"
reports_regenerate_warning    "Regenerating will discard unsaved edits. Continue?" / "重新生成会丢弃未保存的修改，是否继续？"
```

Re-compile paraglide if needed:

```bash
cd /Users/lxz/ws/personal/carbonbook
npx paraglide-js compile --project ./project.inlang --outdir ./src/renderer/paraglide
```

- [ ] **Step 3: List route**

Create `src/renderer/routes/reports.tsx`:

```tsx
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { orgApi } from '@renderer/lib/api/organization';
import * as m from '@renderer/paraglide/messages';

export const Route = createFileRoute('/reports')({
  component: ReportsList,
});

function ReportsList() {
  const orgQuery = useQuery({
    queryKey: ['org:get-current'],
    queryFn: () => orgApi.getCurrent(),
  });
  const periodsQuery = useQuery({
    queryKey: ['org:list-reporting-periods', orgQuery.data?.id],
    queryFn: () => orgApi.listReportingPeriods({ organization_id: orgQuery.data!.id }),
    enabled: !!orgQuery.data?.id,
  });

  const profileReady = !!orgQuery.data?.responsible_person_name;

  return (
    <div className="container mx-auto py-8 px-4 max-w-3xl">
      <h1 className="text-2xl font-semibold mb-1">{m.reports_list_heading()}</h1>
      <p className="text-sm text-muted-foreground mb-6">{m.reports_list_subheading()}</p>

      {!profileReady && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 mb-4 text-sm">
          {m.reports_setup_required()}
        </div>
      )}

      <ul className="space-y-2">
        {periodsQuery.data?.length ? (
          periodsQuery.data.map((p) => (
            <li key={p.id} className="rounded border p-3 flex items-center justify-between">
              <span>{p.year} · {p.granularity}</span>
              <Link
                to="/reports/$id"
                params={{ id: p.id }}
                className={`text-sm underline ${profileReady ? '' : 'pointer-events-none opacity-40'}`}
              >
                {m.reports_new_cta()}
              </Link>
            </li>
          ))
        ) : (
          <li className="text-sm text-muted-foreground">{m.reports_no_periods()}</li>
        )}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Detail route — generate + preview + export**

Create `src/renderer/routes/reports_.$id.tsx`. Approximate shape (adapt to existing renderer patterns):

```tsx
import { createFileRoute } from '@tanstack/react-router';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { ulid } from 'ulid';
import { reportApi } from '@renderer/lib/api/report';
import { ReportPreview } from '@renderer/components/report/ReportPreview';
import { ipcBridge } from '@renderer/lib/ipc';
import * as m from '@renderer/paraglide/messages';
import { toast } from '@renderer/components/toast';
import type { InventoryReportData } from '@main/services/report-data-service';
import type { ReportNarrative } from '@main/llm/report-narrative';

export const Route = createFileRoute('/reports/$id')({ component: ReportDetail });

function ReportDetail() {
  const { id } = Route.useParams();
  const [language, setLanguage] = useState<'zh-CN' | 'en'>('zh-CN');
  const [reportId, setReportId] = useState<string | null>(null);
  const [progressLabel, setProgressLabel] = useState<string>(m.reports_progress_assembling());
  const [generated, setGenerated] = useState<{
    data: InventoryReportData;
    narrative: ReportNarrative;
  } | null>(null);

  // Subscribe to progress events for the duration of an inflight call.
  useEffect(() => {
    if (!reportId) return;
    const unsubscribe = ipcBridge.subscribe('report:progress', (payload) => {
      if (payload.report_id !== reportId) return;
      switch (payload.sub_phase) {
        case 'boundary': setProgressLabel(m.reports_progress_boundary()); break;
        case 'reporting-boundary': setProgressLabel(m.reports_progress_reporting_boundary()); break;
        case 'methodology': setProgressLabel(m.reports_progress_methodology()); break;
        case 'emissions': setProgressLabel(m.reports_progress_emissions()); break;
        case 'changes': setProgressLabel(m.reports_progress_changes()); break;
        case 'observations': setProgressLabel(m.reports_progress_observations()); break;
        default:
          if (payload.phase === 'finalizing') setProgressLabel(m.reports_progress_finalizing());
          break;
      }
    });
    return () => unsubscribe();
  }, [reportId]);

  const generateMutation = useMutation({
    mutationFn: async () => {
      const newId = ulid();
      setReportId(newId);
      setProgressLabel(m.reports_progress_assembling());
      return reportApi.generate({ report_id: newId, reporting_period_id: id, language });
    },
    onSuccess: (result) => {
      setReportId(null);
      if ('canceled' in result && result.canceled) return;
      if ('error' in result) {
        if (result.error._tag === 'NoProvider') {
          toast.error(m.reports_no_provider());
        } else {
          toast.error(m.reports_generate_failed({ message: result.error.message ?? '' }));
        }
        return;
      }
      setGenerated({ data: result.data, narrative: result.narrative });
    },
    onError: (err) => {
      setReportId(null);
      toast.error(m.reports_generate_failed({ message: (err as Error).message }));
    },
  });

  const cancel = () => {
    if (reportId) reportApi.cancel({ report_id: reportId });
  };

  const exportBoth = useMutation({
    mutationFn: async () => {
      if (!generated) throw new Error('no narrative');
      const pdfResult = await reportApi.exportPdf({
        data: generated.data,
        narrative: generated.narrative,
        language,
      });
      if ('canceled' in pdfResult && pdfResult.canceled) return;
      if ('ok' in pdfResult && pdfResult.ok) {
        toast.success(m.reports_export_success({ kind: 'PDF', path: pdfResult.path }));
      } else if ('ok' in pdfResult && !pdfResult.ok) {
        toast.error(m.reports_export_failed({ message: pdfResult.error }));
        return;
      }
      const xlsxResult = await reportApi.exportXlsx({
        data: generated.data,
        narrative: generated.narrative,
        language,
      });
      if ('canceled' in xlsxResult && xlsxResult.canceled) return;
      if ('ok' in xlsxResult && xlsxResult.ok) {
        toast.success(m.reports_export_success({ kind: 'Excel', path: xlsxResult.path }));
      } else if ('ok' in xlsxResult && !xlsxResult.ok) {
        toast.error(m.reports_export_failed({ message: xlsxResult.error }));
      }
    },
  });

  return (
    <div className="container mx-auto py-8 px-4 max-w-4xl">
      {!generated && (
        <div className="space-y-4">
          <label className="block">
            <span className="text-sm">{m.reports_lang_label()}</span>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value as 'zh-CN' | 'en')}
              className="block mt-1 border rounded px-2 py-1"
            >
              <option value="zh-CN">{m.reports_lang_zh()}</option>
              <option value="en">{m.reports_lang_en()}</option>
            </select>
          </label>
          {generateMutation.isPending ? (
            <div className="flex items-center gap-2">
              <span>{progressLabel}</span>
              <button onClick={cancel} className="rounded border px-2 py-1 text-sm">
                {m.reports_cancel_button()}
              </button>
            </div>
          ) : (
            <button
              onClick={() => generateMutation.mutate()}
              className="rounded bg-black text-white px-3 py-2"
            >
              {m.reports_generate_button()}
            </button>
          )}
        </div>
      )}

      {generated && (
        <>
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => exportBoth.mutate()}
              disabled={exportBoth.isPending}
              className="rounded bg-black text-white px-3 py-2"
            >
              {m.reports_export_both_button()}
            </button>
            <button
              onClick={() => {
                if (window.confirm(m.reports_regenerate_warning())) {
                  setGenerated(null);
                  generateMutation.mutate();
                }
              }}
              className="rounded border px-3 py-2"
            >
              {m.reports_regenerate_button()}
            </button>
          </div>
          <ReportPreview
            data={generated.data}
            narrative={generated.narrative}
            printMode={false}
            editable
            onChange={(next) => setGenerated((prev) => prev ? { ...prev, narrative: next } : prev)}
          />
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Sidebar integration**

Edit `src/renderer/components/Sidebar.tsx`. Add a new nav item linking to `/reports` (near other top-level routes like Documents, Questionnaires). Use a sensible icon (e.g. file-text or document-report from the existing icon library).

- [ ] **Step 6: Renderer smoke test**

Create `tests/renderer/reports-page.test.tsx`:

```tsx
import { ReportsList } from '@renderer/routes/reports';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@renderer/lib/api/organization', () => ({
  orgApi: {
    getCurrent: vi.fn().mockResolvedValue({
      id: 'org-1',
      responsible_person_name: '张三',
      boundary_kind: 'operational_control',
    }),
    listReportingPeriods: vi.fn().mockResolvedValue([
      { id: 'per-2025', year: 2025, granularity: 'annual' },
    ]),
  },
}));

describe('Reports list page', () => {
  it('shows the period and new-report link when profile is set', async () => {
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <ReportsList />
      </QueryClientProvider>,
    );
    await waitFor(() => {
      expect(screen.getByText(/2025/)).toBeTruthy();
    });
    // CTA link rendered (text varies by locale; assert by ARIA role on the underlying <a>)
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toContain('/reports/per-2025');
  });

  it('shows setup-required banner when responsible_person_name is null', async () => {
    const { orgApi } = await import('@renderer/lib/api/organization');
    vi.mocked(orgApi.getCurrent).mockResolvedValue({
      id: 'org-1',
      responsible_person_name: null,
      boundary_kind: 'operational_control',
    } as never);
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <ReportsList />
      </QueryClientProvider>,
    );
    await waitFor(() => {
      expect(screen.getByText(/Settings|设置/)).toBeTruthy();
    });
  });
});
```

- [ ] **Step 7: Verify**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck 2>&1 | tail -10
pnpm vitest run tests/renderer/reports-page.test.tsx --pool=threads 2>&1 | tail -10
pnpm vitest run --pool=threads 2>&1 | tail -8
```

Expected: typecheck clean; 2/2 new renderer tests pass; ~578 tests total.

- [ ] **Step 8: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add -A
git commit -m "feat(ui): /reports list + detail routes + sidebar nav"
git branch --show-current
```

---

## Task 9: Sweep + verification

- [ ] **Step 1: Full suite**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run --pool=threads 2>&1 | tail -8
```

Expected: ~578 tests, all passing.

If you see 184+ failures all citing `NODE_MODULE_VERSION 145`:

```bash
rm node_modules/.pnpm/better-sqlite3@12.9.0/node_modules/better-sqlite3/build/Release/better_sqlite3.node
pnpm rebuild better-sqlite3
pnpm vitest run --pool=threads 2>&1 | tail -8
```

- [ ] **Step 2: typecheck + format + lint**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck
pnpm format 2>&1 | tail -3
pnpm exec biome check --write 2>&1 | tail -3
```

- [ ] **Step 3: Final commit + history**

```bash
cd /Users/lxz/ws/personal/carbonbook
git status
git add -A
git commit -m "chore: biome sweep for Phase 3 ISO 14064-1 report" || true
git log --oneline -15
git branch --show-current
```

---

## Closeout

Phase 3 sub-project 1 lands on `main`:

- Migration 015 — `boundary_kind` widened + 6 new columns across 3 tables.
- `ReportDataService` — pure read assembly of `InventoryReportData`.
- `LlmReportNarrativeService` — `streamObject` + `abortSignal` + 6-section structured output.
- `ReportExportService` — hidden BrowserWindow + `printToPDF` for PDF; `exceljs` for 5-sheet appendix.
- 4 new IPC channels + 1 push channel (`report:progress`).
- New `/reports` + `/reports/$id` routes.
- Organization Profile section in Settings drawer.
- ~25 new tests (553 → ~578); typecheck + biome clean.

**Manual smoke deferred** to the consolidated phase-3 tag-time verification:

- Visual PDF check (page breaks, headers, footers, fonts).
- Real LLM call end-to-end (no canned narrative).
- File on disk opens cleanly in Adobe Reader / Preview.
- Excel opens cleanly in Excel + Numbers + LibreOffice.

**Next sub-projects (Phase 3 remaining candidates, separate plans each):**

- PDF rearrange export (questionnaire-side companion to the Excel export).
- EF rebind UI (swap an `emission_factor` on an existing `activity_data` row).
- audit_event UI (surface the trigger-populated audit log).
