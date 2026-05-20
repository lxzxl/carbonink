# EF Rebind UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user swap the pinned `emission_factor` on an existing `activity_data` row from a drawer on the Activities list, with same-family unit conversion, before/after CO2e delta preview, and an `audit_event` row capturing the change.

**Architecture:** Refactor — extract `<EfPicker>` from `ActivityForm.tsx`. Add `ActivityDataService.rebindEf` + `getByIdWithEf` (transaction: pin via existing `EfService.pin` + UPDATE activity_data + INSERT audit_event). Two new IPC channels (`activity:get-by-id`, `activity:rebind-ef`). New `<RebindEfDrawer>` component owns drawer state and client-side delta preview. Activities list row gets a "重新镶嵌" button.

**Tech Stack:** TypeScript strict, React 18, TanStack Query, better-sqlite3 transactions, vitest, paraglide i18n.

**Spec:** `docs/specs/2026-05-20-ef-rebind-ui-design.md` (commit `13a90a7`).

**Baseline:** 580 tests on `main`. Target after this sub-project: ~590 tests.

**Sub-project context:** This is sub-project 2 of 4 in Phase 3. After this lands, sub-projects 3 (PDF rearrange export) and 4 (audit_event UI) remain.

**Recurring environmental hazard:** better-sqlite3 ABI flip between Node (vitest) and Electron (dev/build). If a task suddenly produces 184+ test failures all citing `NODE_MODULE_VERSION 145`, recover with:

```bash
rm node_modules/.pnpm/better-sqlite3@12.9.0/node_modules/better-sqlite3/build/Release/better_sqlite3.node
pnpm rebuild better-sqlite3
```

This is environmental, not a regression.

**Discipline reminder for implementers:** Before your final commit on each task, run `git status` and confirm there are NO uncommitted file changes besides the `.claude/` untracked dir. `git add -A && git restore --staged .claude` before committing.

---

## Task 1: Extract `<EfPicker>` from `ActivityForm.tsx`

**Files:**
- Create: `src/renderer/components/EfPicker.tsx`
- Modify: `src/renderer/components/ActivityForm.tsx`
- (Optional) Modify: `tests/renderer/activity-form-matcher.test.tsx` — adapt imports if mocks need it

Pure refactor — no behavior change. The Recommended (Matcher) + Browse 2-pane picker currently embedded inside `ActivityForm.tsx` becomes a standalone `<EfPicker>` component. ActivityForm tests must keep passing.

- [ ] **Step 1: Recon — identify the picker boundaries inside ActivityForm.tsx**

Open `src/renderer/components/ActivityForm.tsx` and locate the picker section. Lines ~307-616 contain:
- The `useQuery(['ef:recommend', ...])` for `matcherHint`
- The Recommended pane JSX
- The Browse pane (Library) JSX with `ef:list` query
- The selected-EF preview block

Map out the props the extracted component needs:
- `selectedSourceId: string | null` — to gate the matcher query
- `matcherHint?: { extraction_id: string; stage_id: string }` — Recommended pane trigger
- `currentEfPk: EfCompositePk | null` — pre-selected EF (used by the new RebindEfDrawer)
- `onChange(efPk: EfCompositePk | null): void` — fires when user picks an EF
- Optional UI knobs (scope filter, geography filter, etc.) if the picker exposes them

- [ ] **Step 2: Write the failing renderer test for `<EfPicker>` (smoke)**

Create `tests/renderer/ef-picker.test.tsx`:

```tsx
import { EfPicker } from '@renderer/components/EfPicker';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@renderer/lib/api/ef-library', () => ({
  efApi: {
    list: vi.fn().mockResolvedValue([
      {
        factor_code: 'diesel_L',
        year: 2025,
        source: 'IPCC',
        geography: 'CN',
        dataset_version: '2025.1',
        scope: 1,
        category: 'fuel',
        input_unit: 'L',
        co2e_kg_per_unit: 2.68,
        gwp_basis: 'AR5',
        name_zh: '柴油',
        name_en: 'Diesel',
        description_zh: null,
        description_en: null,
        ghg_protocol_path: null,
        notes: null,
        citation_url: null,
        ch4_kg_per_unit: null,
        n2o_kg_per_unit: null,
        hfc_kg_per_unit: null,
        pfc_kg_per_unit: null,
        sf6_kg_per_unit: null,
        nf3_kg_per_unit: null,
        biogenic_co2_factor: null,
      },
    ]),
  },
}));
vi.mock('@renderer/lib/api/ef-matcher', () => ({
  efMatcherApi: { recommend: vi.fn().mockResolvedValue({ candidates: [] }) },
}));

describe('<EfPicker>', () => {
  it('renders the Browse pane with EFs from ef:list', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <EfPicker
          selectedSourceId="src-1"
          currentEfPk={null}
          onChange={vi.fn()}
        />
      </QueryClientProvider>,
    );
    await waitFor(() => {
      expect(screen.getByText(/diesel/i)).toBeTruthy();
    });
  });

  it('does not query the matcher when matcherHint is absent', () => {
    const { efMatcherApi } = require('@renderer/lib/api/ef-matcher');
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <EfPicker
          selectedSourceId="src-1"
          currentEfPk={null}
          onChange={vi.fn()}
        />
      </QueryClientProvider>,
    );
    expect(efMatcherApi.recommend).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run, confirm fail**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/renderer/ef-picker.test.tsx --pool=threads 2>&1 | tail -15
```

Expected: FAIL — `Cannot find module '@renderer/components/EfPicker'`.

- [ ] **Step 4: Create `<EfPicker>`**

Read `src/renderer/components/ActivityForm.tsx` carefully (the picker spans roughly lines 307-616). Extract:

- `useQuery(['ef:recommend', ...])` and its enabled-gate
- The Recommended pane JSX (rendered when `matcherHintRef && selectedSourceId`)
- The `useQuery(['ef:list', ...])` for Library browse
- The Browse pane JSX
- The selected-EF preview / detail block (the row that shows the currently-picked EF info)

