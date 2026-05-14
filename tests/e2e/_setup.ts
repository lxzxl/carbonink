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
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron, type ElectronApplication, type Page } from '@playwright/test';
import type { Extraction, MatcherResult } from '../../src/shared/types.js';

export type StageE2ESetup = {
  app: ElectronApplication;
  window: Page;
  tempUserDataDir: string;
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
 */
export type LaunchOpts = {
  cannedExtractions: Record<string, Omit<Extraction, 'id' | 'document_id' | 'created_at'>>;
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
      CARBONBOOK_E2E: '1',
    },
  });

  // Wait for the app to be ready before installing IPC overrides.
  await app.evaluate(
    ({ app: electronApp }: typeof import('electron')) => electronApp.whenReady(),
  );

  // -------------------------------------------------------------------------
  // Override extraction:run
  //
  // We pass the response map as a JSON-serializable argument so it crosses the
  // playwright → Electron main-process boundary safely. The override removes
  // the real handler and replaces it with a function that looks up by stage_id.
  // -------------------------------------------------------------------------
  type ExtractionMap = Record<string, Record<string, unknown>>;
  const extractionMap: ExtractionMap = opts.cannedExtractions as ExtractionMap;

  await app.evaluate(
    (
      { ipcMain }: typeof import('electron'),
      map: ExtractionMap,
    ) => {
      ipcMain.removeHandler('extraction:run');
      ipcMain.handle(
        'extraction:run',
        (_event, input: { document_id: string; stage_id: string }) => {
          const canned = map[input.stage_id];
          if (!canned) {
            throw new Error(
              `[e2e harness] No canned extraction for stage_id "${input.stage_id}"`,
            );
          }
          return {
            ...canned,
            id: `ext-${input.stage_id}-mock`,
            document_id: input.document_id,
            created_at: new Date().toISOString(),
          };
        },
      );
    },
    extractionMap,
  );

  // -------------------------------------------------------------------------
  // Override ef:recommend
  //
  // Decodes the stage_id from the mock extraction_id (format: ext-<stage>-mock)
  // then returns the corresponding canned MatcherResult.
  // -------------------------------------------------------------------------
  type RecommendMap = Record<string, unknown>;
  const recommendMap: RecommendMap = opts.cannedRecommendations as RecommendMap;

  await app.evaluate(
    (
      { ipcMain }: typeof import('electron'),
      map: RecommendMap,
    ) => {
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
            throw new Error(
              `[e2e harness] No canned recommendation for stage_id "${stageId}"`,
            );
          }
          return canned;
        },
      );
    },
    recommendMap,
  );

  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');

  return { app, window, tempUserDataDir };
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
