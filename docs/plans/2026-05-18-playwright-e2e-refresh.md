# Playwright E2E Suite — Refreshed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land 7 Playwright spec files covering the 5 Phase-1 stage Confirm flows + 2 Phase-2 flows (questionnaire end-to-end, bulk + routing). Suite runs green locally via `pnpm test:e2e` in <90s.

**Architecture:** Reuse the existing harness (`tests/e2e/_setup.ts` is canonical 2026 already). Extend `LaunchOpts` with 4 new optional canned fields (`answer`, `allUnanswered`, `routing`, `classification`) and add `stubDialog` integration for the save-dialog used in the export flow. Adopt the locator-wait policy: every spec starts with a stable-element `locator.waitFor()` instead of `page.waitForLoadState`.

**Tech Stack:** `@playwright/test ^1.60.0`, `electron-playwright-helpers ^2.1.0` (both already installed). Reuses the existing IPC override pattern via `app.evaluate(({ipcMain}, map) => removeHandler + handle)`.

**Spec:** `docs/specs/2026-05-18-playwright-e2e-refresh-design.md`

**Baseline:** 532 vitest tests passing on `main` after `phase-2a` tag (`44a2ff6`). Vitest suite is **unchanged by this sub-project** — E2E lives in a separate suite + runner.

**Target end state:** `pnpm test:e2e` runs 7 specs green, total runtime <90s.

---

## Task 0: Pre-flight verification

This is investigative, not implementation. ~10 minutes.

- [ ] **Step 1: Verify the harness builds + the app launches under Playwright**

  ```bash
  cd /Users/lxz/ws/personal/carbonbook
  git branch --show-current  # main
  pnpm typecheck              # clean
  pnpm build 2>&1 | tail -5   # produces out/main/index.cjs etc.
  ls tests/e2e/                # _setup.ts + canned.ts present
  cat playwright.config.ts     # current config
  ```

- [ ] **Step 2: Inventory existing fixtures**

  ```bash
  cd /Users/lxz/ws/personal/carbonbook
  ls tests/e2e/fixtures/ 2>/dev/null     # may not exist yet
  ls tests/fixtures/ 2>/dev/null         # earlier fixtures may live here
  find . -name '*-sample.pdf' -not -path '*/node_modules/*' 2>/dev/null | head -10
  ```

  Decide based on what exists:
  - If `tests/e2e/fixtures/{china-utility,fuel-receipt,freight,purchase,travel}-sample.pdf` already exist → reuse.
  - If they exist elsewhere → symlink or copy into `tests/e2e/fixtures/`.
  - If they don't exist → check for the generator script `scripts/generate-smoke-fixtures.mjs` referenced in `28c778e`. May need to run it once.

- [ ] **Step 3: Confirm `predev`/`prebuild` rebuild semantics**

  After `pnpm build`, vitest will fail until `pnpm rebuild better-sqlite3` re-targets the Node ABI. This is normal. Document for the implementer below.

  No commit at T0 — verification only.

---

## Task 1: Extend `_setup.ts` LaunchOpts + add sanity smoke spec

**Files:**
- Modify: `tests/e2e/_setup.ts` — add 4 new optional `LaunchOpts` fields + corresponding `app.evaluate` blocks + `stubDialog` for save dialog
- Create: `tests/e2e/sanity.spec.ts` — minimal "app launches, home renders" test
- Verify: `playwright.config.ts` — settings policy

This task validates the harness end-to-end before writing any feature specs.

- [ ] **Step 1: Extend `LaunchOpts` type**

  In `tests/e2e/_setup.ts`, replace the existing `LaunchOpts` with:

  ```ts
  import type { Answer, Extraction, MatcherResult } from '../../src/shared/types.js';

  export type LaunchOpts = {
    cannedExtractions: Record<string, Omit<Extraction, 'id' | 'document_id' | 'created_at'>>;
    cannedRecommendations: Record<string, MatcherResult>;
    cannedAnswers?: Record<string, Answer>;                    // keyed by question_id
    cannedAllUnanswered?: Array<
      | { ok: true; result: { value: Answer } }
      | { ok: false; result: { error: { _tag: string; message: string } } }
    >;
    cannedRoutingLookup?: { distance_km: number; source: 'amap' | 'haversine'; cached: boolean };
    cannedClassification?: { doc_type: string; confidence: number };
    saveDialogPath?: string;                                    // forwarded to stubDialog
  };
  ```

