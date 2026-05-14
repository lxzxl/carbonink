# Research: GUI smoke testing for the carbonbook Electron app

**Date:** 2026-05-14
**Question:** Can we automate the manual `phase-1d` GUI smoke (5 extraction stages × Confirm flow × recommender) — and if so, with what tooling?
**TL;DR:** Yes. **Playwright with its `_electron` API** is the right fit for carbonbook. Estimated effort: ~3-5 day setup task to land a working baseline that covers all 5 stages. The four real challenges are native-binding ABI, LLM mocking, file-dialog stubbing, and DB isolation between runs.

## The landscape in 2026

Spectron (the original Electron testing tool) has been deprecated since February 2022 — it can't keep up with current Electron major versions. Two production-grade alternatives remain, plus a custom-driver fallback:

| Tool | Status | Protocol | Run mode |
|---|---|---|---|
| **Playwright** with `_electron` | Stable but flagged "experimental" by Electron docs (in practice: widely used in production) | Chrome DevTools Protocol (CDP) | Launches Electron via `_electron.launch({ args })` |
| **WebdriverIO** + `wdio-electron-service` | Stable, billed as the spiritual successor to Spectron | WebDriver protocol (via Chromedriver bundled by `wdio-electron-service` for Electron ≥ 26) | Launches Electron via the WDIO config |
| **Custom CDP driver** | Maximum control, maximum work | Direct CDP via `puppeteer-core` or hand-rolled WS | You write `app.launch()` yourself |

The 2026 community consensus for new projects is **Playwright** unless you have a specific reason to need WebdriverIO (cloud grid integration, Cucumber/BDD requirement, an existing WDIO codebase). Playwright wins on:

- ~2-3× faster than the WebDriver-protocol-based WDIO because CDP avoids JSONWire round-trips.
- Built-in test runner — no separate orchestrator config.
- Auto-waiting `Locator` API, Trace Viewer, screenshots-on-failure by default.
- First-class TypeScript support.
- Single dependency (`@playwright/test`) rather than a service+plugin stack.

## Recommendation: Playwright

For carbonbook specifically:

- Codebase is already TypeScript end-to-end → Playwright's TS support pays off immediately.
- Test surface is small (5 stages × one Confirm flow each) → don't need WebdriverIO's enterprise features (BDD, cloud grids, Appium).
- Existing test runner is Vitest, which is similar enough to Playwright Test that the team won't have to learn two paradigms.
- Renderer is React/TanStack Router → Playwright's `getByRole`/`getByText`/`getByTestId` locators map cleanly onto our existing accessibility-friendly markup.
- We already use `happy-dom` for renderer unit tests; Playwright runs against real Chromium-in-Electron, so it actually verifies the layout/interactions we can't reach with happy-dom.

WebdriverIO would also work and isn't a bad choice — just more setup ceremony for a small test surface.

## Helper library: `electron-playwright-helpers`

