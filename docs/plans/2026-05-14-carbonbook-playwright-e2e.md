# Playwright E2E Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the manual `phase-1d` GUI smoke with an automated Playwright suite (5 stage Confirm flows, mocked LLM, mocked extraction). Once landed, `pnpm test:e2e` replaces the human-driven walkthrough.

**Architecture:** Playwright Test (`@playwright/test`) drives the production-built Electron app via `_electron.launch`. `electron-playwright-helpers` overrides the `extraction:run` and `ef:recommend` IPC handlers per-test with canned data. Fixture: one PDF (`tests/fixtures/two-page-text.pdf`), reused. Isolation: per-test temp `userData` via env var.

**Tech Stack:** Playwright 1.x, `electron-playwright-helpers` 1.x, Electron 41 (existing). One main-process hook (~5 LOC).

**Reference spec:** `docs/specs/2026-05-14-playwright-e2e-design.md`

**Baseline:** `commit a002e3c` on `main`. 418 vitest tests passing.

**Discipline notes:**

- Tests live under `tests/e2e/`. Vitest is configured to skip this directory (verify in T1; add an exclude pattern if needed).
- Every E2E spec uses the harness in `tests/e2e/_setup.ts`. NO direct `_electron.launch` calls in spec files.
- `pnpm build` is a prerequisite of `pnpm test:e2e` — the script enforces this.
- After `pnpm test:e2e`, better-sqlite3 is built against Electron's Node ABI. To run vitest after, recover with `pnpm rebuild better-sqlite3`. This is documented; don't try to make the suites composable in one shell.
- Maintain `pnpm typecheck` clean after every task.
- After every commit verify `git branch --show-current` returns `main`; recover via `git checkout -B main` if empty.

---

## Task 1: Install Playwright + helpers, scaffold config

**Files:**
- Modify: `package.json` (devDeps + scripts)
- Create: `playwright.config.ts`
- Modify: `vitest.config.ts` (exclude `tests/e2e/`)
- Modify: `.gitignore` (add `test-results/` + `playwright-report/`)

- [ ] **Step 1: Install deps**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm add -D @playwright/test electron-playwright-helpers
```

Verify both appear in `package.json` devDependencies. Also run `pnpm playwright install chromium --with-deps` so a Chromium browser is available locally (Playwright tests against Electron, but its tooling needs a browser binary cached).

- [ ] **Step 2: Add scripts to `package.json`**

In the `"scripts"` block, add (alphabetically positioned after `test`):
```json
"test:e2e": "pnpm build && playwright test",
"test:e2e:headed": "pnpm build && playwright test --headed",
```

- [ ] **Step 3: Create `playwright.config.ts`**

At repo root:

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  retries: 1,
  workers: 1, // Electron launches are expensive; serial is fine.
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  reporter: process.env.CI ? 'github' : 'list',
});
```

- [ ] **Step 4: Exclude `tests/e2e/` from Vitest**

Find `vitest.config.ts` (likely at repo root). Add `tests/e2e/**` to the `exclude` pattern. Default Vitest excludes `node_modules` + `dist`; we don't want it accidentally picking up Playwright specs.

Pattern (verify against actual config shape):
```ts
test: {
  exclude: ['**/node_modules/**', '**/dist/**', 'tests/e2e/**'],
}
```

- [ ] **Step 5: Update `.gitignore`**

Add at the end:
```
# Playwright artifacts
test-results/
playwright-report/
```