- [ ] **Step 2: Extend `launchApp()` body**

  After the existing `extraction:run` and `ef:recommend` override blocks, ADD four more `app.evaluate` calls following the same shape — each:
  1. Reads its slice of `opts` into a local
  2. If the canned data is defined, registers the override
  3. Uses `ipcMain.removeHandler('...')` then `ipcMain.handle('...', handler)`

  Specifically:

  ```ts
  // answer:generate override
  if (opts.cannedAnswers) {
    type AnswerMap = Record<string, Answer>;
    const map = opts.cannedAnswers;
    await app.evaluate(({ ipcMain }: typeof import('electron'), m: AnswerMap) => {
      ipcMain.removeHandler('answer:generate');
      ipcMain.handle('answer:generate', (_e, input: { question_id: string }) => {
        const a = m[input.question_id];
        if (!a) throw new Error(`[e2e] No canned answer for ${input.question_id}`);
        return a;
      });
    }, map);
  }

  // answer:generate-all-unanswered override
  if (opts.cannedAllUnanswered) {
    const results = opts.cannedAllUnanswered;
    await app.evaluate(({ ipcMain }: typeof import('electron'), r) => {
      ipcMain.removeHandler('answer:generate-all-unanswered');
      ipcMain.handle('answer:generate-all-unanswered', () => r);
    }, results);
  }

  // routing:lookup override
  if (opts.cannedRoutingLookup) {
    const r = opts.cannedRoutingLookup;
    await app.evaluate(({ ipcMain }: typeof import('electron'), result) => {
      ipcMain.removeHandler('routing:lookup');
      ipcMain.handle('routing:lookup', () => ({ ok: true, ...result }));
    }, r);
  }

  // classification:run override (if present)
  if (opts.cannedClassification) {
    const c = opts.cannedClassification;
    await app.evaluate(({ ipcMain }: typeof import('electron'), classification) => {
      ipcMain.removeHandler('classification:run');
      ipcMain.handle('classification:run', () => classification);
    }, c);
  }
  ```

  **Verify the channel names match production.** Read `src/main/ipc/types.ts` for the exact strings. If your classification IPC channel isn't `classification:run`, adjust. Same for any I got wrong above.

- [ ] **Step 3: Add `stubDialog` for save-dialog**

  Near the top of `_setup.ts`, import:

  ```ts
  import { stubDialog } from 'electron-playwright-helpers';
  ```

  After the IPC overrides, if `opts.saveDialogPath`:

  ```ts
  if (opts.saveDialogPath) {
    await stubDialog(app, 'showSaveDialog', {
      canceled: false,
      filePath: opts.saveDialogPath,
    });
  }
  ```

  This intercepts the Electron native save dialog before it can block the test.

- [ ] **Step 4: Document the locator-wait policy in `_setup.ts`**

  Add a header comment block at the top of `_setup.ts` (or extend the existing one):

  ```ts
  /**
   * --- Locator-wait policy ---
   *
   * Specs MUST NOT call `page.waitForLoadState('networkidle' | 'domcontentloaded')`
   * as a sync barrier. TanStack Router hydration races make those flaky.
   *
   * Instead, the FIRST line of every spec body waits on a stable element
   * via `locator.waitFor()`:
   *
   *   await window.getByRole('heading', { name: /carbonbook/i }).waitFor();
   *
   * Playwright's auto-wait absorbs hydration timing.
   *
   * If specs become flaky despite this, the renderer fix is adding a
   * `useHydrated()` hook to root layout that sets `data-hydrated="true"`;
   * specs then wait on `page.locator('[data-hydrated="true"]')`.
   * Out of scope for v1.
   */
  ```

- [ ] **Step 5: Write the sanity spec**

  Create `tests/e2e/sanity.spec.ts`:

  ```ts
  import { test, expect } from '@playwright/test';
  import { launchApp, teardown } from './_setup.js';

  test('app launches and home renders', async () => {
    const setup = await launchApp({
      cannedExtractions: {},
      cannedRecommendations: {},
    });
    try {
      // Locator-wait policy: stable element first.
      await setup.window.getByRole('heading', { name: /carbonbook|dashboard|home/i }).waitFor();

      // Smoke assertion — basic UI element present.
      await expect(setup.window).toHaveTitle(/carbonbook/i);
    } finally {
      await teardown(setup);
    }
  });
  ```

  Adjust the heading regex to whatever the actual root-route header is. Read `src/renderer/routes/__root.tsx` or `src/renderer/routes/index.tsx` first to find a stable selector.

