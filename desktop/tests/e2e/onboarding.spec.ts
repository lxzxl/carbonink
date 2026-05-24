import { test } from '@playwright/test';
import { launchApp, teardown } from './_setup.js';
import { baselineIpcMocks } from './fixtures.js';
import { navigateTo, snap, waitForReactMount, waitForRouteSettled } from './helpers.js';

/**
 * Onboarding wizard snapshot.
 *
 * The dashboard root (/) redirects to /onboarding/$step when `org:has-any`
 * returns false. Captures each of the wizard's 5 pages so future redesigns
 * can compare against a baseline.
 *
 * Also exercises the chrome-strip in `__root.tsx` — during onboarding the
 * sidebar nav, header back/forward, and license chip are intentionally
 * suppressed (the user shouldn't be navigating elsewhere mid-wizard). The
 * snapshots verify visually that no chrome appears.
 *
 * No org is provided — that forces hasAny to return the default (false
 * from the empty SQLite), which triggers `<Navigate to="/onboarding/$step">`
 * in `index.tsx`.
 *
 * Steps (matches `src/renderer/routes/onboarding.$step.tsx`):
 *   1. Company info
 *   2. Reporting year
 *   3. Boundary (operational / financial / equity control)
 *   4. First site
 *   5. AI provider
 */
test('onboarding: 5-step wizard with chrome-strip', async () => {
  const setup = await launchApp({
    cannedExtractions: {},
    cannedRecommendations: {},
    cannedIpc: {
      ...baselineIpcMocks(),
      // Override the baseline org defaults — we want the wizard to think
      // no org exists, so it stays mounted on /onboarding/$step rather
      // than redirecting back to /.
      'org:has-any': false,
      'org:get-current': null,
      'org:list-sites': [],
      'org:list-reporting-periods': [],
    },
  });

  try {
    const { window } = setup;
    await waitForReactMount(window);

    for (const step of [1, 2, 3, 4, 5] as const) {
      await navigateTo(window, `/onboarding/${step}`);
      await waitForRouteSettled(window);
      await snap(window, `onboarding-step-${step}`, { fullPage: true });
    }
  } finally {
    await teardown(setup);
  }
});