Create `src/renderer/components/EfPicker.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { efApi } from '@renderer/lib/api/ef-library';
import { efMatcherApi } from '@renderer/lib/api/ef-matcher';
import type { EfCompositePk, EmissionFactor } from '@shared/types';
import * as m from '@renderer/paraglide/messages';

export interface EfPickerProps {
  selectedSourceId: string | null;
  /** Pre-selected EF (e.g. the current pin when used inside RebindEfDrawer). */
  currentEfPk: EfCompositePk | null;
  /** Drives the Recommended pane. Omit to hide that pane entirely. */
  matcherHint?: { extraction_id: string; stage_id: string };
  /** Optional scope filter to narrow the Browse pane. */
  scopeFilter?: 1 | 2 | 3;
  onChange: (efPk: EfCompositePk | null) => void;
}

function efPkEqual(a: EfCompositePk | null, b: EfCompositePk | null): boolean {
  if (!a || !b) return a === b;
  return (
    a.factor_code === b.factor_code &&
    a.year === b.year &&
    a.source === b.source &&
    a.geography === b.geography &&
    a.dataset_version === b.dataset_version
  );
}

function pkOf(ef: EmissionFactor): EfCompositePk {
  return {
    factor_code: ef.factor_code,
    year: ef.year,
    source: ef.source,
    geography: ef.geography,
    dataset_version: ef.dataset_version,
  };
}

export function EfPicker({
  selectedSourceId,
  currentEfPk,
  matcherHint,
  scopeFilter,
  onChange,
}: EfPickerProps) {
  const [tab, setTab] = useState<'recommended' | 'browse'>(
    matcherHint ? 'recommended' : 'browse',
  );

  const recommendQuery = useQuery({
    queryKey: ['ef:recommend', matcherHint?.extraction_id ?? '', selectedSourceId ?? ''],
    queryFn: () =>
      efMatcherApi.recommend({
        extraction_id: matcherHint!.extraction_id,
        stage_id: matcherHint!.stage_id,
      }),
    enabled: !!matcherHint && !!selectedSourceId,
  });

  const listQuery = useQuery({
    queryKey: ['ef:list', scopeFilter ?? null],
    queryFn: () => efApi.list({ scope: scopeFilter }),
  });

  const efRows: EmissionFactor[] = useMemo(() => listQuery.data ?? [], [listQuery.data]);

  return (
    <div className="ef-picker">
      {matcherHint && (
        <div className="ef-picker__tabs">
          <button
            type="button"
            onClick={() => setTab('recommended')}
            className={tab === 'recommended' ? 'active' : ''}
          >
            {m.ef_picker_tab_recommended()}
          </button>
          <button
            type="button"
            onClick={() => setTab('browse')}
            className={tab === 'browse' ? 'active' : ''}
          >
            {m.ef_picker_tab_browse()}
          </button>
        </div>
      )}

      {tab === 'recommended' && matcherHint && (
        <div className="ef-picker__recommended">
          {recommendQuery.isPending && <p>{m.ef_picker_loading()}</p>}
          {recommendQuery.data?.candidates?.map((c) => (
            <EfRow
              key={`${c.factor_code}-${c.year}-${c.source}-${c.geography}-${c.dataset_version}`}
              ef={c}
              selected={efPkEqual(pkOf(c), currentEfPk)}
              onClick={() => onChange(pkOf(c))}
            />
          ))}
          {recommendQuery.data?.candidates?.length === 0 && (
            <p>{m.ef_picker_no_recommendations()}</p>
          )}
        </div>
      )}

      {tab === 'browse' && (
        <div className="ef-picker__browse">
          {listQuery.isPending && <p>{m.ef_picker_loading()}</p>}
          {efRows.map((ef) => (
            <EfRow
              key={`${ef.factor_code}-${ef.year}-${ef.source}-${ef.geography}-${ef.dataset_version}`}
              ef={ef}
              selected={efPkEqual(pkOf(ef), currentEfPk)}
              onClick={() => onChange(pkOf(ef))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function EfRow({
  ef,
  selected,
  onClick,
}: { ef: EmissionFactor; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`ef-picker__row ${selected ? 'ef-picker__row--selected' : ''}`}
    >
      <div className="ef-picker__row-name">{ef.name_zh ?? ef.name_en ?? ef.factor_code}</div>
      <div className="ef-picker__row-meta">
        {ef.factor_code} · {ef.source} {ef.year} · {ef.geography} · {ef.input_unit}
      </div>
      <div className="ef-picker__row-value">{ef.co2e_kg_per_unit} kg CO2e / {ef.input_unit}</div>
    </button>
  );
}
```

**Important:** the exact JSX structure inside the Recommended + Browse panes must match what's in ActivityForm.tsx today (because pre-existing renderer tests reference specific text / roles). If your simplified version above doesn't pass `tests/renderer/activity-form-matcher.test.tsx`, port more of the original JSX literally.

- [ ] **Step 5: Refactor ActivityForm.tsx to use `<EfPicker>`**

In `src/renderer/components/ActivityForm.tsx`, find the inline picker code (roughly lines 307-616) and REPLACE it with:

```tsx
import { EfPicker } from './EfPicker';

// ... inside the component, where the picker used to render:
<EfPicker
  selectedSourceId={selectedSourceId}
  currentEfPk={pickedEfPk}   // whatever state variable currently holds the picked PK
  matcherHint={matcherHintRef}
  onChange={setPickedEfPk}
/>
```

Keep all the surrounding ActivityForm logic (form state, validation, submit handler) unchanged. The selected EF is still tracked by ActivityForm's existing state; EfPicker is only responsible for the picking UI.

Delete the `useQuery(['ef:recommend', ...])` and `useQuery(['ef:list', ...])` calls from ActivityForm — they now live inside EfPicker.

- [ ] **Step 6: Add i18n keys for EfPicker**

Add to `messages/en.json` and `messages/zh-CN.json`:

```
ef_picker_tab_recommended    "Recommended"          /  "推荐"
ef_picker_tab_browse         "Browse"               /  "浏览"
ef_picker_loading            "Loading..."           /  "加载中..."
ef_picker_no_recommendations "No recommendations."  /  "暂无推荐。"
```

Recompile paraglide:

```bash
cd /Users/lxz/ws/personal/carbonbook
npx paraglide-js compile --project ./project.inlang --outdir ./src/renderer/paraglide
```

If `project.inlang` is elsewhere: `find . -name "project.inlang" -not -path "*/node_modules/*"`.

- [ ] **Step 7: Verify**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck 2>&1 | tail -10
pnpm vitest run tests/renderer/ef-picker.test.tsx --pool=threads 2>&1 | tail -10
pnpm vitest run tests/renderer/activity-form-matcher.test.tsx --pool=threads 2>&1 | tail -10
pnpm vitest run --pool=threads 2>&1 | tail -8
```

Expected: typecheck clean; 2/2 new EfPicker tests pass; ActivityForm tests still pass; total ~582 (580 + 2). If ActivityForm tests fail, the refactor cut something the tests depend on — port more JSX literally from the original.

- [ ] **Step 8: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git status   # only intentional changes + .claude/
git add -A && git restore --staged .claude || true
git commit -m "refactor(ui): extract <EfPicker> from ActivityForm.tsx"
git log --oneline -3
git branch --show-current
```

Branch must be `main`.

---

## Task 2: `ActivityDataService.rebindEf` + `getByIdWithEf` + tests

**Files:**
- Modify: `src/main/services/activity-data-service.ts`
- Modify: `tests/main/services/activity-data-service.test.ts` (add new describe blocks)
- Modify: `src/shared/types.ts` — add `ActivityDataWithEf`

Service-layer transaction: pin new EF via `EfService.pin` → UPDATE activity_data → INSERT audit_event. Handles same-family unit conversion via `unit-conversion-service.convert()`. Returns typed errors as discriminated unions.

- [ ] **Step 1: Add `ActivityDataWithEf` type**

In `src/shared/types.ts`, find the existing `ActivityData` definition. After it, add:

```ts
/** ActivityData row joined with the currently pinned emission factor. */
export type ActivityDataWithEf = ActivityData & {
  pinned_ef: PinnedEmissionFactor;
};
```

