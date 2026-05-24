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
 */
test('tour: dashboard + 6 top-level routes', async () => {
  // org + provider live in the generic `cannedIpc` map rather than the
  // typed-strict `cannedOrg` / `cannedProvider` slots. The typed slots
  // require nominal-matching shapes (e.g. `boundary_kind` as a string-
  // literal union), which our JSON-flexible fixtures violate. The generic
  // map crosses the boundary as JSON and the renderer sees the same shape.
  const setup = await launchApp({
    cannedExtractions: {},
    cannedRecommendations: {},
    cannedIpc: baselineIpcMocks(),
  });

  try {
    const { window } = setup;
    await waitForReactMount(window);

    // -----------------------------------------------------------------------
    // Dashboard — default landing after `__router` initializes.
    // -----------------------------------------------------------------------
    await navigateTo(window, '/');
    await waitForRouteSettled(window);
    await snap(window, 'tour-01-dashboard', { fullPage: true });

    // -----------------------------------------------------------------------
    // /sources
    // -----------------------------------------------------------------------
    await navigateTo(window, '/sources');
    await waitForRouteSettled(window);
    await snap(window, 'tour-02-sources', { fullPage: true });

    // -----------------------------------------------------------------------
    // /activities
    // -----------------------------------------------------------------------
    await navigateTo(window, '/activities');
    await waitForRouteSettled(window);
    await snap(window, 'tour-03-activities', { fullPage: true });

    // -----------------------------------------------------------------------
    // /documents
    // -----------------------------------------------------------------------
    await navigateTo(window, '/documents');
    await waitForRouteSettled(window);
    await snap(window, 'tour-04-documents', { fullPage: true });

    // -----------------------------------------------------------------------
    // /questionnaires
    // -----------------------------------------------------------------------
    await navigateTo(window, '/questionnaires');
    await waitForRouteSettled(window);
    await snap(window, 'tour-05-questionnaires', { fullPage: true });

    // -----------------------------------------------------------------------
    // /audit
    // -----------------------------------------------------------------------
    await navigateTo(window, '/audit');
    await waitForRouteSettled(window);
    await snap(window, 'tour-06-audit', { fullPage: true });

    // -----------------------------------------------------------------------
    // /reports
    // -----------------------------------------------------------------------
    await navigateTo(window, '/reports');
    await waitForRouteSettled(window);
    await snap(window, 'tour-07-reports', { fullPage: true });
  } finally {
    await teardown(setup);
  }
});