- [ ] **Step 6: Smoke the install**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm playwright --version
```
Expected: prints the installed Playwright version. If it fails, the install didn't take.

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run --pool=threads 2>&1 | tail -5
```
Expected: 418 tests still passing (the install didn't break anything).

- [ ] **Step 7: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git status
git add package.json pnpm-lock.yaml playwright.config.ts vitest.config.ts .gitignore
git commit -m "chore(test): scaffold Playwright + electron-playwright-helpers"
git branch --show-current
```

---

## Task 2: Main-process test-userData-dir hook

**Files:**
- Modify: `src/main/index.ts` (add env-var override before `app.whenReady`)
- Create: `tests/main/index-test-hook.test.ts` (small unit test verifying the hook compiles)

- [ ] **Step 1: Write the failing test**

Create `tests/main/index-test-hook.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('main entry — CARBONBOOK_TEST_USER_DATA_DIR hook', () => {
  it('src/main/index.ts honors the test env var before reading userData', () => {
    const src = readFileSync(join(__dirname, '../../src/main/index.ts'), 'utf-8');
    // The hook must appear BEFORE the dbPath assignment.
    const hookIdx = src.indexOf('CARBONBOOK_TEST_USER_DATA_DIR');
    const dbPathIdx = src.indexOf("getPath('userData')");
    expect(hookIdx).toBeGreaterThan(-1);
    expect(dbPathIdx).toBeGreaterThan(-1);
    expect(hookIdx).toBeLessThan(dbPathIdx);
  });
});
```

This is a source-text test — cheap, deterministic, doesn't require running Electron. It enforces that future refactors don't accidentally move the override below the consumer.

- [ ] **Step 2: Run to confirm fail**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/main/index-test-hook.test.ts --pool=threads
```
Expected: FAIL (hook not yet present).

- [ ] **Step 3: Implement the hook**

Edit `src/main/index.ts`. The file currently is:

```ts
import { join } from 'node:path';
import { openAppDb } from '@main/db/connection.js';
import { runMigrations } from '@main/db/migrate.js';
import { cleanupIpc, setupIpc } from '@main/ipc/setup.js';
import { app, BrowserWindow } from 'electron';
import { createMainWindow } from './window.js';

app.whenReady().then(() => {
  const dbPath = join(app.getPath('userData'), 'app.sqlite');
  // ... rest unchanged
});
```

Insert the hook IMMEDIATELY AFTER the imports, BEFORE `app.whenReady`:

```ts
// E2E test hook: honor a per-test temp userData dir if the env var is set.
// MUST run before any service reads `app.getPath('userData')`. The hook
// runs at module-load time so it precedes `app.whenReady` (which itself
// fires before the renderer mounts).
if (process.env.CARBONBOOK_TEST_USER_DATA_DIR) {
  app.setPath('userData', process.env.CARBONBOOK_TEST_USER_DATA_DIR);
}
```

- [ ] **Step 4: Run test to confirm pass**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/main/index-test-hook.test.ts --pool=threads
```
Expected: PASS.

- [ ] **Step 5: Full suite + typecheck**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck
pnpm vitest run --pool=threads 2>&1 | tail -5
```
Expected: typecheck clean. 419 tests passing (418 + 1 new).

- [ ] **Step 6: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add src/main/index.ts tests/main/index-test-hook.test.ts
git commit -m "feat(main): honor CARBONBOOK_TEST_USER_DATA_DIR for E2E isolation"
git branch --show-current
```

---

## Task 3: Test harness (`tests/e2e/_setup.ts`)

**Files:**
- Create: `tests/e2e/_setup.ts`

The harness is the single source of truth for "how to launch and tear down an Electron app for a test". No spec file should call `_electron.launch` directly.

- [ ] **Step 1: Create the harness**

`tests/e2e/_setup.ts`:

```ts
import { _electron, type ElectronApplication, type Page } from 'playwright';
import { ipcMainHandle } from 'electron-playwright-helpers';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Extraction } from '../../src/shared/types';
import type { MatcherResult } from '../../src/shared/types';

export type StageE2ESetup = {
  app: ElectronApplication;
  window: Page;
  tempUserDataDir: string;
};

export type LaunchOpts = {
  /** Canned `extraction:run` responses, keyed by stage_id (e.g. 'travel.v1'). */
  cannedExtractions: Record<string, Omit<Extraction, 'id' | 'document_id' | 'created_at'>>;
  /** Canned `ef:recommend` response, keyed by stage_id. */
  cannedRecommendations: Record<string, MatcherResult>;
};

const MAIN_ENTRY = join(__dirname, '../../out/main/index.cjs');