- [ ] **Step 2: Write the failing service tests**

Open `tests/main/services/activity-data-service.test.ts` and append (or add a new file `tests/main/services/activity-data-service-rebind.test.ts` — match the existing pattern). The tests below assume the existing file uses a `setup()` helper that returns `{ db, svc, efService, unitConversionService }`. If not, adapt to whatever helper the existing tests use, OR write a small fresh setup. **Read the top of the existing test file FIRST** to see the setup pattern, then mirror it.

```ts
describe('ActivityDataService.rebindEf', () => {
  function seedActivity(db: Database.Database) {
    // Two emission_factor rows so we can rebind between them.
    db.prepare(
      `INSERT INTO emission_factor (factor_code, year, source, geography, dataset_version,
         scope, category, input_unit, co2e_kg_per_unit, gwp_basis, name_zh, name_en,
         description_zh, description_en, ghg_protocol_path, notes, citation_url)
       VALUES
         ('diesel_L', 2024, 'MEE',  'CN', '2024.1', 1, 'fuel', 'L',  2.68, 'AR5', '柴油', 'Diesel', NULL, NULL, NULL, NULL, NULL),
         ('diesel_kg', 2025, 'IPCC', 'CN', '2025.1', 1, 'fuel', 'kg', 3.17, 'AR5', '柴油', 'Diesel', NULL, NULL, NULL, NULL, NULL),
         ('grid_kWh',  2025, 'MEE',  'CN', '2025.1', 2, 'electricity', 'kWh', 0.5703, 'AR5', '电网', 'Grid', NULL, NULL, NULL, NULL, NULL)`,
    ).run();
    // Site + source + period + activity.
    db.prepare(
      `INSERT INTO organization (id, name_zh, country_code, boundary_kind, created_at, updated_at)
       VALUES ('org-1', 'Org', 'CN', 'operational_control', '2026-01-01', '2026-01-01')`,
    ).run();
    db.prepare(
      `INSERT INTO site (id, organization_id, name_zh, country_code, is_active, created_at, updated_at)
       VALUES ('site-1', 'org-1', 'Site', 'CN', 1, '2026-01-01', '2026-01-01')`,
    ).run();
    db.prepare(
      `INSERT INTO emission_source (id, organization_id, site_id, name, scope, created_at)
       VALUES ('src-1', 'org-1', 'site-1', 'Diesel fleet', 1, '2026-01-01')`,
    ).run();
    db.prepare(
      `INSERT INTO reporting_period (id, organization_id, year, granularity, starts_at, ends_at, is_active, created_at)
       VALUES ('per-2025', 'org-1', 2025, 'annual', '2025-01-01', '2025-12-31', 1, '2025-01-01')`,
    ).run();
    // Pin diesel_L (the initial EF).
    db.prepare(
      `INSERT INTO pinned_emission_factor (factor_code, year, source, geography, dataset_version,
         scope, category, input_unit, co2e_kg_per_unit, gwp_basis, name_zh, name_en,
         description_zh, description_en, ghg_protocol_path, citation_url, pinned_at, pinned_from)
       VALUES ('diesel_L', 2024, 'MEE', 'CN', '2024.1', 1, 'fuel', 'L', 2.68, 'AR5',
               '柴油', 'Diesel', NULL, NULL, NULL, NULL, '2026-01-01', 'app.sqlite')`,
    ).run();
    // Activity with 1000 L diesel, pinned to diesel_L. computed_co2e_kg = 1000 * 2.68 = 2680.
    db.prepare(
      `INSERT INTO activity_data (id, site_id, emission_source_id, reporting_period_id,
         occurred_at_start, occurred_at_end, amount, unit,
         ef_factor_code, ef_year, ef_source, ef_geography, ef_dataset_version,
         computed_co2e_kg, computed_at, created_at, updated_at)
       VALUES ('act-1', 'site-1', 'src-1', 'per-2025',
               '2025-04-01', '2025-04-30', 1000, 'L',
               'diesel_L', 2024, 'MEE', 'CN', '2024.1',
               2680, '2025-05-01', '2025-05-01', '2025-05-01')`,
    ).run();
  }

  it('rebinds when units match exactly', () => {
    // amount stays the same; co2e recomputed; audit_event written
    const db = new Database(':memory:');
    runMigrations(db);
    seedActivity(db);
    // Adapt to whatever the existing service-construction helper is:
    const svc = makeActivityDataService(db);
    const result = svc.rebindEf({
      activity_id: 'act-1',
      new_ef_pk: { factor_code: 'diesel_L', year: 2024, source: 'MEE', geography: 'CN', dataset_version: '2024.1' },
    });
    expect(result.ok).toBe(true);
    // Trivial rebind to same EF — co2e unchanged.
    if (result.ok) {
      expect(result.old_co2e_kg).toBe(2680);
      expect(result.new_co2e_kg).toBe(2680);
    }
    const audit = db
      .prepare(`SELECT * FROM audit_event WHERE event_kind = 'activity_rebind_ef'`)
      .all() as Array<{ payload: string }>;
    expect(audit).toHaveLength(1);
    const payload = JSON.parse(audit[0].payload);
    expect(payload.activity_id).toBe('act-1');
    db.close();
  });

  it('rebinds with same-family unit conversion (L → kg with conversion table)', () => {
    // NOTE: this test depends on unit_definition having a L↔kg conversion path,
    // OR the implementation refusing the conversion if the table doesn't have it
    // (in which case this test should assert UnitMismatch instead).
    // Run the test once; if it fails because convert() throws on L→kg without
    // fuel binding, change the test's new_ef_pk to ('diesel_L_v2', 2025, ...)
    // — i.e. a same-unit-different-version rebind, which is the actually-realistic
    // case.
    const db = new Database(':memory:');
    runMigrations(db);
    seedActivity(db);
    const svc = makeActivityDataService(db);
    const result = svc.rebindEf({
      activity_id: 'act-1',
      new_ef_pk: { factor_code: 'diesel_kg', year: 2025, source: 'IPCC', geography: 'CN', dataset_version: '2025.1' },
    });
    // L → kg without a fuel binding is cross-family in the existing
    // unit-conversion-service (the family for L is "volume", for kg is "mass").
    // Therefore expect UnitMismatch:
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error._tag).toBe('UnitMismatch');
    }
    db.close();
  });

  it('refuses cross-family rebind (no fuel binding) with UnitMismatch', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    seedActivity(db);
    const svc = makeActivityDataService(db);
    const result = svc.rebindEf({
      activity_id: 'act-1',
      new_ef_pk: { factor_code: 'grid_kWh', year: 2025, source: 'MEE', geography: 'CN', dataset_version: '2025.1' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error._tag).toBe('UnitMismatch');
    }
    // Activity row unchanged.
    const row = db.prepare(`SELECT computed_co2e_kg FROM activity_data WHERE id = 'act-1'`).get() as { computed_co2e_kg: number };
    expect(row.computed_co2e_kg).toBe(2680);
    // No audit_event written.
    const audit = db.prepare(`SELECT COUNT(*) AS c FROM audit_event`).get() as { c: number };
    expect(audit.c).toBe(0);
    db.close();
  });

  it('returns NotFound when activity_id is unknown', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    seedActivity(db);
    const svc = makeActivityDataService(db);
    const result = svc.rebindEf({
      activity_id: 'ghost',
      new_ef_pk: { factor_code: 'diesel_L', year: 2024, source: 'MEE', geography: 'CN', dataset_version: '2024.1' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error._tag).toBe('NotFound');
    db.close();
  });

  it('returns EfNotFound when new_ef_pk has no matching emission_factor row', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    seedActivity(db);
    const svc = makeActivityDataService(db);
    const result = svc.rebindEf({
      activity_id: 'act-1',
      new_ef_pk: { factor_code: 'phantom', year: 2025, source: 'NONE', geography: 'CN', dataset_version: '2025.1' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error._tag).toBe('EfNotFound');
    db.close();
  });
});

describe('ActivityDataService.getByIdWithEf', () => {
  it('returns the activity joined with its pinned_ef', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    seedActivity(db);
    const svc = makeActivityDataService(db);
    const row = svc.getByIdWithEf('act-1');
    expect(row).not.toBeNull();
    if (row) {
      expect(row.id).toBe('act-1');
      expect(row.pinned_ef.factor_code).toBe('diesel_L');
      expect(row.pinned_ef.year).toBe(2024);
    }
    db.close();
  });

  it('returns null for unknown id', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    seedActivity(db);
    const svc = makeActivityDataService(db);
    expect(svc.getByIdWithEf('ghost')).toBeNull();
    db.close();
  });
});
```

