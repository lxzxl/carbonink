import { test } from '@playwright/test';
import { launchApp, teardown } from './_setup.js';
import { baselineIpcMocks } from './fixtures.js';
import { navigateTo, snap, waitForReactMount, waitForRouteSettled } from './helpers.js';

/**
 * Tour spec — visits every top-level route with realistic canned data and
 * captures a screenshot of each. Single test on purpose: re-launching the
 * Electron app is the expensive part (~1.5s per launch); inside one launch
 * we can hit ~8 routes in <10s by just changing the router target.
 *
 * Coverage:
 *   /              dashboard (KPI cards + trend chart + recent activities)
 *   /sources       emission-source catalog with per-source stats
 *   /activities    activity-data table for the current reporting period
 *   /documents     uploaded source files + per-row extraction badge
 *   /questionnaires customer questionnaire list
 *   /audit         audit-event log
 *   /reports       reports index (empty in fixture set)
 *   /settings      already covered by settings-page.spec.ts, skipped here
 *
 * What this spec deliberately does NOT cover:
 *   - Drawer / modal interactions (covered by per-scenario specs).
 *   - Detail routes (/documents/$id etc. — covered by stage specs).
 *   - Onboarding flow (separate spec — different launch options).
 *
 * Locale switching:
 *   Default run captures zh-CN screenshots:
 *     `tour-01-dashboard.png` ... `tour-07-reports.png`
 *
 *   Override via TOUR_LOCALE=en to capture English-UI versions:
 *     `tour-01-dashboard.en.png` ... `tour-07-reports.en.png`
 *
 *   The `.en` infix prevents zh and en outputs from clobbering each
 *   other when both runs use the same SCREENSHOT_DIR. Used by the
 *   cloud marketing site (`cloud/web/public/screenshots/en/`) — see
 *   that README for the file-mapping table.
 */

// Read once at module load. Validates the env-var input to the locale
// union the harness expects — any other value falls back to zh-CN with
// a console hint so a typo doesn't silently capture the wrong language.
const envLocale = (process.env.TOUR_LOCALE ?? '').toLowerCase();
const TOUR_LOCALE: 'zh-CN' | 'en' =
  envLocale === 'en' ? 'en' : envLocale === '' || envLocale === 'zh-cn' ? 'zh-CN' : 'zh-CN';
if (envLocale && envLocale !== 'en' && envLocale !== 'zh-cn') {
  console.warn(
    `[tour] TOUR_LOCALE="${process.env.TOUR_LOCALE}" not recognized; falling back to zh-CN. Valid values: 'zh-CN', 'en'.`,
  );
}

// Snap name suffix: '' for zh (back-compat with existing filenames) +
// '.en' for English so coexistence is possible.
const suffix = TOUR_LOCALE === 'en' ? '.en' : '';

test(`tour: dashboard + 6 top-level routes [${TOUR_LOCALE}]`, async () => {
  // org + provider live in the generic `cannedIpc` map rather than the
  // typed-strict `cannedOrg` / `cannedProvider` slots. The typed slots
  // require nominal-matching shapes (e.g. `boundary_kind` as a string-
  // literal union), which our JSON-flexible fixtures violate. The generic
  // map crosses the boundary as JSON and the renderer sees the same shape.
  const setup = await launchApp({
    cannedExtractions: {},
    cannedRecommendations: {},
    // baselineIpcMocks(locale) localizes user-data strings (source
    // names, activity notes, question text, person/role, address) to
    // match the renderer locale below. Without this, the EN tour would
    // render English UI chrome over Chinese demo data.
    cannedIpc: baselineIpcMocks(TOUR_LOCALE),
    locale: TOUR_LOCALE,
  });

  try {
    const { window } = setup;
    await waitForReactMount(window);

    // -----------------------------------------------------------------------
    // Dashboard — default landing after `__router` initializes.
    // -----------------------------------------------------------------------
    await navigateTo(window, '/');
    await waitForRouteSettled(window);
    await snap(window, `tour-01-dashboard${suffix}`, { fullPage: true });

    // -----------------------------------------------------------------------
    // /sources
    // -----------------------------------------------------------------------
    await navigateTo(window, '/sources');
    await waitForRouteSettled(window);
    await snap(window, `tour-02-sources${suffix}`, { fullPage: true });

    // -----------------------------------------------------------------------
    // /activities
    // -----------------------------------------------------------------------
    await navigateTo(window, '/activities');
    await waitForRouteSettled(window);
    await snap(window, `tour-03-activities${suffix}`, { fullPage: true });

    // -----------------------------------------------------------------------
    // /documents
    // -----------------------------------------------------------------------
    await navigateTo(window, '/documents');
    await waitForRouteSettled(window);
    await snap(window, `tour-04-documents${suffix}`, { fullPage: true });

    // -----------------------------------------------------------------------
    // /questionnaires
    // -----------------------------------------------------------------------
    await navigateTo(window, '/questionnaires');
    await waitForRouteSettled(window);
    await snap(window, `tour-05-questionnaires${suffix}`, { fullPage: true });

    // -----------------------------------------------------------------------
    // /audit
    // -----------------------------------------------------------------------
    await navigateTo(window, '/audit');
    await waitForRouteSettled(window);
    await snap(window, `tour-06-audit${suffix}`, { fullPage: true });

    // -----------------------------------------------------------------------
    // /reports
    // -----------------------------------------------------------------------
    await navigateTo(window, '/reports');
    await waitForRouteSettled(window);
    await snap(window, `tour-07-reports${suffix}`, { fullPage: true });
  } finally {
    await teardown(setup);
  }
});