export async function launchApp(opts: LaunchOpts): Promise<StageE2ESetup> {
  const tempUserDataDir = mkdtempSync(join(tmpdir(), 'carbonbook-e2e-'));

  const app = await _electron.launch({
    args: [MAIN_ENTRY],
    env: {
      ...process.env,
      CARBONBOOK_TEST_USER_DATA_DIR: tempUserDataDir,
      // Belt-and-suspenders: signal to any future test-only branch in main code.
      CARBONBOOK_E2E: '1',
    },
  });

  // Install IPC handler overrides. These replace the real handlers in the
  // main process, so the renderer's `efMatcherApi.recommend()` / `extractionApi.run()`
  // calls receive our canned data instead of hitting LLM / PDF parser.
  for (const [stageId, extraction] of Object.entries(opts.cannedExtractions)) {
    await ipcMainHandle(app, `extraction:run:${stageId}`, () => ({
      ...extraction,
      id: `ext-${stageId}-mock`,
      created_at: new Date().toISOString(),
      // document_id patched at runtime by the spec (varies per upload).
    }));
  }
  // NOTE: the real `extraction:run` channel takes { document_id, stage_id }
  // and routes by stage_id. Our override needs to inspect the input and
  // dispatch — see implementation note below.
  await ipcMainHandle(app, 'extraction:run', (event, input: { document_id: string; stage_id: string }) => {
    const canned = opts.cannedExtractions[input.stage_id];
    if (!canned) throw new Error(`No canned extraction for stage ${input.stage_id}`);
    return {
      ...canned,
      id: `ext-${input.stage_id}-mock`,
      document_id: input.document_id,
      created_at: new Date().toISOString(),
    };
  });
  await ipcMainHandle(app, 'ef:recommend', (event, input: { extraction_id: string; emission_source_id: string }) => {
    // The extraction_id encodes the stage (we set 'ext-<stage>-mock' above).
    const stageId = input.extraction_id.replace(/^ext-/, '').replace(/-mock$/, '');
    const canned = opts.cannedRecommendations[stageId];
    if (!canned) throw new Error(`No canned recommendation for stage ${stageId} (from ${input.extraction_id})`);
    return canned;
  });

  const window = await app.firstWindow();
  // Wait for the app to be interactive (dashboard or onboarding rendered).
  await window.waitForLoadState('domcontentloaded');

  return { app, window, tempUserDataDir };
}

export async function teardown(setup: StageE2ESetup): Promise<void> {
  try {
    await setup.app.close();
  } catch {
    // Ignore — the app may already be closing.
  }
  try {
    rmSync(setup.tempUserDataDir, { recursive: true, force: true });
  } catch {
    // Ignore — temp dir cleanup is best-effort.
  }
}
```

**Implementation note on `ipcMainHandle`:** check the actual signature in `electron-playwright-helpers`. The library's `ipcMainHandle` typically registers a handler that overrides any existing one. If the API differs (e.g., it's `ipcMainOverride` or you need to call `ipcMainRemoveHandler` first), adjust accordingly. The minimum viable substitute is to use `app.evaluate(({ ipcMain }, args) => { ipcMain.removeHandler(args.channel); ipcMain.handle(args.channel, args.fn); }, { channel, fn })` — but the helper library wraps this cleanly.

- [ ] **Step 2: Smoke-test the harness compiles**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck
```
Expected: clean. If types complain about `electron-playwright-helpers`, check the dep version and adjust the import (some helpers landed under different names across versions).

- [ ] **Step 3: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add tests/e2e/_setup.ts
git commit -m "feat(e2e): test harness (launch + IPC override + teardown)"
git branch --show-current
```

No vitest changes; this file is excluded from the unit-test runner per Task 1.

---

## Task 4: Per-stage canned data

**Files:**
- Create: `tests/e2e/canned.ts`

- [ ] **Step 1: Create canned data**

`tests/e2e/canned.ts`:

```ts
import type { Extraction, MatcherResult, EmissionFactor } from '../../src/shared/types';

// Real EF rows from the seeded catalog (migrations 008 + 011). These are the
// composite PKs the canned recommendations point at; clicking a starred row
// in the renderer must result in a valid EF selection that the form accepts.

const EF_CHINA_UTILITY: EmissionFactor = {
  factor_code: 'electricity.grid.cn.national.2024',
  year: 2024,
  source: 'MEE_China',
  geography: 'CN',
  dataset_version: '2024.q4',
  scope: 2,
  category: 'electricity.grid',
  ghg_protocol_path: 'scope2.location',
  input_unit: 'kWh',
  co2e_kg_per_unit: 0.5703,
  ch4_kg_per_unit: null,
  n2o_kg_per_unit: null,
  hfc_kg_per_unit: null,
  pfc_kg_per_unit: null,
  sf6_kg_per_unit: null,
  nf3_kg_per_unit: null,
  gwp_basis: 'AR6',
  name_zh: '中国国家电网平均',
  name_en: 'China national grid average',
  description_zh: null,
  description_en: null,
  notes: null,
  citation_url: 'https://www.mee.gov.cn/',
};

