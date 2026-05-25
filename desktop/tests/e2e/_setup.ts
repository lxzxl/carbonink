/**
 * E2E test harness — shared launch + teardown helpers.
 *
 * NOTE on IPC overrides:
 *   electron-playwright-helpers 2.1.0 ships no `ipcMainHandle` export (it has
 *   `ipcMainInvokeHandler` for *calling* existing handlers, not *replacing*
 *   them). We use `app.evaluate()` directly — the handler logic runs inside the
 *   Electron main process; the response maps are passed as plain JSON so the
 *   structured-clone boundary is safe.
 *
 *   The `app.evaluate()` callback receives `typeof import('electron')` as its
 *   first parameter; we type the destructured fields explicitly to satisfy
 *   strict-mode inference.
 *
 * --- Locator-wait policy ---
 *
 * Specs MUST NOT call `page.waitForLoadState('networkidle' | 'domcontentloaded')`
 * as a sync barrier. TanStack Router hydration races make those flaky.
 *
 * Instead, every spec body starts with a stable-element wait:
 *
 *   await window.getByRole('heading', { name: /carbonink/i }).waitFor();
 *
 * Or the most-stable thing of all — the page title:
 *
 *   await expect(setup.window).toHaveTitle(/carbonink/i);
 *
 * Playwright's auto-wait absorbs hydration timing. If specs become flaky
 * despite this, the renderer fix is adding a `useHydrated()` hook to root
 * layout that sets `data-hydrated="true"`; specs then wait on
 * `[data-hydrated="true"]`. Out of scope for v1.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron, type ElectronApplication, type Page } from '@playwright/test';
import { stubDialog } from 'electron-playwright-helpers';
import type { Organization } from '../../src/shared/schemas/organization.js';
import type {
  Answer,
  ClassifyAndRunResult,
  Extraction,
  MatcherResult,
  ProviderConfig,
} from '../../src/shared/types.js';

export type StageE2ESetup = {
  app: ElectronApplication;
  window: Page;
  tempUserDataDir: string;
  /** Path the save dialog was stubbed to write, when `saveDialogFileName` was set. */
  savedFilePath?: string;
};

/**
 * Options for `launchApp()`.
 *
 * `cannedExtractions` are keyed by `stage_id` (the value the renderer passes
 * to `extraction:run`). The harness fills in `id`, `document_id`, and
 * `created_at` at mock-call time; all remaining required `Extraction` fields
 * must be supplied via the partial.
 *
 * `cannedRecommendations` are keyed by the same `stage_id` value; the harness
 * decodes the stage from the mock `extraction_id` it generated during
 * `extraction:run` (format: `ext-<stage_id>-mock`).
 *
 * Phase 2 fields (`cannedAnswers`, `cannedAllUnanswered`, `cannedRoutingLookup`,
 * `cannedClassification`, `saveDialogFileName`) are all optional. Phase 1
 * stage specs leave them unset.
 */