**Important:** `makeActivityDataService(db)` is a placeholder. Read the top of the existing `tests/main/services/activity-data-service.test.ts` to see how the service is constructed in tests — it likely takes `{ db, efService, unitConversionService }`. Use that pattern.

- [ ] **Step 3: Run, confirm fail**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/main/services/activity-data-service.test.ts --pool=threads 2>&1 | tail -20
```

Expected: tests fail because `rebindEf` / `getByIdWithEf` don't exist yet.

- [ ] **Step 4: Implement the service methods**

Open `src/main/services/activity-data-service.ts`. Add the new methods to the class:

```ts
  /**
   * Rebind the pinned EF on an existing activity. Recomputes co2e_kg
   * (with same-family unit conversion if needed) and writes an audit_event
   * row capturing the change. Returns a discriminated-union result —
   * the IPC layer surfaces the error variants without throwing.
   */
  rebindEf(input: {
    activity_id: string;
    new_ef_pk: EfCompositePk;
  }):
    | {
        ok: true;
        updated: ActivityData;
        old_co2e_kg: number;
        new_co2e_kg: number;
        old_amount: number;
        old_unit: string;
        new_amount: number;
        new_unit: string;
      }
    | { ok: false; error: { _tag: 'NotFound' | 'EfNotFound' | 'UnitMismatch'; message: string } } {
    // 1. Load current activity.
    const current = this.db
      .prepare(`${AD_SELECT} WHERE id = ?`)
      .get(input.activity_id) as ActivityData | undefined;
    if (!current) {
      return { ok: false, error: { _tag: 'NotFound', message: `activity_data not found: ${input.activity_id}` } };
    }

    // 2. Validate the new EF exists in emission_factor.
    const efRow = this.db
      .prepare(
        `SELECT input_unit, co2e_kg_per_unit FROM emission_factor
          WHERE factor_code = ? AND year = ? AND source = ? AND geography = ? AND dataset_version = ?`,
      )
      .get(
        input.new_ef_pk.factor_code,
        input.new_ef_pk.year,
        input.new_ef_pk.source,
        input.new_ef_pk.geography,
        input.new_ef_pk.dataset_version,
      ) as { input_unit: string; co2e_kg_per_unit: number } | undefined;
    if (!efRow) {
      return {
        ok: false,
        error: { _tag: 'EfNotFound', message: `emission_factor not found for PK ${JSON.stringify(input.new_ef_pk)}` },
      };
    }

    // 3. Resolve unit conversion (same-family allowed; cross-family rejected).
    let newAmount: number;
    if (current.unit === efRow.input_unit) {
      newAmount = current.amount;
    } else {
      try {
        newAmount = this.unitConversionService.convert(current.amount, current.unit, efRow.input_unit);
      } catch (err) {
        return {
          ok: false,
          error: {
            _tag: 'UnitMismatch',
            message: `Cannot convert ${current.unit} → ${efRow.input_unit} without fuel binding`,
          },
        };
      }
    }

    // 4. Compute new co2e.
    const newCo2eKg = newAmount * efRow.co2e_kg_per_unit;
    const old_co2e_kg = current.computed_co2e_kg;
    const old_amount = current.amount;
    const old_unit = current.unit;
    const old_ef_pk: EfCompositePk = {
      factor_code: current.ef_factor_code,
      year: current.ef_year,
      source: current.ef_source,
      geography: current.ef_geography,
      dataset_version: current.ef_dataset_version,
    };

    // 5. Transaction: pin (idempotent via INSERT OR IGNORE inside EfService.pin)
    //    + UPDATE activity_data + INSERT audit_event.
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.efService.pin(input.new_ef_pk);
      this.db
        .prepare(
          `UPDATE activity_data
              SET ef_factor_code = ?, ef_year = ?, ef_source = ?, ef_geography = ?, ef_dataset_version = ?,
                  amount = ?, unit = ?,
                  computed_co2e_kg = ?, computed_at = ?,
                  updated_at = ?
            WHERE id = ?`,
        )
        .run(
          input.new_ef_pk.factor_code,
          input.new_ef_pk.year,
          input.new_ef_pk.source,
          input.new_ef_pk.geography,
          input.new_ef_pk.dataset_version,
          newAmount,
          efRow.input_unit,
          newCo2eKg,
          now,
          now,
          input.activity_id,
        );
      const auditId = ulid();
      this.db
        .prepare(
          `INSERT INTO audit_event (id, event_kind, payload, occurred_at)
           VALUES (?, ?, ?, ?)`,
        )
        .run(
          auditId,
          'activity_rebind_ef',
          JSON.stringify({
            activity_id: input.activity_id,
            old_ef: old_ef_pk,
            new_ef: input.new_ef_pk,
            old_amount,
            old_unit,
            old_computed_co2e_kg: old_co2e_kg,
            new_amount: newAmount,
            new_unit: efRow.input_unit,
            new_computed_co2e_kg: newCo2eKg,
          }),
          now,
        );
    })();

    const updated = this.db
      .prepare(`${AD_SELECT} WHERE id = ?`)
      .get(input.activity_id) as ActivityData;

    return {
      ok: true,
      updated,
      old_co2e_kg,
      new_co2e_kg: newCo2eKg,
      old_amount,
      old_unit,
      new_amount: newAmount,
      new_unit: efRow.input_unit,
    };
  }

  /** Read activity with the currently-pinned EF joined in. Null if not found. */
  getByIdWithEf(id: string): ActivityDataWithEf | null {
    const ad = this.db
      .prepare(`${AD_SELECT} WHERE id = ?`)
      .get(id) as ActivityData | undefined;
    if (!ad) return null;
    const pinned = this.db
      .prepare(
        `SELECT * FROM pinned_emission_factor
          WHERE factor_code = ? AND year = ? AND source = ? AND geography = ? AND dataset_version = ?`,
      )
      .get(
        ad.ef_factor_code,
        ad.ef_year,
        ad.ef_source,
        ad.ef_geography,
        ad.ef_dataset_version,
      ) as PinnedEmissionFactor | undefined;
    if (!pinned) return null;
    return { ...ad, pinned_ef: pinned };
  }