- [ ] **Step 6: Run + verify**

  ```bash
  cd /Users/lxz/ws/personal/carbonbook
  pnpm typecheck 2>&1 | tail -5
  pnpm test:e2e tests/e2e/sanity.spec.ts 2>&1 | tail -20
  ```

  Expected: 1/1 passing. If flake on first run, retry once before debugging — Electron's initial paint takes 1-2s.

  Failure modes:
  - "No window found" — main bootstrap is failing. Check `out/main/index.cjs` exists; `pnpm build` may need to run first (it should via test:e2e prebuild).
  - Title doesn't match — check `index.html`'s `<title>` and adjust the regex.
  - Timeout on locator — the heading regex doesn't match anything. Open the app via `pnpm dev`, read the home page's DOM, pick a reliable selector.

- [ ] **Step 7: Switch back to Node ABI**

  After T1 finishes (and after every T2-T5 if you want to also run vitest):

  ```bash
  cd /Users/lxz/ws/personal/carbonbook
  pnpm rebuild better-sqlite3
  ```

  This flips the native binding back to Node ABI so vitest works.

- [ ] **Step 8: Commit**

  ```bash
  cd /Users/lxz/ws/personal/carbonbook
  git add tests/e2e/_setup.ts tests/e2e/sanity.spec.ts
  # If playwright.config.ts changed:
  git add playwright.config.ts 2>/dev/null || true
  git commit -m "test(e2e): extend LaunchOpts for Phase 2 IPC overrides + sanity smoke"
  git branch --show-current
  ```

  Expected: branch `main`.

---

## Task 2: 5 Phase-1 stage Confirm flow specs

**Files:**
- Create: `tests/e2e/china-utility.spec.ts`
- Create: `tests/e2e/fuel-receipt.spec.ts`
- Create: `tests/e2e/freight.spec.ts`
- Create: `tests/e2e/purchase.spec.ts`
- Create: `tests/e2e/travel.spec.ts`
- Possibly: `tests/e2e/fixtures/*` if not already present

Each spec follows the same shape: launch with canned extractions for that stage → upload PDF → run extraction → review fields → pick emission source → see recommendation → click Confirm → land on dashboard with new activity_data row.

- [ ] **Step 1: Inventory fixtures**

  ```bash
  cd /Users/lxz/ws/personal/carbonbook
  ls tests/e2e/fixtures/*.pdf 2>/dev/null
  find . -name '*-sample.pdf' -not -path '*/node_modules/*' | head -10
  ```

  Required: 5 PDF fixtures, one per stage. If they exist from `28c778e`, locate and ensure they're in `tests/e2e/fixtures/`. If missing, run `scripts/generate-smoke-fixtures.mjs` (per `28c778e`'s commit message).

  Expected fixture names from prior smoke:
  - `01-utility-sample.pdf`
  - `02-fuel-receipt-sample.pdf`
  - `03-freight-sample.pdf`
  - `04-purchase-sample.pdf`
  - `05-travel-sample.pdf`

  (Adjust if the prior naming differs.)