export type LaunchOpts = {
  cannedExtractions: Record<string, Omit<Extraction, 'id' | 'document_id' | 'created_at'>>;
  cannedRecommendations: Record<string, MatcherResult>;
  /** Keyed by question_id. Override response for `answer:generate`. */
  cannedAnswers?: Record<string, Answer>;
  /** Override response for `answer:generate-all-unanswered`. */
  cannedAllUnanswered?: Array<
    | { ok: true; result: { value: Answer } }
    | { ok: false; result: { error: { _tag: string; message: string } } }
  >;
  /** Override response for `routing:lookup`. Wrapped with `{ ok: true, ...result }` inside. */
  cannedRoutingLookup?: { distance_km: number; source: 'amap' | 'haversine'; cached: boolean };
  /** Override response for `extraction:classify-and-run`. */
  cannedClassification?: ClassifyAndRunResult;
  /** When set, `dialog.showSaveDialog` is stubbed to return `{tempUserDataDir}/{saveDialogFileName}`. */
  saveDialogFileName?: string;
  /**
   * When set, mocks `org:has-any` → true + `org:get-current` → org. Without
   * this, the dashboard redirects to /onboarding/1 on first paint.
   */
  cannedOrg?: Organization;
  /**
   * When set, mocks `settings:get-provider`. Without this, the /documents
   * page shows the "Provider Not Configured" banner instead of the upload UI.
   */
  cannedProvider?: ProviderConfig & { apiKeyMasked: string | null };
  /**
   * Free-form channel → static-response map. The harness installs each
   * entry as a fixed-value `ipcMain.handle(channel, () => value)` after
   * the typed mocks above. Use for screenshot-tour specs where many
   * channels need stub responses and adding each as a typed option to
   * `LaunchOpts` would balloon this type.
   *
   * The value must be JSON-serializable (it crosses the
   * playwright→Electron-main structured-clone boundary). Functions and
   * Promises are NOT supported — return the resolved value directly.
   */
  cannedIpc?: Record<string, unknown>;
  /**
   * Maps `document.id` → absolute path of a real PDF file to serve when
   * the renderer queries `document:read-bytes`. Needed for stage specs
   * + the screenshot tour — without it, the document review's
   * `<PdfPreview>` shows a red "PDF unavailable" fallback because the
   * fixture documents' `storage_path` is `/dev/null`.
   *
   * The harness reads the bytes at launch time (test-side fs) and
   * passes them as a JSON-serialized `number[]` to the main process,
   * which reconstructs `Uint8Array` before returning from the handler.
   * That dance is necessary because `cannedIpc`'s JSON.stringify path
   * mangles binary data and Uint8Array doesn't survive a JSON round
   * trip on its own.
   */
  pdfBytesByDocId?: Record<string, string>;
  /**
   * Renderer UI locale to pin for this launch. Defaults to `'zh-CN'` —
   * every existing spec keeps its current (zh) screenshot output.
   *
   * Setting `'en'` is the path to English-UI marketing screenshots —
   * exercised by `tour.spec.ts` when `TOUR_LOCALE=en` is in the env.
   * The pin happens in two spots (both required to win the race
   * against initLocale()):
   *
   *   1. `page.addInitScript` writes localStorage BEFORE the renderer
   *      bundle's top-level statements run.
   *   2. A post-`firstWindow` `evaluate` + `reload` writes localStorage
   *      AGAIN — addInitScript can register after the first paint
   *      depending on Playwright timing, so this is the belt-and-braces.
   *
   * Without both, `initLocale()` (src/renderer/lib/i18n.ts) falls
   * through to `navigator.language` (= `en-US` in Playwright) and the
   * renderer ends up half-translated for whichever side loses.
   */
  locale?: 'zh-CN' | 'en';
};

const MAIN_ENTRY = join(__dirname, '../../out/main/index.cjs');