The single dependency that turns base Playwright Electron testing from "doable but painful" into "ergonomic" is the community-maintained [`electron-playwright-helpers`](https://github.com/spaceagetv/electron-playwright-helpers) package. It fills four gaps that the base API leaves:

| Helper | Why we need it for carbonbook |
|---|---|
| `stubDialog(app, 'showOpenDialog', { filePaths: [...] })` | We need to upload PDFs without a human picking a file. Playwright cannot interact with native OS dialogs. |
| `ipcMainInvokeHandler(app, 'channel', payload)` / `ipcMainEmit` | Lets a test bypass the UI and exercise the main-process handler directly. Useful for setup (seed an extraction row) before driving the renderer. |
| `clickMenuItemById` | Not needed today (no menu bar in carbonbook) but free with the dep. |
| `retryUntilTruthy` | Wraps known flake on Electron 27+. We're on Electron 41 which is past 27, so we hit the same flake class. |

`@playwright/test` + `electron-playwright-helpers` is the canonical 2026 setup.

## Carbonbook-specific challenges

### 1. better-sqlite3 native binding ABI (already a recurring pain)

We've documented this elsewhere: `electron-rebuild` flips the better-sqlite3 binary between Node-ABI (for vitest) and Electron-ABI (for `pnpm dev`/`pnpm build`). The GUI test suite needs the **Electron-ABI** binary because it launches the real packaged app.

**Implications for the setup:**

- The Playwright suite must run after `pnpm build` (which calls `electron-rebuild` via `prebuild`).
- Running `pnpm vitest` after the Playwright suite will fail until we re-`rebuild` for Node.
- CI ordering matters: run vitest first (Node ABI), then build + Playwright (Electron ABI).
- A `pnpm test:e2e` script should depend on `pnpm build` and never share a step with vitest in the same shell.

Recovery snippet we already use:
```bash
rm node_modules/.pnpm/better-sqlite3@12.9.0/node_modules/better-sqlite3/build/Release/better_sqlite3.node && pnpm rebuild better-sqlite3
```

### 2. LLM mocking — can't hit real OpenAI

The recommender fires `gpt-4o-mini` on every Confirm flow. We can't burn budget on every CI run.

Three layers to mock at, ranked by preference:

1. **IPC boundary** (preferred). Override `ef:recommend` with `ipcMainEmit` / `ipcMainInvokeHandler` to return a fixed `{ recommended: [...], ranked_full: [...] }` blob. The renderer code path is untouched; we just replace the main-process response. `electron-playwright-helpers` exposes this directly.
2. **LLMClient** boundary. Use `electronApp.evaluate(({ app }) => ...)` to replace the LLM client method at runtime. More invasive.
3. **Network layer**. Use Playwright's `page.route()` to intercept the OpenAI API call. Doesn't work for our case — the LLM call happens in the main process, not the renderer, so `page.route` can't see it.

**Recommendation:** option 1 (IPC boundary). The test isn't trying to verify the LLM; it's verifying the renderer wires up correctly when given a fixed recommendation set.

### 3. PDF upload — file fixtures + dialog stubbing

The DocumentsUpload flow calls `dialog.showOpenDialog` (or an HTML `<input type="file">` — need to check). For each stage we need:

- A PDF fixture in `tests/fixtures/` named per stage (e.g., `fuel-receipt-sample.pdf`, `freight-sample.pdf`, etc.). We already have `tests/fixtures/two-page-text.pdf` from earlier work.
- `stubDialog(app, 'showOpenDialog', { filePaths: ['<absolute path to fixture>'], canceled: false })` before triggering the upload action.
- If the renderer uses `<input type="file">` instead, `page.locator('input[type=file]').setInputFiles('<path>')` is the Playwright-native way — no dialog stub needed.

Verify which path our DocumentsUpload component takes; the two approaches don't compose.

### 4. DB isolation — each test needs a fresh state

The app writes to `app.sqlite` in the user-data directory. Between test runs we either:

- **Delete the user-data dir before launch.** Playwright accepts an `env` arg to `_electron.launch()`; we set `ELECTRON_USER_DATA` (or whatever our main process reads) to a temp dir per test.
- **Use `--profile` style isolation.** Pass a custom `userDataDir` directly if Electron exposes it.

The temp-dir approach is the standard pattern; carbonbook's main bootstrap reads `app.getPath('userData')` so injecting a per-test temp dir requires either an env var (cleanest) or a CLI arg the main process parses (`--user-data-dir=...`).

A small main-process change may be needed: respect `process.env.CARBONBOOK_TEST_USER_DATA_DIR` if set, override `userData` accordingly. Cost: ~5 lines.

## Concrete setup sketch

What `pnpm test:e2e` would look like once landed:

```ts
// tests/e2e/fuel-receipt.spec.ts
import { test, expect, _electron, type ElectronApplication } from '@playwright/test';
import { stubDialog, ipcMainInvokeHandler } from 'electron-playwright-helpers';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

let app: ElectronApplication;
let tempUserData: string;

test.beforeEach(async () => {
  tempUserData = mkdtempSync(path.join(tmpdir(), 'carbonbook-e2e-'));
  app = await _electron.launch({
    args: [path.join(__dirname, '../../out/main/index.cjs')],
    env: {
      ...process.env,
      CARBONBOOK_TEST_USER_DATA_DIR: tempUserData,
      CARBONBOOK_TEST_FAKE_LLM: '1', // main-process flag to short-circuit recommend()
    },
  });
});

test.afterEach(async () => {
  await app.close();
});

test('fuel_receipt.v1: upload → extract → recommend → confirm', async () => {
  const window = await app.firstWindow();

  // Bypass onboarding by seeding the org via IPC.
  await ipcMainInvokeHandler(app, 'organization:create', { name: 'Test Org' });

  // Stub the file dialog so the upload action receives our fixture.
  await stubDialog(app, 'showOpenDialog', {
    filePaths: [path.join(__dirname, 'fixtures/fuel-receipt-sample.pdf')],
    canceled: false,
  });

  // Drive the upload UI.
  await window.getByRole('button', { name: /upload/i }).click();
  await window.getByRole('combobox', { name: /stage/i }).selectOption('fuel_receipt.v1');
  await window.getByRole('button', { name: /run extraction/i }).click();

  // Wait for the review page.
  await expect(window.getByText(/review/i)).toBeVisible({ timeout: 30_000 });

  // Pick an emission source.
  await window.getByLabel(/emission source/i).selectOption({ index: 0 });

  // Recommended section appears (LLM was IPC-mocked).
  await expect(window.getByText('为本单据推荐')).toBeVisible();
  await window.locator('input[type=radio]').first().check();

  await window.getByRole('button', { name: /confirm/i }).click();

  // Lands on dashboard with a new activity_data row.
  await expect(window).toHaveURL(/\/$/);
  await expect(window.getByText(/fuel-receipt-sample/)).toBeVisible();
});
```

The same shape × 4 more files (one per remaining stage). A shared `fixtures/` directory holds the 5 PDFs. The whole suite probably runs in 30-60 seconds locally once warm.

## Estimated effort

Rough cost to land a working baseline:

| Sub-task | Estimate |
|---|---|
| Install + configure `@playwright/test` + `electron-playwright-helpers` | 0.5 day |
| Main-process flag for test user-data dir + fake-LLM short-circuit | 0.5 day |
| Source 5 PDF fixtures (real ones from prior manual smoke or synthesize) | 0.5 day |
| Write 5 stage E2E specs (one per stage, shared scaffold) | 1 day |
| CI wiring (vitest → build → e2e, in that order) | 0.5 day |
| Flake debugging + retry tuning on Electron 41 | 0.5-1 day |
| **Total** | **3-4 days** |

That's a meaningful chunk but produces durable infrastructure — every future stage / EF Matcher change reuses the same harness.

## Open questions for follow-up

1. **DocumentsUpload mechanism**: Does it use Electron's `dialog.showOpenDialog` or an HTML `<input type="file">`? Determines whether `stubDialog` is needed.
2. **Test PDFs**: Do we have 5 representative PDFs (one per stage) we can commit as fixtures? If not, do we generate them, or capture real samples? Possible privacy concerns.
3. **CI provider**: GitHub Actions? Local-only for now? Playwright's CI examples assume the former.
4. **Headed vs headless**: Electron supports headless via `--ozone-platform=headless` on Linux; macOS/Windows need a display server (Xvfb in CI). Affects CI image choice.
5. **Snapshot testing**: Should we add visual regression snapshots for the "Recommended for this document" panel? Playwright has built-in support, but maintenance cost is real.

## Recommendation for the user

Given that:
- `phase-1d` is essentially blocked on the manual smoke.
- The manual smoke is a recurring tax — every Phase 2 sub-project will re-incur it.
- The current 415-test safety net catches almost everything EXCEPT the renderer ↔ preload ↔ main path.

I'd treat the E2E setup as its own sub-project (post `phase-1d`, since the GUI smoke can be done manually one time to unblock the tag). Plausible structure:

1. **Now (~30 min)**: do the manual smoke once, tag `phase-1d`, ship Phase 1.
2. **Phase 2 prep sub-project (~3-4 days)**: stand up Playwright + helpers + 5 stage specs + CI. After it lands, manual smoke is never needed again — every sub-project just runs `pnpm test:e2e`.

Doing it the other way (build E2E before tagging) would mean writing automation against an unverified-end-to-end app, which is the wrong order.

## Sources

- [Electron — Spectron deprecation notice](https://www.electronjs.org/blog/spectron-deprecation-notice)
- [Electron — Automated Testing (official docs)](https://www.electronjs.org/docs/latest/tutorial/automated-testing)
- [Playwright — Electron class API](https://playwright.dev/docs/api/class-electron)
- [WebdriverIO — Electron Service](https://webdriver.io/docs/wdio-electron-service/)
- [spaceagetv/electron-playwright-example](https://github.com/spaceagetv/electron-playwright-example) — canonical Playwright+Electron example
- [spaceagetv/electron-playwright-helpers](https://github.com/spaceagetv/electron-playwright-helpers) — the helper library
- [Simon Willison — Testing Electron apps with Playwright + GitHub Actions](https://til.simonwillison.net/electron/testing-electron-playwright) — CI integration walkthrough
- [BrowserStack — WebdriverIO vs Playwright 2026](https://www.browserstack.com/guide/webdriverio-vs-playwright-2026) — current-year framework comparison