- [ ] **Step 2: Write the 5 specs**

  Use the template below for `china-utility.spec.ts` — each other spec is a clone with different fixture, stage option, field assertions:

  ```ts
  // tests/e2e/china-utility.spec.ts
  import { test, expect } from '@playwright/test';
  import { join } from 'node:path';
  import { stubDialog } from 'electron-playwright-helpers';
  import { launchApp, teardown } from './_setup.js';
  import { CANNED_EXTRACTIONS, CANNED_RECOMMENDATIONS } from './canned.js';

  test('china_utility.v1: upload → extract → recommend → confirm', async () => {
    const setup = await launchApp({
      cannedExtractions: { 'china_utility.v1': CANNED_EXTRACTIONS['china_utility.v1'] },
      cannedRecommendations: { 'china_utility.v1': CANNED_RECOMMENDATIONS['china_utility.v1'] },
    });
    const { app, window, tempUserDataDir } = setup;
    try {
      // Locator-wait policy: stable element first.
      await window.getByRole('heading', { name: /carbonbook|dashboard/i }).waitFor();

      // Seed an org via IPC to bypass onboarding (if not done in main bootstrap).
      // ...details depend on existing onboarding model — read src/main/services/organization-service.ts.

      // Stub the file dialog so upload receives our fixture.
      await stubDialog(app, 'showOpenDialog', {
        canceled: false,
        filePaths: [join(__dirname, 'fixtures/01-utility-sample.pdf')],
      });

      // Trigger upload + stage pick + extract.
      // Selectors depend on existing UI — read renderer routes for the upload entry point.
      await window.getByRole('button', { name: /upload/i }).click();
      await window.getByRole('combobox', { name: /stage/i }).selectOption('china_utility.v1');
      await window.getByRole('button', { name: /run extraction|extract/i }).click();

      // ExtractionReview page.
      await window.getByText(/review|审核/i).waitFor({ timeout: 30_000 });

      // Pick an emission source, see recommendation, confirm.
      await window.getByLabel(/emission source|排放源/i).selectOption({ index: 0 });
      await window.getByText(/为本单据推荐|recommended/i).waitFor();
      await window.locator('input[type=radio]').first().check();
      await window.getByRole('button', { name: /confirm|确认/i }).click();

      // Land on dashboard with new activity_data row.
      await expect(window).toHaveURL(/\/$/);
      await expect(window.getByText(/01-utility-sample/i)).toBeVisible();
    } finally {
      await teardown(setup);
    }
  });
  ```

  Repeat for the other 4 stages. Key differences per stage:
  - `fuel-receipt.spec.ts` — fixture `02-fuel-receipt-sample.pdf`, stage `fuel_receipt.v1`. ExtractionReview shows fuel-type dropdown.
  - `freight.spec.ts` — fixture `03-freight-sample.pdf`, stage `freight.v1`. Mode dropdown (truck/rail/sea/air).
  - `purchase.spec.ts` — fixture `04-purchase-sample.pdf`, stage `purchase.v1`. Category dropdown; "other" triggers warning.
  - `travel.spec.ts` — fixture `05-travel-sample.pdf`, stage `travel.v1`. Mode (air/rail/taxi); different field visibility per mode.

  Each spec is ~80-100 LOC; share no helper across them in v1.

- [ ] **Step 3: Run + verify**

  ```bash
  cd /Users/lxz/ws/personal/carbonbook
  pnpm test:e2e tests/e2e/china-utility.spec.ts 2>&1 | tail -20
  ```

  Iterate. If selectors fail, adjust them based on actual DOM. If hydration timing causes flake, add more `locator.waitFor()` calls at critical transitions.

  Once china-utility passes, run all 5 in sequence:

  ```bash
  pnpm test:e2e tests/e2e/{china-utility,fuel-receipt,freight,purchase,travel}.spec.ts
  ```

  Expected: 5/5 passing in <45s total.

- [ ] **Step 4: Commit**

  ```bash
  cd /Users/lxz/ws/personal/carbonbook
  git add tests/e2e/
  git commit -m "test(e2e): 5 Phase-1 stage Confirm flow specs"
  git branch --show-current
  ```

---

## Task 3: Questionnaire end-to-end spec

**Files:**
- Create: `tests/e2e/questionnaire.spec.ts`
- Create: `tests/e2e/fixtures/questionnaire-sample.xlsx` (synthesize or hand-build)
- Modify: `tests/e2e/canned.ts` — add canned answers + canned questionnaire response

Drives the full Phase 2.2 flow: upload .xlsx → extract questions → AnswerReviewCard generate single answer → edit → save → finalize → export → assert file written.

- [ ] **Step 1: Build the questionnaire fixture**

  Either hand-build a small `.xlsx` with 2-3 question rows using LibreOffice/Excel and commit it, OR write a one-off script:

  ```js
  // scripts/build-e2e-questionnaire-fixture.mjs
  import ExcelJS from 'exceljs';
  import { writeFileSync } from 'node:fs';

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.getCell('A1').value = 'Question';
  ws.getCell('B1').value = 'Value';
  ws.getCell('A2').value = '2025年度总用电量 (kWh)?';
  ws.getCell('B2').value = '';
  ws.getCell('A3').value = '2025年度总耗水量 (吨)?';
  ws.getCell('B3').value = '';
  const buf = await wb.xlsx.writeBuffer();
  writeFileSync('tests/e2e/fixtures/questionnaire-sample.xlsx', Buffer.from(buf));
  ```

  Run once (`node scripts/build-e2e-questionnaire-fixture.mjs`); commit the .xlsx.