export async function launchApp(opts: LaunchOpts): Promise<StageE2ESetup> {
  const tempUserDataDir = mkdtempSync(join(tmpdir(), 'carbonink-e2e-'));

  // Default to zh-CN — every existing spec was authored against that
  // locale and its snapshot assertions / screenshot baselines rely on
  // it. Specs opt into 'en' explicitly (see tour.spec.ts honoring
  // TOUR_LOCALE).
  const locale: 'zh-CN' | 'en' = opts.locale ?? 'zh-CN';

  const app = await _electron.launch({
    args: [MAIN_ENTRY],
    env: {
      ...process.env,
      CARBONINK_TEST_USER_DATA_DIR: tempUserDataDir,
      CARBONINK_E2E: '1',
      // Defer window creation until after we've installed IPC mocks. Without
      // this, the renderer's `org:has-any` etc. queries can race the mock
      // install. See src/main/index.ts for the corresponding handler.
      CARBONINK_E2E_DEFER_WINDOW: '1',
    },
  });

  // Attach renderer log listeners to any window the app creates — must be
  // wired before the window loads so we catch the bundle's first execution.
  app.on('window', (page) => {
    // Lock the renderer into `locale` BEFORE main.tsx runs. Without this,
    // `initLocale()` (src/renderer/lib/i18n.ts) reads `window.navigator.language`
    // which playwright defaults to `en-US`, so every screenshot renders
    // half-translated (Chinese content, English sidebar / footer chrome
    // — or the opposite when we're trying to capture EN screenshots).
    // `addInitScript` runs after preload but before the renderer bundle's
    // top-level statements, which is the exact seam initLocale needs.
    void page.addInitScript(
      (loc) => {
        try {
          // Bare `localStorage` (not `window.localStorage`) — TypeScript
          // would otherwise resolve `window` to the outer Playwright Page
          // variable. The script runs in the browser context where the
          // global is available unqualified.
          localStorage.setItem('carbonink.locale', loc);
        } catch {
          // localStorage can throw in some contexts (sandboxed iframe, file://
          // with disk-quota issues). Best-effort: fall through, the renderer's
          // navigator.language path stays as-is.
        }
      },
      locale,
    );
    page.on('console', (m) => console.log(`[renderer.${m.type()}]`, m.text()));
    page.on('pageerror', (e) => console.log('[renderer.pageerror]', e.message));
    page.on('crash', () => console.log('[renderer.crash]'));
    page.on('requestfailed', (req) =>
      console.log('[renderer.requestfailed]', req.url(), req.failure()?.errorText),
    );
  });

  // Wait for the app to be ready before installing IPC overrides.
  await app.evaluate(({ app: electronApp }: typeof import('electron')) => electronApp.whenReady());

  // -------------------------------------------------------------------------
  // Override extraction:run
  //
  // We pass the response map as a JSON-serializable argument so it crosses the
  // playwright → Electron main-process boundary safely. The override removes
  // the real handler and replaces it with a function that looks up by stage_id.
  // -------------------------------------------------------------------------
  type ExtractionMap = Record<string, Record<string, unknown>>;
  const extractionMap: ExtractionMap = opts.cannedExtractions as ExtractionMap;

  await app.evaluate(({ ipcMain }: typeof import('electron'), map: ExtractionMap) => {
    ipcMain.removeHandler('extraction:run');
    ipcMain.handle('extraction:run', (_event, input: { document_id: string; stage_id: string }) => {
      const canned = map[input.stage_id];
      if (!canned) {
        throw new Error(`[e2e harness] No canned extraction for stage_id "${input.stage_id}"`);
      }
      return {
        ...canned,
        id: `ext-${input.stage_id}-mock`,
        document_id: input.document_id,
        created_at: new Date().toISOString(),
      };
    });
  }, extractionMap);

  // -------------------------------------------------------------------------
  // Override ef:recommend
  //
  // Decodes the stage_id from the mock extraction_id (format: ext-<stage>-mock)
  // then returns the corresponding canned MatcherResult.
  // -------------------------------------------------------------------------
  type RecommendMap = Record<string, unknown>;
  const recommendMap: RecommendMap = opts.cannedRecommendations as RecommendMap;

  await app.evaluate(({ ipcMain }: typeof import('electron'), map: RecommendMap) => {
    ipcMain.removeHandler('ef:recommend');
    ipcMain.handle(
      'ef:recommend',
      (_event, input: { extraction_id: string; emission_source_id: string }) => {
        const match = /^ext-(.+?)-mock$/.exec(input.extraction_id);
        const stageId = match?.[1];
        if (!stageId) {
          throw new Error(
            `[e2e harness] Cannot parse stage_id from extraction_id: "${input.extraction_id}"`,
          );
        }
        const canned = map[stageId];
        if (!canned) {
          throw new Error(`[e2e harness] No canned recommendation for stage_id "${stageId}"`);
        }
        return canned;
      },
    );
  }, recommendMap);

  // -------------------------------------------------------------------------
  // Phase 2 IPC overrides (all optional)
  // -------------------------------------------------------------------------

  if (opts.cannedAnswers) {
    type AnswerMap = Record<string, Answer>;
    const map: AnswerMap = opts.cannedAnswers;
    await app.evaluate(({ ipcMain }: typeof import('electron'), m: AnswerMap) => {
      ipcMain.removeHandler('answer:generate');
      ipcMain.handle('answer:generate', (_event, input: { question_id: string }) => {
        const a = m[input.question_id];
        if (!a) {
          throw new Error(`[e2e harness] No canned answer for question_id "${input.question_id}"`);
        }
        return a;
      });
    }, map);
  }

  if (opts.cannedAllUnanswered) {
    const results = opts.cannedAllUnanswered;
    await app.evaluate(({ ipcMain }: typeof import('electron'), r) => {
      ipcMain.removeHandler('answer:generate-all-unanswered');
      ipcMain.handle('answer:generate-all-unanswered', () => r);
    }, results);
  }

  if (opts.cannedRoutingLookup) {
    const r = opts.cannedRoutingLookup;
    await app.evaluate(({ ipcMain }: typeof import('electron'), result) => {
      ipcMain.removeHandler('routing:lookup');
      ipcMain.handle('routing:lookup', () => ({ ok: true, ...result }));
    }, r);
  }

  if (opts.cannedClassification) {
    const c = opts.cannedClassification;
    await app.evaluate(({ ipcMain }: typeof import('electron'), classification) => {
      ipcMain.removeHandler('extraction:classify-and-run');
      ipcMain.handle('extraction:classify-and-run', () => classification);
    }, c);
  }

  if (opts.cannedOrg) {
    const org = opts.cannedOrg;
    await app.evaluate(({ ipcMain }: typeof import('electron'), o) => {
      ipcMain.removeHandler('org:has-any');
      ipcMain.handle('org:has-any', () => true);
      ipcMain.removeHandler('org:get-current');
      ipcMain.handle('org:get-current', () => o);
    }, org);
  }

  if (opts.cannedProvider) {
    const provider = opts.cannedProvider;
    await app.evaluate(({ ipcMain }: typeof import('electron'), p) => {
      ipcMain.removeHandler('settings:get-provider');
      ipcMain.handle('settings:get-provider', () => p);
    }, provider);
  }

  // -------------------------------------------------------------------------
  // Generic static-IPC mock map (channel → fixed return value)
  //
  // Installed last so it overrides any typed handler above with the same key.
  // The values are serialized to JSON to cross the playwright→Electron-main
  // boundary; complex objects are rebuilt on the main side via `JSON.parse`
  // (functions / class instances are not preserved).
  // -------------------------------------------------------------------------
  if (opts.cannedIpc) {
    const serialized = JSON.stringify(opts.cannedIpc);
    await app.evaluate(({ ipcMain }: typeof import('electron'), payload: string) => {
      const map = JSON.parse(payload) as Record<string, unknown>;
      for (const [channel, value] of Object.entries(map)) {
        try {
          ipcMain.removeHandler(channel);
        } catch {
          // No existing handler — that's fine.
        }
        ipcMain.handle(channel, () => value);
      }
    }, serialized);
  }

  // -------------------------------------------------------------------------
  // PDF bytes for `document:read-bytes` — install AFTER `cannedIpc` so a
  // spec that wants to override (rare — e.g. an "error state" snapshot
  // showing the unavailable fallback) can still set the channel via
  // `cannedIpc` and we don't clobber it.
  //
  // The serialized JSON is a `[docId, number[]][]` array of tuples; the
  // main side rebuilds a Map<string, Uint8Array> and the handler looks
  // up bytes by `input.id`. Electron's structured clone preserves
  // Uint8Array across the IPC reply, so the renderer's `bytesQuery.data`
  // arrives intact.
  // -------------------------------------------------------------------------
  if (opts.pdfBytesByDocId) {
    const entries: Array<[string, number[]]> = [];
    for (const [docId, filePath] of Object.entries(opts.pdfBytesByDocId)) {
      const buffer = readFileSync(filePath);
      entries.push([docId, Array.from(buffer)]);
    }
    const serialized = JSON.stringify(entries);
    await app.evaluate(({ ipcMain }: typeof import('electron'), payload: string) => {
      const tuples = JSON.parse(payload) as Array<[string, number[]]>;
      const bytesMap = new Map<string, Uint8Array>(
        tuples.map(([id, arr]) => [id, new Uint8Array(arr)]),
      );
      try {
        ipcMain.removeHandler('document:read-bytes');
      } catch {
        // No existing handler — that's fine.
      }
      ipcMain.handle('document:read-bytes', (_event, input: { id: string }) => {
        const bytes = bytesMap.get(input.id);
        if (!bytes) {
          throw new Error(`[e2e harness] No mocked PDF bytes for document_id "${input.id}"`);
        }
        return bytes;
      });
    }, serialized);
  }

  // -------------------------------------------------------------------------
  // Save dialog stub — Phase 2.2c export flow needs `dialog.showSaveDialog`.
  // -------------------------------------------------------------------------
  let savedFilePath: string | undefined;
  if (opts.saveDialogFileName) {
    savedFilePath = join(tempUserDataDir, opts.saveDialogFileName);
    await stubDialog(app, 'showSaveDialog', {
      canceled: false,
      filePath: savedFilePath,
    });
  }

  // All mocks installed — now open the window. The main process captured
  // `createMainWindow` on `globalThis.__e2eOpenWindow` when
  // `CARBONINK_E2E_DEFER_WINDOW=1`.
  await app.evaluate(() => {
    const g = globalThis as unknown as { __e2eOpenWindow?: () => void };
    g.__e2eOpenWindow?.();
  });

  const window = await app.firstWindow();
  // NOTE: no `waitForLoadState` here — the SPA's TanStack Router emits
  // continuous `commit` events during init/redirect and `domcontentloaded`
  // can't resolve cleanly. Specs use `locator.waitFor()` for hydration.

  // Belt-and-braces locale pin. The `addInitScript` registration in the
  // `app.on('window')` handler above can race the first page load —
  // by the time we register, the bundle has often already evaluated
  // `initLocale()` against the empty localStorage and committed to
  // navigator.language ("en-US" in playwright). Write the storage key
  // directly here, then reload — the second load picks up `locale`
  // deterministically.
  await window.evaluate(
    (loc) => {
      try {
        localStorage.setItem('carbonink.locale', loc);
      } catch {
        // ignore — best-effort
      }
    },
    locale,
  );
  await window.reload();

  const setup: StageE2ESetup = { app, window, tempUserDataDir };
  if (savedFilePath) setup.savedFilePath = savedFilePath;
  return setup;
}

export async function teardown(setup: StageE2ESetup): Promise<void> {
  try {
    await setup.app.close();
  } catch {
    // Ignore — app may already be closing.
  }
  try {
    rmSync(setup.tempUserDataDir, { recursive: true, force: true });
  } catch {
    // Ignore — best-effort cleanup.
  }
}
