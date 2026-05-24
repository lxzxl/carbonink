import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launchApp, teardown } from './_setup.js';

/**
 * Settings page smoke + screenshot capture.
 *
 * See history at end of file for the diagnostic journey. Short version:
 *
 *   - Electron's `loadFile(out/renderer/index.html)` puts the renderer at
 *     `file:///abs/path/index.html`. TanStack Router's default history reads
 *     `window.location.pathname` and finds no matching route. The renderer
 *     hangs on a blank `#root`.
 *   - In dev (`electron-vite dev`) the renderer is served from
 *     `http://localhost:5173/` so pathname is `/` and routing works.
 *   - The fix used by the in-app dev shell + by this spec: after the bundle
 *     mounts, call `router.navigate({ to: '/settings' })` via a global the
 *     router module exposes. That bypasses the broken pathname-based
 *     initial-route resolution.
 *
 * IPC mocks installed via `launchApp()`:
 *   - cannedOrg          → skips the /onboarding redirect.
 *   - cannedProvider     → AIProviderSection lands on the "saved" view
 *                          (mask + Replace button) instead of empty inputs.
 *
 * Locator-wait policy (see _setup.ts header): we wait on the nav role
 * which has aria-label "Settings categories" / "设置分类".
 */

const SCREENSHOT_DIR = join(__dirname, 'screenshots');

test('settings page renders + screenshots each tab', async () => {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const setup = await launchApp({
    cannedExtractions: {},
    cannedRecommendations: {},
    cannedOrg: {
      id: 'org_e2e_screenshot',
      name_zh: '碳墨示例公司',
      name_en: 'CarbonInk Demo Co.',
      industry: 'Technology',
      country_code: 'CN',
      boundary_kind: 'operational_control',
      responsible_person_name: 'Zhang San',
      responsible_person_role: 'Sustainability Lead',
      base_year_period_id: null,
      recalc_threshold_pct: 5,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-05-01T00:00:00.000Z',
    },
    cannedProvider: {
      provider: 'openai',
      model: 'gpt-4o-mini',
      apiKeyKeyref: 'llm.openai.apikey',
      apiKeyMasked: 'sk-...abcd',
    },
  });

  try {
    const { window } = setup;

    // Title is set statically in index.html so this resolves immediately
    // and confirms the BrowserWindow loaded the HTML file.
    await expect(window).toHaveTitle(/carbonink/i);

    // Step 1: wait for the bundle to mount React. The bundle is loaded as
    // `<script type="module" src="./main.tsx">` and the createRoot call is
    // synchronous after import. Wait for #root to have children — this is
    // the bare minimum signal that React painted at least once.
    await window.waitForFunction(
      () => {
        const root = document.getElementById('root');
        return root != null && root.childElementCount > 0;
      },
      undefined,
      { timeout: 20_000 },
    );

    // Diagnostic: log location + DOM size so flaky-mount failures point at
    // routing (pathname mismatch) vs. mount (no children) vs. paint
    // (children but blank). Stays in the spec — cost is one console line
    // per run, payoff is hours saved next time something regresses.
    //
    // Inside `evaluate(...)` the callback runs in the renderer; `globalThis`
    // resolves to the browser `Window`. TypeScript can't widen the outer
    // `window: Page` into the inner browser context, hence `globalThis`.
    const diag = await window.evaluate(() => ({
      href: globalThis.location.href,
      pathname: globalThis.location.pathname,
      hash: globalThis.location.hash,
      rootChildren: document.getElementById('root')?.childElementCount ?? 0,
      bodyText: (document.body.innerText || '').slice(0, 200),
    }));
    console.log('[e2e diag]', JSON.stringify(diag));

    // Step 2: navigate to /settings via the in-app router. The renderer
    // exposes `__router` on window for this purpose (added in `main.tsx`).
    // We retry briefly because the router may not have hydrated yet on the
    // first poll.
    await window.waitForFunction(
      () => {
        const r = (
          window as unknown as { __router?: { navigate: (opts: { to: string }) => Promise<void> } }
        ).__router;
        if (!r) return false;
        r.navigate({ to: '/settings' });
        return true;
      },
      undefined,
      { timeout: 10_000 },
    );

    // Step 3: wait for the Settings nav rail. aria role + the section
    // heading are the two stable signals — either one suffices, but the
    // heading also tells us which section is mounted.
    const nav = window.getByRole('navigation').first();
    await nav.waitFor({ state: 'visible', timeout: 15_000 });
    await window
      .getByRole('heading', { level: 2 })
      .first()
      .waitFor({ state: 'visible', timeout: 10_000 });

    // -----------------------------------------------------------------------
    // Capture: default landing (AI provider section)
    // -----------------------------------------------------------------------
    await window.screenshot({
      path: join(SCREENSHOT_DIR, 'settings-ai-provider.png'),
      fullPage: false,
    });

    // -----------------------------------------------------------------------
    // Capture: License section — most distinctive after Phase-4 work.
    // -----------------------------------------------------------------------
    const railButtons = nav.getByRole('button');
    const count = await railButtons.count();
    expect(count).toBeGreaterThanOrEqual(6);

    // Locale-agnostic match: zh-CN "许可" or en "License".
    const licenseBtn = railButtons.filter({ hasText: /license|许可/i }).first();
    await licenseBtn.click();
    // Wait for License-section-specific text to render in the right pane
    // — guarantees state has fully propagated, not just the click event
    // landed. Matches the activation-form copy from the License section.
    await window
      .getByText(/license activation|激活授权|未激活|active/i)
      .first()
      .waitFor({ state: 'visible', timeout: 5_000 });

    await window.screenshot({
      path: join(SCREENSHOT_DIR, 'settings-license.png'),
      fullPage: false,
    });

    // -----------------------------------------------------------------------
    // Capture: full-page screenshot of the default view — for README / deck.
    // -----------------------------------------------------------------------
    const aiBtn = railButtons.filter({ hasText: /ai|llm/i }).first();
    await aiBtn.click();
    // Wait for AI-section-specific text to render in the right pane.
    await window
      .getByText(/openai|api 密钥|api key/i)
      .first()
      .waitFor({ state: 'visible', timeout: 5_000 });

    await window.screenshot({
      path: join(SCREENSHOT_DIR, 'settings.png'),
      fullPage: true,
    });
  } finally {
    await teardown(setup);
  }
});