- [ ] **Step 2: Add canned data**

  In `tests/e2e/canned.ts`, append:

  ```ts
  export const CANNED_ANSWER_GENERATED = {
    id: 'a-e2e-1',
    question_id: 'q-1',
    value: '14820',
    unit: 'kWh',
    source_kind: 'ai_suggested' as const,
    source_calculation_snapshot_id: null,
    source_activity_data_id: null,
    source_company_profile_key: null,
    source_narrative_bank_id: null,
    source_summary: null,
    finalized_at: null,
  };
  ```

- [ ] **Step 3: Write the spec**

  Skeleton:

  ```ts
  // tests/e2e/questionnaire.spec.ts
  import { test, expect } from '@playwright/test';
  import { existsSync } from 'node:fs';
  import { join } from 'node:path';
  import { stubDialog } from 'electron-playwright-helpers';
  import { launchApp, teardown } from './_setup.js';
  import { CANNED_ANSWER_GENERATED } from './canned.js';

  test('questionnaire: upload → extract → generate answer → finalize → export', async () => {
    const setup = await launchApp({
      cannedExtractions: {},
      cannedRecommendations: {},
      cannedAnswers: { 'q-1': CANNED_ANSWER_GENERATED },
      saveDialogPath: join(setup.tempUserDataDir, 'exported.xlsx'), // forward-ref issue — see below
    });
    const { app, window, tempUserDataDir } = setup;
    try {
      await window.getByRole('heading', { name: /carbonbook|questionnaires/i }).waitFor();

      // Navigate to /questionnaires/new
      await window.getByRole('link', { name: /questionnaires|问卷/i }).click();
      await window.getByRole('button', { name: /new|新建/i }).click();

      // Stub file dialog → return our fixture
      await stubDialog(app, 'showOpenDialog', {
        canceled: false,
        filePaths: [join(__dirname, 'fixtures/questionnaire-sample.xlsx')],
      });

      // Fill in customer name + year + click upload
      // ...UI-specific selectors

      // Wait for parsing + extraction to complete; should auto-navigate to detail route
      await window.getByText(/2025年度总用电量/).waitFor({ timeout: 30_000 });

      // Click "Generate answer" on first AnswerReviewCard
      await window.getByRole('button', { name: /generate answer|生成答案/i }).first().click();

      // Answer should fill in (value: '14820', unit: 'kWh')
      await expect(window.locator('input[value="14820"]')).toBeVisible();

      // Edit + Save & finalize
      // ...

      // Export — save dialog already stubbed
      await window.getByRole('button', { name: /export to excel|导出 excel/i }).click();
      await window.getByText(/answers written|条答案/i).waitFor({ timeout: 10_000 });

      // Assert file written
      expect(existsSync(join(tempUserDataDir, 'exported.xlsx'))).toBe(true);
    } finally {
      await teardown(setup);
    }
  });
  ```

  **Issue with `saveDialogPath`**: in the skeleton above, we reference `setup.tempUserDataDir` BEFORE `launchApp` returns. The harness needs adjustment OR the spec author calculates the path differently.

  **Fix:** make `tempUserDataDir` reasoning happen inside `launchApp`, then `stubDialog` for save-dialog inside the harness using `opts.saveDialogFileName: string` (just the basename). The harness joins with the temp dir internally:

  ```ts
  // _setup.ts
  saveDialogFileName?: string;       // basename like 'exported.xlsx'

  // inside launchApp, after stubDialog(showOpenDialog):
  if (opts.saveDialogFileName) {
    const savePath = join(tempUserDataDir, opts.saveDialogFileName);
    await stubDialog(app, 'showSaveDialog', { canceled: false, filePath: savePath });
    setup.savedFilePath = savePath; // expose on the return type
  }
  ```

  Then spec asserts `existsSync(setup.savedFilePath)`. Update spec accordingly.

  **Refactor T1 to expose this if you didn't already** — minor diff to `_setup.ts`.

