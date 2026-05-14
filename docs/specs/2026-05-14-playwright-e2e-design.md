# Playwright E2E Setup Design

**Date:** 2026-05-14
**Sub-project:** Phase 1.5 closing / Phase 2 prep
**Predecessor:** Phase 1 backend complete on `main` (`fba67d2`)
**Successor:** `phase-1d` tag, then Phase 2 brainstorm

## Goal

Replace the manual GUI smoke (5 stages × Confirm flow) with an automated Playwright Electron suite that runs against the production build. Once landed, `phase-1d` can be tagged on a green E2E run instead of a human-driven walkthrough, and every future Phase 2 sub-project gets the same harness for free.

## Non-goals

- Hitting real OpenAI in tests (mocked-LLM only — per user-confirmed scope).
- Onboarding wizard / discard / settings flows (unit-test layer covers these).
- Visual regression / screenshot snapshots (high maintenance for v1; can add in a follow-up).
- CI integration (GitHub Actions / etc.) — local-only for v1, CI follow-up after the suite is stable.
- Real-LLM opt-in mode behind a flag (no for v1 per user decision).

## Architecture

```
┌─ Test harness (Playwright Test) ───────────────────────────────────────────┐
│                                                                            │
│  beforeEach:                                                               │
│    1. mkdtemp() → CARBONBOOK_TEST_USER_DATA_DIR                            │
│    2. _electron.launch({ args: ['out/main/index.cjs'], env: {…} })         │
│    3. ipcMainHandle('extraction:run', → canned per-stage Extraction)       │
│    4. ipcMainHandle('ef:recommend', → canned MatcherResult)                │
│    5. window = await app.firstWindow()                                     │
│                                                                            │
│  test body (per stage):                                                    │
│    - Seed an org + emission_source via real IPC.                           │
│    - <input type="file">.setInputFiles(fixture-pdf)                        │
│    - Pick stage + click "run extraction"                                   │
│    - Wait for review page                                                  │
│    - Pick a source → recommended panel appears                             │
│    - Click a starred recommendation → Confirm                              │
│    - Assert: lands on /, an activity_data row appears                      │
│                                                                            │
│  afterEach: app.close(); rm temp dir.                                      │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

The renderer-side code path is entirely real. The two seams cut are:

1. **`extraction:run`** — the test returns a pre-canned `Extraction` row instead of running PDF parsing + LLM. Per-stage canned data: parsed_json matches the schema for that stage, status `'review_needed'`, prompt_version `<stage>.v1`.
2. **`ef:recommend`** — the test returns a pre-canned `MatcherResult` with 3 recommendations from the seeded EF catalog. Per-stage choices pick from migration 011's seed (e.g. travel uses `travel.air.economy.shorthaul`).

The fixture PDF (`tests/fixtures/two-page-text.pdf`, already in repo) is reused across all 5 specs. Content doesn't matter because the extraction is mocked; the file just needs to satisfy `document:upload`'s validity check.

## Component design

### Main-process bootstrap hook

`src/main/bootstrap.ts` (or wherever `app.getPath('userData')` is consumed) needs a small change to honor a test env var. Estimated ~5 LOC:

```ts
if (process.env.CARBONBOOK_TEST_USER_DATA_DIR) {
  app.setPath('userData', process.env.CARBONBOOK_TEST_USER_DATA_DIR);
}
```

This must run BEFORE any service that reads `userData` (the DB connection, the documents-storage dir). Place it at the top of the main entry point.

No test-only branches anywhere else. The IPC mocks are installed externally by the test via `electron-playwright-helpers`, not via in-app feature flags.

### Test harness setup

`tests/e2e/_setup.ts` — shared fixture exposing:

```ts
export type StageE2ESetup = {
  app: ElectronApplication;
  window: Page;
  tempUserDataDir: string;
};

export async function launchApp(opts: {
  cannedExtraction: Record<string, Extraction>;  // keyed by stage_id
  cannedRecommendation: Record<string, MatcherResult>;
}): Promise<StageE2ESetup>;

export async function teardown(setup: StageE2ESetup): Promise<void>;
```

`launchApp()` does the `mkdtempSync` + `_electron.launch` + IPC handle override dance. `teardown()` closes the app and removes the temp dir.

### Per-stage canned data

A central `tests/e2e/canned.ts` exports the 5 canned extractions + 5 canned recommendations. Each canned extraction has:

- `id: 'ext-<stage>-1'`
- `document_id: <real document id from upload step — patched at runtime>`
- `parsed_json` matching the stage schema (e.g. for travel: mode=air, supplier_name, etc.)
- `prompt_version: '<stage>.v1'`
- `status: 'review_needed'`

Each canned recommendation points to a real EF from the seeded catalog (the 32 EFs from migrations 008 + 011), so the renderer's "click a starred row" actually selects a valid `(factor_code, year, source, geography, dataset_version)` tuple.

### Per-stage spec files

Five files in `tests/e2e/<stage>.spec.ts`. Each ~80 LOC. Structure:

```ts
import { test, expect } from '@playwright/test';
import { launchApp, teardown } from './_setup';
import { CANNED } from './canned';
import path from 'node:path';

const FIXTURE_PDF = path.join(__dirname, '../fixtures/two-page-text.pdf');

