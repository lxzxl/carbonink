import { expect, test } from '@playwright/test';
import { launchApp, teardown } from './_setup.js';

/**
 * Sanity smoke — validates the harness end-to-end before any feature spec.
 *
 * Uses the most stable selector available — the page <title>, which is in
 * `src/renderer/index.html` and renders synchronously regardless of route.
 * Does not depend on the onboarding redirect, the router being hydrated,
 * or any IPC having a canned response.
 */
test('app launches and home renders', async () => {
  const setup = await launchApp({
    cannedExtractions: {},
    cannedRecommendations: {},
  });
  try {
    await expect(setup.window).toHaveTitle(/carbonbook/i);
  } finally {
    await teardown(setup);
  }
});