```

Imports needed at the top of `activity-data-service.ts` (if not already present):

```ts
import { ulid } from 'ulid';
import type {
  ActivityData,
  ActivityDataWithEf,
  EfCompositePk,
  PinnedEmissionFactor,
} from '@shared/types.js';
```

If `ulid` isn't already imported in this file but is used elsewhere (e.g. extraction-service.ts), confirm the package is available (`grep "from 'ulid'" src/main/`).

- [ ] **Step 5: Verify**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck 2>&1 | tail -10
pnpm vitest run tests/main/services/activity-data-service.test.ts --pool=threads 2>&1 | tail -15
pnpm vitest run --pool=threads 2>&1 | tail -8
```

Expected: typecheck clean; 7 new tests pass (5 rebindEf + 2 getByIdWithEf); ~589 total.

If the L→kg test (Step 2's second test) fails because `unit-conversion-service.convert()` actually DOES allow L→kg via the default conversion table, adapt the test to either:
- Use a different cross-family target that's definitely rejected (e.g. m³ → m for a mass EF)
- Accept the conversion and assert `result.ok === true` + assert the converted amount

Adapt to the actual unit-conversion-service behavior — the test exists to verify the typed-error path, not a specific pairing.

- [ ] **Step 6: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git status
git add -A && git restore --staged .claude || true
git commit -m "feat(activity): rebindEf + getByIdWithEf — pin + UPDATE + audit_event"
git log --oneline -3
git branch --show-current
```

---

## Task 3: IPC channels + handler tests

**Files:**
- Modify: `src/main/ipc/types.ts`
- Modify: `src/main/ipc/handlers/activity-data.ts`
- Modify: `src/preload/bridge.ts`
- Modify: `tests/preload/bridge.test.ts`
- Create or modify: `tests/main/ipc/activity-data-handlers.test.ts` (if no such file exists, create it; otherwise extend)
- Modify: `src/renderer/lib/api/activity-data.ts` (or wherever the existing renderer activity-data client lives — confirm at implementation time with `grep -rn "activity:" src/renderer/lib/api/`)

- [ ] **Step 1: Extend IpcTypeMap**

In `src/main/ipc/types.ts`, find the `activity-data domain` section. Add:

```ts
  'activity:get-by-id': (input: { id: string }) =>
    import('@shared/types.js').ActivityDataWithEf | null;
  'activity:rebind-ef': (input: {
    activity_id: string;
    new_ef_pk: import('@shared/types.js').EfCompositePk;
  }) => Promise<
    | {
        ok: true;
        updated: import('@shared/types.js').ActivityData;
        old_co2e_kg: number;
        new_co2e_kg: number;
        old_amount: number;
        old_unit: string;
        new_amount: number;
        new_unit: string;
      }
    | { ok: false; error: { _tag: 'NotFound' | 'EfNotFound' | 'UnitMismatch'; message: string } }
  >;
```

(If the types file already imports `ActivityData`, `ActivityDataWithEf`, `EfCompositePk` at top-level, use them directly without `import('...')`.)

- [ ] **Step 2: Write the failing handler tests**

Create `tests/main/ipc/activity-data-handlers.test.ts` (or extend if it exists):

```ts
import { activityDataHandlers } from '@main/ipc/handlers/activity-data';
import type { IpcContext } from '@main/ipc/context';
import { describe, expect, it, vi } from 'vitest';

function makeCtx() {
  return {
    activityDataService: {
      create: vi.fn(),
      listByPeriod: vi.fn(),
      totalsByPeriod: vi.fn(),
      getByIdWithEf: vi.fn().mockReturnValue({
        id: 'act-1',
        ef_factor_code: 'diesel_L',
        pinned_ef: { factor_code: 'diesel_L' },
      }),
      rebindEf: vi.fn().mockReturnValue({
        ok: true,
        updated: { id: 'act-1' },
        old_co2e_kg: 2680,
        new_co2e_kg: 2540,
        old_amount: 1000,
        old_unit: 'L',
        new_amount: 800,
        new_unit: 'kg',
      }),
    },
  } as unknown as IpcContext;
}

describe('activity-data handlers — rebind/getById', () => {
  it('activity:get-by-id returns the joined row', async () => {
    const ctx = makeCtx();
    const handlers = activityDataHandlers(ctx);
    const result = await handlers['activity:get-by-id']!({ id: 'act-1' });
    expect(result).not.toBeNull();
    expect((result as { id: string }).id).toBe('act-1');
    expect(ctx.activityDataService.getByIdWithEf).toHaveBeenCalledWith('act-1');
  });

  it('activity:rebind-ef passes through to service.rebindEf', async () => {
    const ctx = makeCtx();
    const handlers = activityDataHandlers(ctx);
    const result = await handlers['activity:rebind-ef']!({
      activity_id: 'act-1',
      new_ef_pk: { factor_code: 'diesel_kg', year: 2025, source: 'IPCC', geography: 'CN', dataset_version: '2025.1' },
    });
    expect((result as { ok: boolean }).ok).toBe(true);
    expect(ctx.activityDataService.rebindEf).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run, confirm fail**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/main/ipc/activity-data-handlers.test.ts --pool=threads 2>&1 | tail -15
```

Expected: FAIL — handlers don't exist.

- [ ] **Step 4: Implement the handlers**

Open `src/main/ipc/handlers/activity-data.ts`. Replace the file contents with:

```ts
import { activityDataCreateInput } from '@shared/types.js';
import { z } from 'zod';
import type { IpcContext } from '../context.js';
import type { IpcTypeMap } from '../types.js';

const periodScopedInput = z.object({ reporting_period_id: z.string().min(1) });
const idInput = z.object({ id: z.string().min(1) });
const rebindInput = z.object({
  activity_id: z.string().min(1),
  new_ef_pk: z.object({
    factor_code: z.string().min(1),
    year: z.number().int(),
    source: z.string().min(1),
    geography: z.string().min(1),
    dataset_version: z.string().min(1),
  }),
});

/**
 * Activity-data handlers. `activity:create` triggers the keystone single-tx
 * pin+compute+insert flow inside `ActivityDataService.create`; this layer is
 * a thin pass-through that just validates the input shape.
 *
 * `activity:rebind-ef` (Phase 3 sub-project 2) swaps the pinned EF on an
 * existing activity row; the service handles the transaction and audit_event.
 * The handler never throws — typed errors come back as `{ ok: false, error }`.
 */
export function activityDataHandlers(ctx: IpcContext): {
  [K in keyof IpcTypeMap]?: IpcTypeMap[K];
} {
  const svc = ctx.activityDataService;
  return {
    'activity:create': (input) => svc.create(activityDataCreateInput.parse(input)),
    'activity:list-by-period': (input) =>
      svc.listByPeriod(periodScopedInput.parse(input).reporting_period_id),
    'activity:totals-by-period': (input) =>
      svc.totalsByPeriod(periodScopedInput.parse(input).reporting_period_id),
    'activity:get-by-id': (input) => svc.getByIdWithEf(idInput.parse(input).id),
    'activity:rebind-ef': (input) => svc.rebindEf(rebindInput.parse(input)),
  };
}
```

- [ ] **Step 5: Allowlist + bridge test**

Edit `src/preload/bridge.ts`. In `allowedChannels`, find the activity-data domain section. Add:

```ts
  'activity:get-by-id',
  'activity:rebind-ef',
```

Edit `tests/preload/bridge.test.ts`. Extend the `allowedChannels` assertion's activity-data section with the new channels.

- [ ] **Step 6: Renderer API client**

Find the existing renderer activity-data API client (likely `src/renderer/lib/api/activity-data.ts`; confirm via `grep -rn "activity:create" src/renderer/lib/api/`).

Add:

```ts
  getById: (input: { id: string }) => invoke('activity:get-by-id', input),
  rebindEf: (input: {
    activity_id: string;
    new_ef_pk: { factor_code: string; year: number; source: string; geography: string; dataset_version: string };
  }) => invoke('activity:rebind-ef', input),
```

- [ ] **Step 7: Verify**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck 2>&1 | tail -10
pnpm vitest run tests/main/ipc/activity-data-handlers.test.ts --pool=threads 2>&1 | tail -10
pnpm vitest run tests/preload/bridge.test.ts --pool=threads 2>&1 | tail -10
pnpm vitest run --pool=threads 2>&1 | tail -8
```

Expected: typecheck clean; 2/2 new handler tests pass; bridge test passes; ~591 total.

- [ ] **Step 8: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git status
git add -A && git restore --staged .claude || true
git commit -m "feat(ipc): activity:get-by-id + activity:rebind-ef channels"
git log --oneline -3
git branch --show-current
```

---

## Task 4: `<RebindEfDrawer>` component + tests

**Files:**
- Create: `src/renderer/components/RebindEfDrawer.tsx`
- Create: `tests/renderer/rebind-drawer.test.tsx`
- Modify: `messages/en.json`, `messages/zh-CN.json` (add 8 i18n keys)

The drawer reads the activity via `activity:get-by-id`, lets the user pick a new EF, computes the client-side delta preview, and submits via `activity:rebind-ef`.

- [ ] **Step 1: Add i18n keys**

Add to `messages/en.json` + `messages/zh-CN.json`:

```
rebind_button                "Rebind"                                    /  "重新镶嵌"
rebind_drawer_heading        "Rebind emission factor"                    /  "重新镶嵌排放因子"
rebind_current_label         "Current"                                   /  "当前"
rebind_current_co2e          "Current emissions"                         /  "当前排放"
rebind_preview_heading       "Preview"                                   /  "预览"
rebind_unit_conversion       "Unit conversion: {from_amt} {from_unit} → {to_amt} {to_unit}"  /  "单位换算: {from_amt} {from_unit} → {to_amt} {to_unit}"
rebind_unit_cross_family     "Cannot convert {from} → {to} without fuel binding. Delete and re-create the activity."  /  "无法跨单位族自动换算 ({from} → {to})：请删除并重建该活动。"
rebind_new_co2e              "New emissions"                             /  "新排放"
rebind_delta                 "Change: {delta_signed} kg ({pct_signed}%)" /  "变化: {delta_signed} kg ({pct_signed}%)"
rebind_confirm               "Confirm rebind"                            /  "确认重新镶嵌"
rebind_cancel                "Cancel"                                    /  "取消"
rebind_success_toast         "Rebound — new emissions {co2e} kg CO2e ({pct_signed}%)" /  "已重新镶嵌 — 新排放 {co2e} kg CO2e ({pct_signed}%)"
rebind_error_toast           "Rebind failed: {message}"                  /  "重新镶嵌失败: {message}"
```

Recompile paraglide:

```bash
cd /Users/lxz/ws/personal/carbonbook
npx paraglide-js compile --project ./project.inlang --outdir ./src/renderer/paraglide
```

- [ ] **Step 2: Write the failing tests**

Create `tests/renderer/rebind-drawer.test.tsx`:

```tsx
import { RebindEfDrawer } from '@renderer/components/RebindEfDrawer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const fakeActivity = {
  id: 'act-1',
  amount: 1000,
  unit: 'L',
  computed_co2e_kg: 2680,
  ef_factor_code: 'diesel_L',
  ef_year: 2024,
  ef_source: 'MEE',
  ef_geography: 'CN',
  ef_dataset_version: '2024.1',
  pinned_ef: {
    factor_code: 'diesel_L',
    year: 2024,
    source: 'MEE',
    geography: 'CN',
    dataset_version: '2024.1',
    input_unit: 'L',
    co2e_kg_per_unit: 2.68,
    name_zh: '柴油',
    name_en: 'Diesel',
  },
};

vi.mock('@renderer/lib/api/activity-data', () => ({
  activityApi: {
    getById: vi.fn().mockResolvedValue(fakeActivity),
    rebindEf: vi.fn(),
  },
}));
vi.mock('@renderer/lib/api/ef-library', () => ({
  efApi: {
    list: vi.fn().mockResolvedValue([
      {
        factor_code: 'grid_kWh',
        year: 2025,
        source: 'MEE',
        geography: 'CN',
        dataset_version: '2025.1',
        scope: 2,
        category: 'electricity',
        input_unit: 'kWh',
        co2e_kg_per_unit: 0.57,
        gwp_basis: 'AR5',
        name_zh: '电网',
        name_en: 'Grid',
        description_zh: null,
        description_en: null,
        ghg_protocol_path: null,
        notes: null,
        citation_url: null,
        ch4_kg_per_unit: null,
        n2o_kg_per_unit: null,
        hfc_kg_per_unit: null,
        pfc_kg_per_unit: null,
        sf6_kg_per_unit: null,
        nf3_kg_per_unit: null,
        biogenic_co2_factor: null,
      },
    ]),
  },
}));
vi.mock('@renderer/lib/api/ef-matcher', () => ({
  efMatcherApi: { recommend: vi.fn() },
}));

describe('<RebindEfDrawer>', () => {
  it('renders current EF + activity info', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <RebindEfDrawer activityId="act-1" open={true} onClose={vi.fn()} />
      </QueryClientProvider>,
    );
    await waitFor(() => {
      expect(screen.getByText(/diesel_L/i)).toBeTruthy();
      expect(screen.getByText(/2,?680/)).toBeTruthy();
    });
  });

  it('disables confirm with cross-family message when picker selects an EF whose unit is cross-family', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <RebindEfDrawer activityId="act-1" open={true} onClose={vi.fn()} />
      </QueryClientProvider>,
    );
    // Wait for current EF to load + Browse list to populate.
    await waitFor(() => expect(screen.getByText(/Grid|电网/)).toBeTruthy());
    // Click the kWh EF row (cross-family from L).
    const row = screen.getByText(/Grid|电网/);
    row.click();
    // Expect the cross-family message to appear and the confirm button to be disabled.
    await waitFor(() => {
      expect(screen.getByText(/cross|跨单位|fuel binding/i)).toBeTruthy();
    });
    const confirmBtn = screen.getByRole('button', { name: /confirm|确认/i });
    expect((confirmBtn as HTMLButtonElement).disabled).toBe(true);
  });
});
```

- [ ] **Step 3: Run, confirm fail**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/renderer/rebind-drawer.test.tsx --pool=threads 2>&1 | tail -15
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement `<RebindEfDrawer>`**

Create `src/renderer/components/RebindEfDrawer.tsx`:

```tsx
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { activityApi } from '@renderer/lib/api/activity-data';
import { EfPicker } from './EfPicker';
import { toast } from './toast';
import type { EfCompositePk } from '@shared/types';
import * as m from '@renderer/paraglide/messages';

