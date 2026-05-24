/**
 * E2E helpers — shared navigation + screenshot routines used by the tour
 * and per-scenario specs.
 *
 * These wrap the boilerplate of:
 *   1. Waiting for the bundle to mount React.
 *   2. Navigating via `window.__router` (exposed by `src/renderer/main.tsx`).
 *   3. Waiting for a route-specific stable marker before capturing.
 *
 * Keeping this thin — anything spec-specific lives in the spec, not here.
 */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page } from '@playwright/test';

export const SCREENSHOT_DIR = join(__dirname, 'screenshots');

export function ensureScreenshotDir(): void {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

/**
 * Wait for the React tree to paint into `#root`. Combines the static-title
 * check (proves index.html loaded) with a childElementCount poll (proves
 * `main.tsx` ran and `createRoot.render` committed at least once).
 */
export async function waitForReactMount(window: Page): Promise<void> {
  await expect(window).toHaveTitle(/carbonink/i);
  await window.waitForFunction(
    () => {
      const root = document.getElementById('root');
      return root != null && root.childElementCount > 0;
    },
    undefined,
    { timeout: 20_000 },
  );
}

/**
 * Drive a route change via the in-app router. `window.__router` is set up
 * by `src/renderer/main.tsx` specifically for this — bypasses the sidebar
 * (which has icon/collapsed-mode variants we don't want to thread through
 * tests) and avoids `window.location.href` mutations that would trigger
 * Electron file:// fetches.
 */
export async function navigateTo(window: Page, to: string): Promise<void> {
  await window.waitForFunction(
    (target) => {
      const r = (
        globalThis as unknown as {
          __router?: { navigate: (opts: { to: string }) => Promise<void> };
        }
      ).__router;
      if (!r) return false;
      r.navigate({ to: target });
      return true;
    },
    to,
    { timeout: 10_000 },
  );
}

/**
 * Take a screenshot under `tests/e2e/screenshots/<name>.png`. Wraps the
 * `mkdirSync` + path-join boilerplate so specs read clean.
 */
export async function snap(
  window: Page,
  name: string,
  opts: { fullPage?: boolean } = {},
): Promise<void> {
  ensureScreenshotDir();
  await window.screenshot({
    path: join(SCREENSHOT_DIR, `${name}.png`),
    fullPage: opts.fullPage ?? false,
  });
}

/**
 * Wait for any visible h1/h2 heading to render — a reasonable signal that
 * the current route's top-level component has mounted past its loading
 * state. Most routes render their title in a heading on first paint.
 *
 * Falls back to `waitForTimeout(400)` if no heading is present within the
 * brief window (audit/dashboard sometimes render KPI cards before the h1
 * settles); the 400ms keeps post-navigation transitions clean for
 * screenshots without forcing every spec to handle the edge cases.
 */
export async function waitForRouteSettled(window: Page): Promise<void> {
  try {
    await window.getByRole('heading').first().waitFor({ state: 'visible', timeout: 5_000 });
  } catch {
    // Route doesn't expose a heading immediately; let it settle anyway.
  }
  await window.waitForTimeout(400);
}