- [ ] **Step 4: Run + iterate**

  ```bash
  cd /Users/lxz/ws/personal/carbonbook
  pnpm test:e2e tests/e2e/questionnaire.spec.ts 2>&1 | tail -30
  ```

  This spec is the most likely to need selector iteration. Use Playwright Inspector if needed:

  ```bash
  PWDEBUG=1 pnpm test:e2e:headed tests/e2e/questionnaire.spec.ts
  ```

- [ ] **Step 5: Commit**

  ```bash
  cd /Users/lxz/ws/personal/carbonbook
  git add tests/e2e/questionnaire.spec.ts tests/e2e/fixtures/questionnaire-sample.xlsx tests/e2e/canned.ts
  # _setup.ts may have been refactored:
  git add tests/e2e/_setup.ts 2>/dev/null
  git commit -m "test(e2e): questionnaire end-to-end — upload → generate → finalize → export"
  ```

---

## Task 4: Bulk + routing spec

**Files:**
- Create: `tests/e2e/bulk-routing.spec.ts`
- Modify: `tests/e2e/canned.ts` — add `CANNED_ALL_UNANSWERED`, `CANNED_ROUTING_LOOKUP`

Drives: "Generate all unanswered" → 3 succeed + 1 fails → toast asserts. Then upload a freight extraction, fill origin/destination, click "Look up distance" → mocked routing fills `distance_km`.

- [ ] **Step 1: Add canned data**

  ```ts
  // tests/e2e/canned.ts
  export const CANNED_ALL_UNANSWERED = [
    { ok: true,  result: { value: CANNED_ANSWER_GENERATED } },
    { ok: true,  result: { value: { ...CANNED_ANSWER_GENERATED, id: 'a-e2e-2', question_id: 'q-2' } } },
    { ok: true,  result: { value: { ...CANNED_ANSWER_GENERATED, id: 'a-e2e-3', question_id: 'q-3' } } },
    { ok: false, result: { error: { _tag: 'LLMCallFailed', message: 'simulated network blip' } } },
  ];

  export const CANNED_ROUTING_LOOKUP = {
    distance_km: 1085,
    source: 'amap' as const,
    cached: false,
  };
  ```