export interface RebindEfDrawerProps {
  activityId: string;
  open: boolean;
  onClose: () => void;
}

const VOLUME = new Set(['L', 'mL', 'm3']);
const MASS = new Set(['kg', 't', 'g']);
const ENERGY = new Set(['kWh', 'MJ', 'GJ']);

function unitFamily(unit: string): 'volume' | 'mass' | 'energy' | null {
  if (VOLUME.has(unit)) return 'volume';
  if (MASS.has(unit)) return 'mass';
  if (ENERGY.has(unit)) return 'energy';
  return null;
}

function sameFamily(a: string, b: string): boolean {
  if (a === b) return true;
  const fa = unitFamily(a);
  const fb = unitFamily(b);
  if (!fa || !fb) return false;
  return fa === fb;
}

export function RebindEfDrawer({ activityId, open, onClose }: RebindEfDrawerProps) {
  const queryClient = useQueryClient();
  const activityQuery = useQuery({
    queryKey: ['activity:get-by-id', activityId],
    queryFn: () => activityApi.getById({ id: activityId }),
    enabled: open,
  });
  const [selectedEfPk, setSelectedEfPk] = useState<EfCompositePk | null>(null);
  // Hold the picked EF's full row so we can compute a preview without a roundtrip.
  // Browse pane is the source — we'll read selection by matching PK against the
  // current `ef:list` cache.
  const [pickedEfMeta, setPickedEfMeta] = useState<{ input_unit: string; co2e_kg_per_unit: number } | null>(
    null,
  );

  const preview = useMemo(() => {
    if (!activityQuery.data || !selectedEfPk || !pickedEfMeta) return null;
    const ad = activityQuery.data;
    const sameUnit = ad.unit === pickedEfMeta.input_unit;
    const crossFamily = !sameUnit && !sameFamily(ad.unit, pickedEfMeta.input_unit);
    if (crossFamily) {
      return { crossFamily: true as const, fromUnit: ad.unit, toUnit: pickedEfMeta.input_unit };
    }
    // Client-side optimistic preview. Server is authoritative; we just need a
    // plausible number for the UI. For same-family with conversion the server
    // applies the canonical conversion; here we approximate by trusting the
    // unit-family equivalence as-is (1:1 only when units match exactly).
    const newAmount = sameUnit ? ad.amount : null;
    const newCo2e = newAmount === null ? null : newAmount * pickedEfMeta.co2e_kg_per_unit;
    return {
      crossFamily: false as const,
      newAmount,
      newUnit: pickedEfMeta.input_unit,
      newCo2eKg: newCo2e,
      oldCo2eKg: ad.computed_co2e_kg,
    };
  }, [activityQuery.data, selectedEfPk, pickedEfMeta]);

  const rebindMutation = useMutation({
    mutationFn: () => activityApi.rebindEf({ activity_id: activityId, new_ef_pk: selectedEfPk! }),
    onSuccess: (result) => {
      if (!result.ok) {
        toast.error(m.rebind_error_toast({ message: result.error.message }));
        return;
      }
      const pct = result.old_co2e_kg === 0 ? 0 : ((result.new_co2e_kg - result.old_co2e_kg) / result.old_co2e_kg) * 100;
      toast.success(m.rebind_success_toast({
        co2e: result.new_co2e_kg.toFixed(0),
        pct_signed: (pct >= 0 ? '+' : '') + pct.toFixed(1),
      }));
      queryClient.invalidateQueries({ queryKey: ['activity:list-by-period'] });
      queryClient.invalidateQueries({ queryKey: ['activity:totals-by-period'] });
      onClose();
    },
    onError: (e) => toast.error(m.rebind_error_toast({ message: (e as Error).message })),
  });

  if (!open) return null;

  return (
    <div className="rebind-drawer" role="dialog" aria-modal="true">
      <header>
        <h2>{m.rebind_drawer_heading()}</h2>
      </header>

      {activityQuery.isPending && <p>Loading…</p>}
      {activityQuery.data && (
        <>
          <section className="rebind-drawer__current">
            <div>{m.rebind_current_label()}: {activityQuery.data.amount} {activityQuery.data.unit}</div>
            <div>{activityQuery.data.pinned_ef.factor_code} @ {activityQuery.data.pinned_ef.source} {activityQuery.data.pinned_ef.year}</div>
            <div>{m.rebind_current_co2e()}: {activityQuery.data.computed_co2e_kg.toFixed(0)} kg CO2e</div>
          </section>

          <EfPicker
            selectedSourceId={activityQuery.data.emission_source_id}
            currentEfPk={{
              factor_code: activityQuery.data.ef_factor_code,
              year: activityQuery.data.ef_year,
              source: activityQuery.data.ef_source,
              geography: activityQuery.data.ef_geography,
              dataset_version: activityQuery.data.ef_dataset_version,
            }}
            onChange={(pk) => {
              setSelectedEfPk(pk);
              // EfPicker doesn't currently expose the row metadata via onChange.
              // For the preview we read from queryClient's cache for ef:list,
              // OR extend EfPicker's onChange to also pass the row. Simpler:
              // extend the signature in this codebase to (pk, meta).
              // For this v1, the picker passes back the row via a side channel.
              setPickedEfMeta(null); // placeholder — see implementation note below
            }}
          />

          {preview && preview.crossFamily && (
            <div className="rebind-drawer__cross-family" role="alert">
              {m.rebind_unit_cross_family({ from: preview.fromUnit, to: preview.toUnit })}
            </div>
          )}

          {preview && !preview.crossFamily && preview.newCo2eKg != null && (
            <section className="rebind-drawer__preview">
              <h3>{m.rebind_preview_heading()}</h3>
              {preview.newAmount != null && preview.newAmount !== activityQuery.data.amount && (
                <div>
                  {m.rebind_unit_conversion({
                    from_amt: activityQuery.data.amount.toString(),
                    from_unit: activityQuery.data.unit,
                    to_amt: preview.newAmount.toFixed(2),
                    to_unit: preview.newUnit,
                  })}
                </div>
              )}
              <div>{m.rebind_new_co2e()}: {preview.newCo2eKg.toFixed(0)} kg CO2e</div>
              <div>{m.rebind_delta({
                delta_signed: ((preview.newCo2eKg - preview.oldCo2eKg) >= 0 ? '+' : '') + (preview.newCo2eKg - preview.oldCo2eKg).toFixed(0),
                pct_signed: ((preview.oldCo2eKg === 0 ? 0 : (preview.newCo2eKg - preview.oldCo2eKg) / preview.oldCo2eKg * 100) >= 0 ? '+' : '') +
                  ((preview.oldCo2eKg === 0 ? 0 : (preview.newCo2eKg - preview.oldCo2eKg) / preview.oldCo2eKg * 100)).toFixed(1),
              })}</div>
            </section>
          )}

          <footer>
            <button type="button" onClick={onClose}>{m.rebind_cancel()}</button>
            <button
              type="button"
              disabled={
                !selectedEfPk ||
                rebindMutation.isPending ||
                (preview?.crossFamily ?? false)
              }
              onClick={() => rebindMutation.mutate()}
            >
              {m.rebind_confirm()}
            </button>
          </footer>
        </>
      )}
    </div>
  );
}
```

**Implementation note about `pickedEfMeta`:** the cleanest path is to extend `<EfPicker>`'s `onChange` signature in Task 1 to pass `(pk, row)` so the drawer can compute previews. For this task, you have two options:

- (a) **Extend EfPicker's onChange to `(pk, row) => void`** — requires re-editing Task 1's EfPicker.tsx. Update the call site in ActivityForm to use the new signature too (it likely just discards `row`).
- (b) **Re-query the EF from the queryClient cache** for `ef:list` inside the drawer's onChange — uglier but contained.

Pick (a). When you implement the drawer, also update `EfPicker.tsx` to pass `(pk, row)` and update `ActivityForm.tsx`'s callback signature.

- [ ] **Step 5: Verify**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck 2>&1 | tail -10
pnpm vitest run tests/renderer/rebind-drawer.test.tsx --pool=threads 2>&1 | tail -15
pnpm vitest run --pool=threads 2>&1 | tail -8
```