// ... declare EF_FUEL_DIESEL, EF_FREIGHT_ROAD, EF_PURCHASE_STEEL, EF_TRAVEL_AIR
// each pointing at a real seeded row. Use the same column shape as above.
// Reference: src/main/db/migrations/008_seed_emission_factors.sql and
//            src/main/db/migrations/011_seed_emission_factors_v2.sql

export const CANNED: Record<string, { extraction: Omit<Extraction, 'id' | 'document_id' | 'created_at'>; recommendation: MatcherResult }> = {
  'china_utility.v1': {
    extraction: {
      prompt_version: 'china_utility.v1',
      status: 'review_needed',
      parsed_json: JSON.stringify({
        doc_type: 'china_utility',
        supplier_name: '国家电网北京',
        account_no: '1000123456',
        amount_kwh: 1234,
        amount_yuan: 678,
        period_start: '2026-04-01',
        period_end: '2026-04-30',
        confidence: 'high',
      }),
      provider: 'openai',
      model: 'gpt-4o-mini',
      input_tokens: 0,
      output_tokens: 0,
      raw_response_url: null,
    } as never, // structural cast; trim/expand to match the real Extraction shape.
    recommendation: {
      recommended: [
        { ef: EF_CHINA_UTILITY, reasoning_zh: '中国电网平均，匹配账单地点。' },
        // ...2 more, can reuse EF_CHINA_UTILITY for v1 simplicity
      ],
      ranked_full: [EF_CHINA_UTILITY],
    },
  },
  // ... 4 more entries for fuel_receipt.v1, freight.v1, purchase.v1, travel.v1
};
```

The implementer authors all 5 entries. Each `parsed_json` must satisfy the stage's zod schema (read `src/main/llm/stages/<stage>.ts` to verify the required keys). The recommended EFs must be real composite PKs from the seeded catalog (read the migration SQL files).

The `Extraction` type may have additional required fields (e.g., `prompt_text_hash`, `image_count`, etc.); check `src/shared/types.ts` and provide sensible canned values (zeros / nulls / hashes of an empty string).

- [ ] **Step 2: Verify typecheck**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck
```
Expected: clean. Adjust the canned objects until the cast to `Extraction` doesn't require `as unknown as Extraction` cheats — if it does, the fix is to add the missing fields rather than weakening the cast.

- [ ] **Step 3: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add tests/e2e/canned.ts
git commit -m "feat(e2e): canned per-stage extraction + recommendation data"
git branch --show-current
```

---

## Task 5: First spec — `china_utility.v1`

**Files:**
- Create: `tests/e2e/china-utility.spec.ts`

This is the highest-risk task because it's the first time the harness composes end-to-end. Land it green BEFORE writing the other 4 specs.

- [ ] **Step 1: Create the spec**

`tests/e2e/china-utility.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { launchApp, teardown, type StageE2ESetup } from './_setup';
import { CANNED } from './canned';
import path from 'node:path';

const FIXTURE_PDF = path.join(__dirname, '../fixtures/two-page-text.pdf');

