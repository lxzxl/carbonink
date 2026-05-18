import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { launchApp, teardown } from './_setup.js';
import { CANNED } from './canned.js';

const FIXTURE_PATH = join(process.cwd(), 'tests/fixtures/smoke/01-utility-sample.pdf');

const FAKE_ORG = {
  id: 'org-e2e-1',
  name_zh: 'Test Org',
  name_en: null,
  industry: null,
  country_code: 'CN',
  boundary_kind: 'operational_control' as const,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const FAKE_PROVIDER = {
  provider: 'openai' as const,
  model: 'gpt-4o-mini',
  apiKeyKeyref: 'llm.openai.apikey' as const,
  apiKeyMasked: '****',
};

/**
 * Status: DEFERRED. The harness extensions (defer-window hook, cannedOrg,
 * cannedProvider, renderer console listener) are landed. Title check passes
 * with this setup. What blocks the full Confirm flow is that the renderer
 * never paints content into `<div id="root">` when launched under
 * Playwright with these mocks — `body.innerHTML` stays empty past 3s and
 * no `[renderer.*]` console events fire (suggesting the JS bundle either
 * hasn't executed yet or is suppressed somewhere we haven't traced).
 *
 * Two hypotheses worth investigating next session:
 *
 *   1. `app.firstWindow()` is returning a window whose webContents wasn't
 *      yet at the right URL. The defer-window hook creates the window with
 *      `loadURL`, but the timing relative to `firstWindow()` resolving may
 *      be off. Try `app.waitForEvent('window')` instead, or assert the URL
 *      is non-blank before any interaction.
 *
 *   2. The renderer bundle imports something that crashes synchronously
 *      under e2e (e.g. a module that reads `import.meta.env` or relies on
 *      a Vite dev-server feature). With `[renderer.pageerror]` listener
 *      armed in the harness and STILL no events firing, the JS may not
 *      even be reaching the entry — check the script's load via
 *      `page.route('**\\/index-*.js', ...)`.
 *
 * Once the renderer paints, the remaining work is mechanical:
 *
 *   - Stub `dialog.showOpenDialog` via `electron-playwright-helpers` for
 *     the upload flow (DocumentsUpload uses a hidden `<input type="file">`,
 *     so `setInputFiles()` should also work — pick one).
 *   - Mock `source:list-by-org` to return a fake emission source so the
 *     ActivityForm dropdown has something to pick.
 *   - Mock `activity:create` to return a fake row.
 *   - Drive Confirm flow: pick source → see recommendation → click EF →
 *     submit → assert dashboard.
 */
test.skip('china_utility.v1: upload appears in document list (DEFERRED)', async () => {
  const setup = await launchApp({
    cannedExtractions: { 'china_utility.v1': CANNED['china_utility.v1'].extraction },
    cannedRecommendations: {
      'china_utility.v1': CANNED['china_utility.v1'].recommendation,
    },
    cannedOrg: FAKE_ORG,
    cannedProvider: FAKE_PROVIDER,
  });
  const { window } = setup;

  try {
    await expect(window).toHaveTitle(/carbonbook/i);

    await window.locator('a[href="/documents"]').first().click();
    await window.getByRole('heading').first().waitFor();

    const fileInput = window.locator('input[type=file]').first();
    await fileInput.setInputFiles(FIXTURE_PATH);

    await window.getByText(/01-utility-sample\.pdf/i).waitFor({ timeout: 15_000 });
  } finally {
    await teardown(setup);
  }
});