Expected: typecheck clean; 2/2 drawer tests pass; ~593 total.

- [ ] **Step 6: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git status
git add -A && git restore --staged .claude || true
git commit -m "feat(ui): RebindEfDrawer — preview + delta + cross-family rejection"
git log --oneline -3
git branch --show-current
```

---

## Task 5: Activities list integration

**Files:**
- Modify: `src/renderer/routes/activities.tsx`

Add a "重新镶嵌" button per row + drawer mount.

- [ ] **Step 1: Read the current activities.tsx**

```bash
cd /Users/lxz/ws/personal/carbonbook
cat src/renderer/routes/activities.tsx
```

Identify where the table rows are rendered and where to inject the button. The route already uses TanStack Query's `activity:list-by-period` — perfect.

- [ ] **Step 2: Add button + drawer state**

Modify `src/renderer/routes/activities.tsx`:

```tsx
import { useState } from 'react';
import { RebindEfDrawer } from '@renderer/components/RebindEfDrawer';
import * as m from '@renderer/paraglide/messages';

// Inside the component, near other useState hooks:
const [rebindActivityId, setRebindActivityId] = useState<string | null>(null);

// Inside the table row JSX (per row):
<button
  type="button"
  onClick={() => setRebindActivityId(row.id)}
  className="text-sm underline"