- [ ] **Step 2: Write the spec**

  Two scenarios in one spec (or split into two — author's call):

  ```ts
  test('bulk generate all unanswered: 3 succeed 1 fails', async () => {
    const setup = await launchApp({
      cannedExtractions: {},
      cannedRecommendations: {},
      cannedAllUnanswered: CANNED_ALL_UNANSWERED,
    });
    const { window } = setup;
    try {
      await window.getByRole('heading', { name: /carbonbook|questionnaires/i }).waitFor();
      // Navigate to a pre-seeded questionnaire... or upload one as setup
      // Click "Generate all unanswered"
      await window.getByRole('button', { name: /generate all/i }).click();
      // Assert toast: "3 answered, 1 failed"
      await window.getByText(/3.*answered.*1.*failed|3.*1/i).waitFor({ timeout: 10_000 });
    } finally {
      await teardown(setup);
    }
  });

  test('routing: look up distance fills the field', async () => {
    const setup = await launchApp({
      cannedExtractions: { 'freight.v1': /* canned freight extraction with origin/destination */ },
      cannedRecommendations: { 'freight.v1': /* canned recommendation */ },
      cannedRoutingLookup: CANNED_ROUTING_LOOKUP,
    });
    const { window } = setup;
    try {
      await window.getByRole('heading', { name: /carbonbook/i }).waitFor();
      // Navigate to freight upload → extract → review → ActivityForm
      // Look up distance button visible because origin/destination set + distance_km null
      await window.getByRole('button', { name: /look up distance|查询距离/i }).click();
      await window.getByText(/AMap.*1085.*km|高德.*1085/i).waitFor({ timeout: 10_000 });
      // The distance_km input should now show 1085
      await expect(window.locator('input[name="distance_km"]')).toHaveValue('1085');
    } finally {
      await teardown(setup);
    }
  });
  ```

  The first scenario (`bulk generate all unanswered`) requires a seeded questionnaire with 4 unanswered questions. Either:
  - Pre-seed via direct DB write before launching the app (read main-process startup; or use `app.evaluate` to run an INSERT before triggering UI).
  - OR start from a questionnaire upload + auto-classify + question extraction, then click Generate All.

  The second approach is more brittle but more realistic. Pick based on what's tractable; pre-seeding via `app.evaluate` is faster.

- [ ] **Step 3: Run + iterate**

  ```bash
  cd /Users/lxz/ws/personal/carbonbook
  pnpm test:e2e tests/e2e/bulk-routing.spec.ts 2>&1 | tail -30
  ```

- [ ] **Step 4: Commit**

  ```bash
  cd /Users/lxz/ws/personal/carbonbook
  git add tests/e2e/bulk-routing.spec.ts tests/e2e/canned.ts
  git commit -m "test(e2e): bulk generate + routing lookup flows"
  ```

---

## Task 5: Final suite run + sweep + docs

- [ ] **Step 1: Run all specs together**

  ```bash
  cd /Users/lxz/ws/personal/carbonbook
  pnpm test:e2e 2>&1 | tail -10
  ```

  Expected: 7 passing (sanity + 5 stages + questionnaire + bulk-routing), total <90s.

  If any spec is flaky on this run, retry once:

  ```bash
  pnpm test:e2e 2>&1 | tail -10
  ```

  Two consecutive passes = good enough for v1. If still flaky, debug specific selectors.

- [ ] **Step 2: Switch back to Node ABI + run vitest as smoke**

  ```bash
  cd /Users/lxz/ws/personal/carbonbook
  pnpm rebuild better-sqlite3
  pnpm vitest run --pool=threads 2>&1 | tail -5
  ```

  Expected: 532 vitest tests still passing. The Node-ABI flip doesn't affect what's tested; it's just a runtime requirement.

- [ ] **Step 3: typecheck + format + lint**

  ```bash
  cd /Users/lxz/ws/personal/carbonbook
  pnpm typecheck
  pnpm format 2>&1 | tail -3
  pnpm exec biome check --write 2>&1 | tail -3
  ```

- [ ] **Step 4: Add deprecation banner to manual smoke doc**

  In `docs/PHASE-1-SMOKE-MANUAL.md`, add at the very top:

  ```markdown
  > **Superseded by Playwright E2E suite (2026-05-18).**
  > Run `pnpm test:e2e` instead. The 7 automated specs cover the same flows
  > (5 stages + questionnaire end-to-end + bulk-routing). This document is
  > kept for historical context.
  ```

- [ ] **Step 5: Final commit + summary**

  ```bash
  cd /Users/lxz/ws/personal/carbonbook
  git add -A
  git commit -m "chore: biome sweep + manual-smoke deprecation note for E2E suite" || true
  git log --oneline -12
  git branch --show-current
  ```

---

## Closeout

After this sub-project lands:

- `tests/e2e/{sanity,china-utility,fuel-receipt,freight,purchase,travel,questionnaire,bulk-routing}.spec.ts` — 8 specs.
- `tests/e2e/_setup.ts` extended with 4 new optional canned fields + `stubDialog` for save.
- `tests/e2e/fixtures/questionnaire-sample.xlsx` — new fixture.
- `pnpm test:e2e` runs green locally, <90s total.
- Manual smoke document marked superseded.

**The Phase 1 deferred work is finally closed.** Every future sub-project can run `pnpm test:e2e` as pre-tag verification.

**Three takeaways:**

1. **The May 14 spec was architecturally correct.** Only the spec execution layer was deferred; the harness shipped + works.
2. **Locator-wait policy is the universal anti-flake.** `page.waitForLoadState` is a trap with TanStack Router. `locator.waitFor()` absorbs hydration uniformly.
3. **Mock at the IPC channel boundary, not at the network or library layer.** `app.evaluate(({ipcMain}, map) => removeHandler + handle)` is the canonical Playwright + Electron pattern for response stubbing.

**Next sub-projects (not in this plan):**
- CI integration (GitHub Actions ubuntu-latest + Xvfb).
- Real-LLM opt-in (`CARBONBOOK_E2E_REAL_LLM=1`).
- Visual regression snapshots for AnswerReviewCard + ExtractionReview.
- Phase 2 settings spec (AMap key save).
- Phase 2 onboarding spec (first-run org creation).