test.describe('travel.v1 Confirm flow', () => {
  let ctx;
  test.beforeEach(async () => {
    ctx = await launchApp({
      cannedExtraction: { 'travel.v1': CANNED.travel.extraction },
      cannedRecommendation: { 'travel.v1': CANNED.travel.recommendation },
    });
  });
  test.afterEach(async () => teardown(ctx));

  test('uploads PDF, runs extraction, picks recommended EF, confirms, lands on dashboard', async () => {
    const { window } = ctx;

    // Seed an org + emission_source via real IPC.
    await window.evaluate(() =>
      // @ts-ignore — window.api is available in renderer at runtime
      window.api.invoke('organization:create', { name: 'Test Org' }),
    );
    // …seed source matching travel.air category…

    // Drive the upload UI.
    await window.locator('input[type=file]').setInputFiles(FIXTURE_PDF);
    await window.getByRole('combobox', { name: /stage/i }).selectOption('travel.v1');
    await window.getByRole('button', { name: /run extraction/i }).click();

    // Wait for review page (route change).
    await expect(window).toHaveURL(/\/documents\//, { timeout: 10_000 });

    // Pick a source → recommended panel renders.
    await window.getByLabel(/emission source/i).selectOption({ index: 0 });
    await expect(window.getByText('为本单据推荐')).toBeVisible();

    // Click first starred recommendation → Confirm.
    await window.locator('input[type=radio]').first().check();
    await window.getByRole('button', { name: /confirm/i }).click();

    // Lands on dashboard with the new activity_data row.
    await expect(window).toHaveURL(/\/$/);
  });
});
```

### Configuration files

`playwright.config.ts` at repo root:

```ts
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  retries: 1,
  use: { trace: 'on-first-retry' },
  reporter: process.env.CI ? 'github' : 'list',
});
```

`package.json` script additions:

```json
{
  "scripts": {
    "test:e2e": "pnpm build && playwright test",
    "test:e2e:headed": "pnpm build && playwright test --headed"
  }
}
```

The `pnpm build` prerequisite ensures `electron-rebuild` flips better-sqlite3 to Electron-ABI before launch. After the suite runs, the user needs `pnpm rebuild better-sqlite3` to flip back to Node-ABI for vitest — this is the same hazard documented elsewhere; the script doesn't auto-flip back to avoid accidentally breaking a vitest workflow the user already had running.

## Risk + safety net

| Risk | Caught by |
|---|---|
| Native-binding ABI mismatch breaks the launch | `pnpm test:e2e` runs `pnpm build` first; if rebuild fails, build fails before launch. |
| Real LLM accidentally fires (would burn budget) | IPC handler override; if it didn't take, the renderer's `efMatcherApi.recommend()` call would hit the un-mocked main-process handler, which calls the real LLMClient. **Mitigation**: the canned-data setup includes a safety assertion in `launchApp` that checks the handle override returns the canned data on a probe call before the test body runs. |
| Flake on Electron 41 (known context-loss issue) | `retryUntilTruthy` from `electron-playwright-helpers` for any waits; `retries: 1` at the Playwright config level. |
| Temp user-data dirs leak | `afterEach` rm; an `afterAll` sweep cleans any stragglers. |
| First-run onboarding wizard blocks the test | Test seeds org via IPC BEFORE upload, bypassing onboarding's "no org yet" branch. |

## Test count + perf budget

- 5 new specs (one per stage).
- Each spec runs ~5-10 seconds (Electron launch is the bottleneck, ~2 sec; rest is renderer-driven).
- Total: ~30-60 seconds per full E2E run.
- No new unit tests added. Existing 418-test vitest suite remains the primary safety net for non-UI paths.

## Expected end state

After this sub-project lands:

- `tests/e2e/{china-utility,fuel-receipt,freight,purchase,travel}.spec.ts` — 5 spec files.
- `tests/e2e/_setup.ts` — shared harness.
- `tests/e2e/canned.ts` — per-stage canned IPC responses.
- `playwright.config.ts` at repo root.
- `package.json` gains `test:e2e` + `test:e2e:headed` scripts.
- 5-line main-process change honoring `CARBONBOOK_TEST_USER_DATA_DIR`.
- New devDeps: `@playwright/test`, `electron-playwright-helpers`.
- `pnpm test:e2e` runs green locally on first try.
- `phase-1d` tag-readiness changes from "manual smoke" to "pnpm test:e2e green".

## Migration / cleanup

- `docs/PHASE-1-SMOKE.md`'s "Open follow-up for the GUI smoke" section gets updated to point at `pnpm test:e2e` instead of `pnpm dev`.
- `CHANGELOG.md` gets a small section noting the harness landed.

## Out-of-scope follow-ups (recorded for future sub-projects)

- CI integration (GitHub Actions / equivalent).
- Real-LLM opt-in flag (gated by `CARBONBOOK_E2E_REAL_LLM=1`).
- Onboarding/discard/settings E2E specs.
- Visual regression / screenshot snapshots.
- Multi-stage scenarios (upload 5 PDFs in one session and confirm all 5).
- Per-stage source-pick variants (multiple categories per stage to exercise the prefix-match more thoroughly).