test.describe('china_utility.v1 Confirm flow', () => {
  let ctx: StageE2ESetup;

  test.beforeEach(async () => {
    ctx = await launchApp({
      cannedExtractions: { 'china_utility.v1': CANNED['china_utility.v1'].extraction },
      cannedRecommendations: { 'china_utility.v1': CANNED['china_utility.v1'].recommendation },
    });
  });
  test.afterEach(async () => teardown(ctx));

  test('seed org → upload PDF → run extraction → pick recommended EF → confirm → dashboard', async () => {
    const { window, app } = ctx;

    // 1. Seed org + reporting period + emission source via real IPC.
    // The renderer's window.api is a contextBridge proxy; we evaluate the IPC
    // calls in the renderer context.
    const orgId = await window.evaluate(async () => {
      // @ts-expect-error window.api typed in preload
      return await window.api.invoke('org:create', { name: 'E2E Test Org' });
    });
    expect(typeof orgId === 'string' || (orgId && (orgId as { id: string }).id)).toBeTruthy();

    // Complete onboarding in one shot (creates org + site + period).
    // Adjust shape to match completeOnboardingInput in shared/types.ts.
    await window.evaluate(async () => {
      // @ts-expect-error
      await window.api.invoke('org:complete-onboarding', {
        // ... shape per completeOnboardingInput
      });
    });

    // Create an emission source the matcher can filter on.
    await window.evaluate(async () => {
      // @ts-expect-error
      await window.api.invoke('source:create', {
        // ... shape per emissionSourceCreateInput, scope=2, category='electricity.grid'
      });
    });

    // 2. Upload the fixture PDF.
    await window.locator('a[href="/documents"]').click().catch(() => { /* may already be there */ });
    await window.locator('input[type=file]').setInputFiles(FIXTURE_PDF);

    // 3. Pick stage + run extraction.
    await window.getByRole('combobox', { name: /stage|阶段/i }).selectOption('china_utility.v1');
    await window.getByRole('button', { name: /run|extract|抽取/i }).click();

    // 4. Wait for review page.
    await expect(window).toHaveURL(/\/documents\/[^/]+/, { timeout: 10_000 });

    // 5. Pick the seeded emission source.
    await window.getByLabel(/emission source|排放源/i).selectOption({ index: 0 });

    // 6. Recommended panel renders.
    await expect(window.getByText('为本单据推荐')).toBeVisible();

    // 7. Click the first starred recommendation.
    await window.locator('input[type=radio]').first().check();

    // 8. Confirm.
    await window.getByRole('button', { name: /confirm|确认/i }).click();

    // 9. Lands on the dashboard (or activities page).
    await expect(window).toHaveURL(/\/$|\/activities/, { timeout: 10_000 });
  });
});
```

The exact onboarding / source-creation IPC shapes need to match `completeOnboardingInput` and `emissionSourceCreateInput` from `src/shared/types.ts`. Read those types before filling in the placeholders.

Selector strategy: prefer `getByRole` + `getByLabel` + `getByText`. Fall back to `locator('input[type=file]')` etc. when role-based selectors don't apply. The Chinese strings come from the paraglide messages; the regex `/foo|中文/i` matches either locale.

- [ ] **Step 2: Run the spec**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm test:e2e tests/e2e/china-utility.spec.ts
```
Expected: PASS (1 test, ~5-10 sec).

Likely failures and fixes:
- **"Could not find element with role 'combobox'"** — your selector is wrong. Use the Playwright trace viewer: `pnpm playwright test --trace on` then inspect the HTML.
- **"Timeout waiting for first window"** — main-process crash. Check the test output for stderr from the Electron process; common cause is the IPC override failing because `electron-playwright-helpers` couldn't find the channel. Verify the channel name matches what the renderer actually calls.
- **"Cannot find module ./_setup"** — TypeScript module resolution. Verify your `tsconfig.json` includes `tests/e2e/**/*.ts` and Playwright's loader picks it up. May need a tsconfig path adjustment.
- **Onboarding wizard blocks**: if seeding via IPC doesn't bypass the onboarding redirect, the test gets stuck on a wizard page. Inspect the renderer's onboarding gate; you may need an extra IPC call (e.g., `org:complete-onboarding`) before the dashboard becomes interactive.

- [ ] **Step 3: Verify vitest still green**

