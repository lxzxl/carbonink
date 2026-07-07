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
    // Capture: AI provider section. The default landing is now "General"
    // (matches macOS / Windows / iOS Settings conventions where the first
    // section is global prefs — language + theme), so we have to click
    // the AI rail button explicitly to screenshot it. Use the same nav
    // role + button filter pattern the License/General/About sections
    // below already use.
    // -----------------------------------------------------------------------
    const railButtons = nav.getByRole('button');
    const count = await railButtons.count();
    expect(count).toBeGreaterThanOrEqual(6);

    const aiBtnTop = railButtons.filter({ hasText: /ai|llm/i }).first();
    await aiBtnTop.click();
    await window
      .getByText(/openai|api 密钥|api key/i)
      .first()
      .waitFor({ state: 'visible', timeout: 5_000 });
    await window.screenshot({
      path: join(SCREENSHOT_DIR, 'settings-ai-provider.png'),
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

    // -----------------------------------------------------------------------
    // Capture: General section (Phase 5.1 — language switcher)
    // -----------------------------------------------------------------------
    const generalBtn = railButtons.filter({ hasText: /general|通用/i }).first();
    await generalBtn.click();
    await window
      .getByText(/display language|界面语言/i)
      .first()
      .waitFor({ state: 'visible', timeout: 5_000 });
    await window.screenshot({
      path: join(SCREENSHOT_DIR, 'settings-general.png'),
      fullPage: false,
    });

    // -----------------------------------------------------------------------
    // Capture: About section (Phase 5.1 — version + data folder)
    // -----------------------------------------------------------------------
    const aboutBtn = railButtons.filter({ hasText: /about|关于/i }).first();
    await aboutBtn.click();
    await window
      .getByText(/electron|chromium/i)
      .first()
      .waitFor({ state: 'visible', timeout: 5_000 });
    await window.screenshot({
      path: join(SCREENSHOT_DIR, 'settings-about.png'),
      fullPage: false,
    });

    // -----------------------------------------------------------------------
    // Interaction: provider combobox type-to-search. The picker is a
    // Popover + cmdk combobox over pi-ai's real bundled catalog (the
    // list-providers/list-models IPC is NOT mocked by launchApp), so this
    // exercises the actual 32-provider list. Runs last so the form-state
    // change doesn't bleed into the canonical screenshots above.
    // -----------------------------------------------------------------------
    const aiBtnAgain = railButtons.filter({ hasText: /ai|llm/i }).first();
    await aiBtnAgain.click();
    const providerTrigger = window.locator('#settings-provider');
    await providerTrigger.waitFor({ state: 'visible', timeout: 5_000 });
    await expect(providerTrigger).toContainText('openai');
    await providerTrigger.click();

    const searchInput = window.getByPlaceholder(/search providers|搜索服务商/i);
    await searchInput.waitFor({ state: 'visible', timeout: 5_000 });
    await searchInput.fill('kimi');

    // Filtering narrows the 32-provider list to the single fuzzy match.
    const kimiOption = window.getByRole('option', { name: /kimi-coding/ });
    await kimiOption.waitFor({ state: 'visible', timeout: 5_000 });
    await expect(window.getByRole('option')).toHaveCount(1);
    await window.screenshot({
      path: join(SCREENSHOT_DIR, 'settings-ai-provider-search.png'),
      fullPage: false,
    });

    // Selecting closes the popover and lands the id in the trigger.
    await kimiOption.click();
    await expect(providerTrigger).toContainText('kimi-coding');

    // -----------------------------------------------------------------------
    // Interaction: model combobox custom-id escape hatch. The bundled
    // catalog lags live provider lists, so typing an id it doesn't know
    // must offer a "use verbatim" row instead of a dead end.
    // -----------------------------------------------------------------------
    const modelTrigger = window.locator('#settings-model');
    await modelTrigger.waitFor({ state: 'visible', timeout: 5_000 });
    // The provider switch auto-defaults the model from kimi-coding's real
    // catalog; wait for that to land so the picker is in a settled state.
    await expect(modelTrigger).not.toContainText(/select a model|请选择模型/i);
    await modelTrigger.click();

    const modelSearch = window.getByPlaceholder(/search models|搜索模型/i);
    await modelSearch.waitFor({ state: 'visible', timeout: 5_000 });
    await modelSearch.fill('tencent/hy3:free');

    const customRow = window.getByRole('option', { name: /tencent\/hy3:free/ });
    await customRow.waitFor({ state: 'visible', timeout: 5_000 });
    await window.screenshot({
      path: join(SCREENSHOT_DIR, 'settings-ai-model-custom.png'),
      fullPage: false,
    });

    await customRow.click();
    await expect(modelTrigger).toContainText('tencent/hy3:free');
    // The catalog-miss hint points at Test connection as the validation.
    await window
      .getByText(/custom id|自定义 id/i)
      .first()
      .waitFor({ state: 'visible', timeout: 5_000 });
  } finally {
    await teardown(setup);
  }
});
