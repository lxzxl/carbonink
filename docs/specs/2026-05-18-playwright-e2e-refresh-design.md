# Playwright E2E Suite — Refreshed Design

**Date:** 2026-05-18
**Status:** Approved by user 2026-05-18; ready for plan.
**Predecessor:** `docs/specs/2026-05-14-playwright-e2e-design.md` (May 14 — architecturally correct; deferred at `phase-1d`).
**Successor:** TBD — CI integration as separate sub-project.

## What changed since May 14

Three things made the deferred "spec execution layer" tractable now:

1. **The deferred friction has a name and a fix.** TanStack Router + Playwright has a documented hydration race. Community-canonical fix: prefer `locator(selector).waitFor()` over `page.waitForLoadState()`. (See [BrowserStack guide](https://www.browserstack.com/guide/playwright-waitforloadstate), [TanStack Router #5727](https://github.com/TanStack/router/discussions/5727).)
2. **Six new features landed since May 14** that need E2E coverage: auto-classify, questionnaire upload, AI auto-answer (single + bulk), Excel export, routing API. The May 14 spec covered only the 5 Phase-1 extraction stages.
3. **The harness is now battle-tested at the unit level.** `tests/e2e/_setup.ts` (135 LOC) handles IPC override via `app.evaluate(({ipcMain}, map) => removeHandler + handle)` — the pattern is verified in the existing `canned.ts` and ready to extend for new IPC channels.

## Goal

Land a working Playwright E2E suite that exercises **7 user flows**, runs green locally via `pnpm test:e2e`, and replaces the manual GUI smoke documented in `docs/PHASE-1-SMOKE-MANUAL.md`.

## Non-goals

- CI integration (GitHub Actions / equivalent). Out of scope — separate sub-project.
- Real-LLM opt-in flag (gated by `CARBONBOOK_E2E_REAL_LLM=1`). Defer.
- Visual regression / screenshot snapshots. Defer.
- Onboarding / settings / discard flows. Not on the critical path; defer.
- Multi-stage cross-flow scenarios ("upload 5 PDFs and confirm all"). One feature per spec.
- Refactoring the harness — it's already canonical.

## Scope — the 7 flows

| # | Flow | What it asserts |
|---|---|---|
| 1 | **`china_utility.v1`** Confirm flow | Upload → extract → recommender shows mocked Top-3 + ranked list → Confirm → activity_data row appears on dashboard |
| 2 | **`fuel_receipt.v1`** Confirm flow | Same shape, fuel-receipt fields visible in ExtractionReview |
| 3 | **`freight.v1`** Confirm flow | Same shape, freight fields, mode dropdown, distance_km nullable |
| 4 | **`purchase.v1`** Confirm flow | Same shape, purchase fields, category dropdown, "other" warning UX |
| 5 | **`travel.v1`** Confirm flow | Same shape, mode-specific fields (air/rail/taxi) |
| 6 | **Questionnaire end-to-end** | Upload .xlsx → extract questions → generate single answer → edit & save → finalize → export → dialog stubbed → status flips to 'exported' |
| 7 | **Bulk generate + routing lookup** | "Generate all unanswered" fills empties (concurrency=3, mocked LLM); "Look up distance" button on a freight ActivityForm fills `distance_km` (mocked AMap) |

## Architecture

### Harness — already shipped, minor extension

`tests/e2e/_setup.ts` exposes `launchApp(opts)` / `teardown(setup)`. It already overrides `extraction:run` and `ef:recommend` via `app.evaluate(({ipcMain}, map) => removeHandler + handle)`.

T1 extends the override set to cover Phase 2:

- `answer:generate` — returns a canned `Answer` row.
- `answer:generate-all-unanswered` — returns a canned `Array<{ok, result}>`.
- `routing:lookup` — returns a canned `{ok: true, distance_km, source, cached}`.
- `classification:run` — returns a canned `{ doc_type: ..., confidence: ... }` (if used).

Plus `stubDialog` from `electron-playwright-helpers` for the Phase 2.2c Export save dialog.

The harness signature stays the same; new fields land on `LaunchOpts`:

```ts
export type LaunchOpts = {
  cannedExtractions:       Record<string, Omit<Extraction, 'id' | 'document_id' | 'created_at'>>;
  cannedRecommendations:   Record<string, MatcherResult>;
  cannedAnswers?:          Record<string, Answer>;                    // keyed by question_id
  cannedAllUnanswered?:    Array<{ ok: boolean; result: unknown }>;
  cannedRoutingLookup?:    { distance_km: number; source: 'amap' | 'haversine' };
  cannedClassification?:   Record<string, { doc_type: string }>;
  saveDialogPath?:         string;                                    // for stubDialog
};
```

Each canned field optional — Phase 1 specs (T2) leave the Phase 2 fields unset.

### TanStack Router hydration — locator-wait policy

**Policy:** never call `page.waitForLoadState('networkidle')` or `'domcontentloaded'` as a sync barrier. Instead, the first thing every spec does is:

```ts
await window.getByRole('heading', { name: /carbonbook/i }).waitFor();
```

Or whatever the first-mount stable element is on the home route. Playwright's `locator.waitFor()` auto-waits up to 30s for the element to attach + be visible, absorbing TanStack Router hydration timing.

This is documented in a header comment in `_setup.ts` so future spec authors copy the pattern.

**Fallback if flake remains:** add a `useHydrated()` hook to the root layout that sets `data-hydrated="true"` on mount; specs wait for `[data-hydrated="true"]`. Not done in v1 — only if T2 spec proves flaky in practice.

### IPC override pattern — keep as-is

The existing `app.evaluate(({ipcMain}, map) => { ipcMain.removeHandler('...'); ipcMain.handle('...', ...); }, map)` pattern is the right shape and the only reliable way (electron-playwright-helpers 2.1.0 doesn't ship a typed `ipcMainHandle` replacement). T1 just adds 4 more such blocks.

### Save dialog stubbing — `electron-playwright-helpers`

Phase 2.2c Export calls `dialog.showSaveDialog`. T7's questionnaire spec uses:

```ts
import { stubDialog } from 'electron-playwright-helpers';
await stubDialog(app, 'showSaveDialog', {
  canceled: false,
  filePath: join(tempUserDataDir, 'exported.xlsx'),
});
```

After Export, spec asserts the file exists on disk via `node:fs`.

### Fixtures

| Fixture | Location | Source |
|---|---|---|
| Phase 1 stage PDFs (5 files) | `tests/e2e/fixtures/` | Already exist from `28c778e` (Chrome-rendered HTML→PDF synthetic fixtures) |
| Phase 2 questionnaire .xlsx | `tests/e2e/fixtures/questionnaire-sample.xlsx` | New — synthesize with `ExcelJS` in a generator script OR commit a small hand-built one |

The questionnaire fixture only needs 2-3 question rows with detectable headers — minimal viable for "Q/A cell extraction". A 15 KB .xlsx is fine to commit.

## Component design

### Per-stage spec (T2 — 5 files)

Each Phase 1 stage spec is ~80 LOC following the shape from the May 14 spec sketch. Differences across stages are confined to:
- Which fixture PDF is uploaded
- Which stage option is selected in the wizard
- Which fields are asserted visible in ExtractionReview
- Which "for this document" recommendation text appears

A shared helper in `_setup.ts` — `runConfirmFlow(window, opts)` — could absorb most of this. We do NOT extract one in v1; per-spec inline keeps each test readable in isolation.

### Questionnaire spec (T3)

Drives `/questionnaires/new` → upload → wait for parsing → click into the detail route → AnswerReviewCard "Generate answer" → edit value → "Save & finalize" → "Export to Excel" → assert file written → assert status badge shows "exported".

IPC overrides used: `answer:generate`, `questionnaire:get-by-id` (for the post-finalize state read).

### Bulk + routing spec (T4)

Drives the same upload → extract path, then:
1. Click "Generate all unanswered" → mocked IPC returns 3 successes 1 failure → toast asserts "3 answered, 1 failed".
2. Open a freight extraction with `origin/destination` filled, `distance_km` null → click "Look up distance" → mocked routing IPC returns 1085 km + AMap source → assert `distance_km` field shows 1085.

### Configuration

`playwright.config.ts` (exists) — verify it has:
- `testDir: 'tests/e2e'`
- `timeout: 60_000`
- `workers: 1` (Electron app instances aren't parallel-safe by default — sharing user-data dirs would corrupt SQLite)
- `retries: 1` (one retry on flake; if a spec needs more it's broken)
- `use: { trace: 'on-first-retry', screenshot: 'only-on-failure' }`

T1 adjusts the config if anything is missing.

## Risk + safety net

**Risk 1 — TanStack Router hydration flake.** Mitigated by the locator-wait policy. If T2's first spec is flaky on >2 of 5 sequential runs, add the renderer-side `useHydrated` hook (~5 LOC change).

**Risk 2 — native-binding ABI flip.** `test:e2e` script already builds (Electron ABI). After running e2e, `pnpm vitest` will fail until `pnpm rebuild better-sqlite3` for Node ABI. Documented in plan T0.

**Risk 3 — flake on first-run window paint.** Electron sometimes paints a blank window for ~1-2s on slow machines. The locator-wait absorbs it but if first-spec consistently takes >10s, raise per-spec timeout to 90s.

**Risk 4 — `app.close()` hang on macOS.** [Playwright #39248](https://github.com/microsoft/playwright/issues/39248) — leaky IPC handlers cause hangs on Linux/Windows. Our pattern (`removeHandler` then `handle`) sidesteps it. macOS verified working at the unit level; if e2e hangs on close, fall back to `app.context().close()` then `app.close()` with a timeout race.

**Rollback:** All 5-7 new spec files + harness extension + config tweaks are revertable via `git revert`. Migration 014 is NOT needed (no schema changes).

## Test count + perf budget

- 7 new specs, each running for ~5-10s after warmup.
- Total suite ~45-70s. Within budget for local dev iteration.
- Vitest suite (532 tests) is unchanged. Two suites are mutually exclusive — different native ABIs.

## Expected end state

After this sub-project lands:

- `tests/e2e/{china-utility,fuel-receipt,freight,purchase,travel,questionnaire,bulk-routing}.spec.ts` — 7 spec files.
- `tests/e2e/_setup.ts` — extended `LaunchOpts` with 4-5 new optional canned fields.
- `tests/e2e/canned.ts` — extended with answer / bulk / routing / classification cans.
- `tests/e2e/fixtures/questionnaire-sample.xlsx` — new fixture.
- `playwright.config.ts` — verified policy values.
- `pnpm test:e2e` runs green locally; total time <90s.
- `docs/PHASE-1-SMOKE-MANUAL.md` updated with a header note: "Manual smoke superseded by `pnpm test:e2e`."

## Migration / cleanup

- `docs/PHASE-1-SMOKE-MANUAL.md` gets a deprecation banner at top.
- The 4-day-old `docs/specs/2026-05-14-playwright-e2e-design.md` stays for historical context; cross-link from this doc.
- No code that needs deleting.

## Out-of-scope follow-ups (recorded for future sub-projects)

- **CI integration** — GitHub Actions ubuntu-latest with Xvfb. Self-contained sub-project (~0.5 day).
- **Real-LLM opt-in** — `CARBONBOOK_E2E_REAL_LLM=1` to bypass IPC mocks and hit OpenAI on demand. Useful for occasional smoke against real models.
- **Visual regression** — Playwright snapshot tests for the AnswerReviewCard, ExtractionReview cards. Maintenance cost is real; defer until UI churn slows.
- **Phase 2 settings spec** — AMap key save flow, LLM provider key flow.
- **Phase 2 onboarding spec** — first-run org creation.
- **Phase 2 questionnaire list spec** — `/questionnaires` route's CRUD operations.
- **Cancellation UX for bulk** — when we add a "Stop" button to `Generate all`, this spec exists.

## Notes on Effect TS

E2E specs don't see Effect — the IPC boundary's `Effect.runPromise` already runs in main, the renderer sees plain Promises. Mocking `answer:generate` / `answer:generate-all-unanswered` at the IPC channel level is the natural seam regardless of Effect inside. The Effect adoption work doesn't change this design.
