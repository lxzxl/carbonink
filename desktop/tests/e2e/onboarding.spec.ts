import { test } from '@playwright/test';
import { launchApp, teardown } from './_setup.js';
import { baselineIpcMocks } from './fixtures.js';
import { navigateTo, snap, waitForReactMount, waitForRouteSettled } from './helpers.js';

/**
 * Onboarding wizard snapshot.
 *
 * The dashboard root (/) redirects to /onboarding/$step when `org:has-any`
 * returns false. Captures each of the wizard's pages so future redesigns
 * can compare against a baseline.
 *
 * No org is provided (cannedOrg omitted) — that forces hasAny to return
 * the default (false from the empty SQLite), which triggers the
 * `<Navigate to="/onboarding/$step">` in `index.tsx`.
 *
 * Step labels match `src/renderer/routes/onboarding.$step.tsx`'s steps
 * — 1 (organization), 2 (site), 3 (reporting period).
 */
test('onboarding: 3-step wizard', async () => {
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

    for (const step of [1, 2, 3] as const) {
      await navigateTo(window, `/onboarding/${step}`);
      await waitForRouteSettled(window);
      await snap(window, `onboarding-step-${step}`, { fullPage: true });
    }
  } finally {
    await teardown(setup);
  }
});