>
  {m.rebind_button()}
</button>

// At the bottom of the component's return, before the closing tag:
{rebindActivityId && (
  <RebindEfDrawer
    activityId={rebindActivityId}
    open={true}
    onClose={() => setRebindActivityId(null)}
  />
)}
```

Adapt to whatever the existing table layout looks like. If the existing layout has trailing utility buttons (delete, edit), insert the Rebind button alongside.

- [ ] **Step 3: Verify**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck 2>&1 | tail -10
pnpm vitest run --pool=threads 2>&1 | tail -8
```

Expected: typecheck clean; ~593 total (no new test for this glue task — covered by existing activities-page tests + the drawer test from Task 4).

- [ ] **Step 4: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git status
git add -A && git restore --staged .claude || true
git commit -m "feat(ui): Activities list — Rebind button per row + drawer mount"
git log --oneline -3
git branch --show-current
```

---

## Task 6: Sweep + verification

- [ ] **Step 1: Full suite + typecheck**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run --pool=threads 2>&1 | tail -8
pnpm typecheck
```

Expected: ~590-593 tests passing, typecheck clean.

If 184+ failures with `NODE_MODULE_VERSION 145`:
```bash
rm node_modules/.pnpm/better-sqlite3@12.9.0/node_modules/better-sqlite3/build/Release/better_sqlite3.node
pnpm rebuild better-sqlite3
pnpm vitest run --pool=threads 2>&1 | tail -8
```

- [ ] **Step 2: format + biome (autofix the touched files; pre-existing errors remain)**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm format 2>&1 | tail -3
pnpm exec biome check --write 2>&1 | tail -10
```

The 4 pre-existing biome errors (`answer-generation/errors.ts`, `routing/errors.ts`, `excel/parser.ts`, `activity-data-service.ts noNonNullAssertion`) will NOT be fixed by this sweep — they predate this sub-project. Leave them. Only fix new issues your sub-project introduced.

- [ ] **Step 3: Final commit + history**

```bash
cd /Users/lxz/ws/personal/carbonbook
git status
git add -A && git restore --staged .claude || true
git commit -m "chore: biome sweep for EF rebind UI" || true
git log --oneline -10
git branch --show-current
```

---

## Closeout

Phase 3 sub-project 2 lands on `main`:

- `<EfPicker>` extracted from ActivityForm — reusable.
- `ActivityDataService.rebindEf` (transactional UPDATE + audit_event) + `getByIdWithEf`.
- IPC: `activity:get-by-id`, `activity:rebind-ef`.
- `<RebindEfDrawer>` — current EF display, EF picker, delta preview, cross-family rejection.
- Activities list — "重新镶嵌" button per row.
- ~12 new i18n keys.
- ~10 new tests (580 → ~590-593).

**Manual smoke deferred** to consolidated phase-3 tag-time verification:

- Rebind an activity that was created via the EF Matcher; visually confirm the audit_event row in the DB.
- Test the same-family unit conversion flow end-to-end against a real EF library entry.
- Verify cross-family rejection UI in actual user flow.

**Next sub-projects (Phase 3 remaining):**

- Sub-project 3: PDF rearrange export (questionnaire-side PDF companion to the answer Excel export).
- Sub-project 4: audit_event UI (first viewer for the rebind audit log; surfaces the rows from sub-project 2).