```bash
cd /Users/lxz/ws/personal/carbonbook
# Rebuild for Node ABI first (the build step in test:e2e flipped to Electron).
pnpm rebuild better-sqlite3
pnpm vitest run --pool=threads 2>&1 | tail -5
```
Expected: 419 tests passing. (Adding the spec doesn't add vitest tests; Task 2 added the +1.)

- [ ] **Step 4: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add tests/e2e/china-utility.spec.ts
git commit -m "test(e2e): china_utility.v1 Confirm flow"
git branch --show-current
```

---

## Task 6: `fuel_receipt.v1` spec

**Files:**
- Create: `tests/e2e/fuel-receipt.spec.ts`

Copy `china-utility.spec.ts` and adapt. The only differences are:
- Test describe + filename
- `cannedExtractions` / `cannedRecommendations` keyed on `fuel_receipt.v1`
- Stage option in the dropdown: `'fuel_receipt.v1'`
- The emission source needs `scope=1, category='fuel.mobile'` (so the canned recommendation's diesel EF resolves)

- [ ] **Step 1: Create the spec** — mirror Task 5's spec.

- [ ] **Step 2: Run**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm test:e2e tests/e2e/fuel-receipt.spec.ts
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add tests/e2e/fuel-receipt.spec.ts
git commit -m "test(e2e): fuel_receipt.v1 Confirm flow"
git branch --show-current
```

---

## Task 7: `freight.v1` spec

Same shape as Task 6.

- emission source: `scope=3, category='freight.road'`
- Canned recommendation: freight.road.* from migration 011.

- [ ] **Step 1: Create + run + commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
# Edit tests/e2e/freight.spec.ts
pnpm test:e2e tests/e2e/freight.spec.ts
git add tests/e2e/freight.spec.ts
git commit -m "test(e2e): freight.v1 Confirm flow"
git branch --show-current
```

---

## Task 8: `purchase.v1` spec

- emission source: `scope=3, category='purchase.service.consulting'` (CNY-unit path) OR `category='purchase.material'` (kg-unit path) — pick whichever is more representative; the canned recommendation must match.

- [ ] **Step 1: Create + run + commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm test:e2e tests/e2e/purchase.spec.ts
git add tests/e2e/purchase.spec.ts
git commit -m "test(e2e): purchase.v1 Confirm flow"
git branch --show-current
```

---

## Task 9: `travel.v1` spec

- emission source: `scope=3, category='travel.air'` (thanks to the prefix-match fix, this matches all `travel.air.*` rows)
- Canned recommendation: pick `travel.air.economy.shorthaul`.

- [ ] **Step 1: Create + run + commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm test:e2e tests/e2e/travel.spec.ts
git add tests/e2e/travel.spec.ts
git commit -m "test(e2e): travel.v1 Confirm flow"
git branch --show-current
```

---

## Task 10: Sweep + docs

**Files:**
- Modify: `docs/PHASE-1-SMOKE.md` — replace the "Open follow-up for the GUI smoke" block.
- Modify: `CHANGELOG.md` — add a "Phase 1d closing" subsection.

- [ ] **Step 1: Run the full E2E suite**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm test:e2e
```
Expected: 5 specs / 5 tests passing, ~30-60 sec total.

- [ ] **Step 2: Run the vitest suite (after rebuilding for Node ABI)**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm rebuild better-sqlite3
pnpm vitest run --pool=threads 2>&1 | tail -5
```
Expected: 419 tests passing.

- [ ] **Step 3: Lint + format**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm format
pnpm lint --max-diagnostics=80 2>&1 | tail -5
```
Expected: 0 errors. Pre-existing `noNonNullAssertion` warnings unchanged.

- [ ] **Step 4: Update `docs/PHASE-1-SMOKE.md`**

Replace the "### Open follow-up for the GUI smoke" section with:

```markdown
### ✅ GUI smoke automated

The 5-stage Confirm-flow smoke is now `pnpm test:e2e` (Playwright + electron-playwright-helpers). Mocked-LLM happy paths only; real-LLM verification stays manual via `pnpm dev`.

Replaces the prior manual recipe. To complete `phase-1d`:

\`\`\`bash
cd /Users/lxz/ws/personal/carbonbook
pnpm test:e2e
\`\`\`

If green:

\`\`\`bash
git tag phase-1d
git push --tags
\`\`\`
```

- [ ] **Step 5: Update `CHANGELOG.md`**

Add to the "Phase 1d" subsection:

```markdown
### Playwright E2E harness (Phase 1 closing)

Replaces the manual GUI smoke. `pnpm test:e2e` runs 5 stage Confirm flows against the production-built Electron app with mocked LLM + extraction (per-test IPC override via `electron-playwright-helpers`). Per-test isolation via temp `userData` dir. ~30-60s total runtime.

New: `playwright.config.ts`, `tests/e2e/{_setup,canned,china-utility,fuel-receipt,freight,purchase,travel}.{ts,spec.ts}`. New scripts: `test:e2e`, `test:e2e:headed`. One main-process hook honoring `CARBONBOOK_TEST_USER_DATA_DIR`.
```

- [ ] **Step 6: Final commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git status
git add docs/PHASE-1-SMOKE.md CHANGELOG.md
git commit -m "docs: phase-1d closing — E2E suite replaces manual smoke"
git log --oneline -12
git branch --show-current
```

---

## Closeout

After this sub-project lands:

- `pnpm test:e2e` is the canonical pre-tag verification.
- The 5 spec files + harness are durable infrastructure reused by every Phase 2 sub-project.
- 419 vitest tests (Node ABI) + 5 Playwright specs (Electron ABI) — both green.
- Lint clean.
- `phase-1d` tag is one `pnpm test:e2e && git tag phase-1d && git push --tags` away.

**Next:** tag `phase-1d`. Then brainstorm Phase 2 (questionnaire side + MCP).
