# Phase 5 — Launch Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bridge the gap between "all features work" and "ready for public download" — wire production signing keys, auto-updater, code-signing build pipeline, release automation, and a final pre-launch code sweep.

**Architecture:** Five workstreams that can proceed mostly in parallel:
1. Swap the dev Ed25519 public key for a production placeholder mechanism with a build-time guard that blocks accidental dev-key releases.
2. Integrate `electron-updater` into the main process + renderer Settings page for background + manual update checks.
3. Configure `electron-builder` for signed macOS `.dmg` + Windows `.exe` builds, with a GitHub Actions CI/CD workflow uploading artifacts to R2.
4. Automate release tagging + changelog generation.
5. Final sweep: TODO/FIXME cleanup, i18n completeness, full lint + typecheck + test pass.

**Tech Stack:** electron-builder, electron-updater, GitHub Actions, Apple Developer ID notarization, Windows EV code signing, Cloudflare R2, conventional-changelog.

**Baseline:** Current `package.json` version is `0.0.1-phase2a`. The app builds via `electron-vite build` but has no `electron-builder` config, no auto-updater, and no CI/CD pipeline. The dev Ed25519 public key is hardcoded in `src/main/services/license-public-key.ts`.

**Human-only prerequisites (NOT implementation tasks — must be completed before or in parallel by the human operator):**
- Apple Developer ID certificate enrolled + `.p12` exported (for macOS notarization)
- Windows EV code signing certificate procured + available in CI (e.g. Azure Key Vault, DigiCert ONE, or USB HSM + self-hosted runner)
- `carbonbook.app` domain registered + Cloudflare DNS configured
- R2 bucket created with public custom domain `r2.carbonbook.app`
- Stripe live mode products migrated + webhook secret in Worker secrets
- Production Ed25519 keypair generated offline; private key stored in Worker secrets (`LICENSE_PRIVATE_KEY_PEM`); public key hex string provided to Task 1
- GitHub repo secrets configured: `APPLE_ID`, `APPLE_ID_PASSWORD` (app-specific), `APPLE_TEAM_ID`, `CSC_LINK` (base64 `.p12`), `CSC_KEY_PASSWORD`, `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` (or Azure Key Vault secrets for cloud signing), `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`

**Discipline reminder for implementers:**
- Before final commit on each task, run `git status` and confirm there are NO uncommitted file changes besides the `.claude/` untracked dir.
- The project uses `biome` for linting/formatting and `vitest` for tests. Run `pnpm lint` and `pnpm test` before committing.
- i18n uses Paraglide (inlang). Messages live in `messages/en.json` and `messages/zh-CN.json`.
- IPC channels are typed in `src/main/ipc/types.ts`, allowlisted in `src/preload/bridge.ts`, handled in `src/main/ipc/handlers/`, and wrapped for the renderer in `src/renderer/lib/api/`.

---

## File Structure

**New files:**
- `src/main/updater/auto-updater.ts` — main-process auto-updater module (background check + manual trigger)
- `src/main/ipc/handlers/updater.ts` — IPC handlers for `updater:*` channels
- `src/renderer/lib/api/updater.ts` — renderer-side typed wrapper for updater IPC
- `src/renderer/components/UpdateSection.tsx` — Settings page "Updates" section UI
- `scripts/guard-prod-key.mjs` — build-time guard that fails if the dev placeholder key is still present
- `electron-builder.yml` — electron-builder configuration (signing, notarization, publish targets)
- `.github/workflows/release.yml` — CI/CD release workflow
- `scripts/upload-to-r2.mjs` — post-build script to upload artifacts to Cloudflare R2
- `tests/main/updater/auto-updater.test.ts` — unit tests for updater module

**Modified files:**
- `src/main/services/license-public-key.ts` — replace dev hex with `PROD_PUBLIC_KEY_PLACEHOLDER` constant
- `src/main/index.ts` — initialize auto-updater on app ready
- `src/main/ipc/types.ts` — add `updater:*` channel types
- `src/main/ipc/setup.ts` — register updater handlers
- `src/preload/bridge.ts` — allowlist `updater:*` channels
- `src/renderer/components/SettingsPage.tsx` — add `<UpdateSection />` below `<LicenseSection />`
- `package.json` — bump version to `1.0.0`, add `electron-builder` + `electron-updater` deps, add `dist:*` scripts
- `messages/en.json` — add `updater_*` i18n keys
- `messages/zh-CN.json` — add `updater_*` i18n keys

---

### Task 1: Production signing key swap + build-time guard

**Files:**
- Modify: `src/main/services/license-public-key.ts`
- Create: `scripts/guard-prod-key.mjs`
- Modify: `package.json` (add guard to build script)
- Test: `tests/main/services/license-public-key.test.ts` (existing — verify guard behavior)

The dev key hex `45137100977d34b17e6ae61ded3db7810215559157de81a0cdf4b6bcb49fb745` is currently hardcoded. We introduce a well-known placeholder pattern (`0000...0000`) that the build guard detects, and a mechanism to swap in the real production key. The actual production key hex is provided by the human operator (see prerequisites).

- [ ] **Step 1: Write the build-time guard script**

Create `scripts/guard-prod-key.mjs`:

```js
#!/usr/bin/env node
/**
 * Build-time guard: ensures the Ed25519 public key in
 * license-public-key.ts has been replaced with a real production key.
 * Exits non-zero if the placeholder is still present.
 *
 * Run as part of `pnpm dist:*` (distribution builds), NOT `pnpm build`
 * (dev builds need the dev key to work with issue-dev-license.mjs).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const keyFile = join(__dirname, '..', 'src', 'main', 'services', 'license-public-key.ts');
const content = readFileSync(keyFile, 'utf8');

// Match the hex constant declaration. The placeholder is 64 zeros.
const PLACEHOLDER = '0'.repeat(64);
// Also catch the dev key that ships in the repo for local testing.
const DEV_KEY = '45137100977d34b17e6ae61ded3db7810215559157de81a0cdf4b6bcb49fb745';

if (content.includes(PLACEHOLDER)) {
  process.stderr.write(
    '\n\x1b[31mERROR: license-public-key.ts still contains the all-zero placeholder.\n' +
      'Replace PUBLIC_KEY_HEX with the production Ed25519 public key before building a release.\x1b[0m\n\n',
  );
  process.exit(1);
}

if (content.includes(DEV_KEY)) {
  process.stderr.write(
    '\n\x1b[31mERROR: license-public-key.ts still contains the DEVELOPMENT key.\n' +
      'Replace PUBLIC_KEY_HEX with the production Ed25519 public key before building a release.\x1b[0m\n\n',
  );
  process.exit(1);
}

process.stderr.write('✓ Production public key guard passed.\n');
```

- [ ] **Step 2: Update the license-public-key.ts constant and its comment**

Replace the dev key with a placeholder constant in `src/main/services/license-public-key.ts`. The existing `loadLicensePublicKey()` already has an all-zero guard that throws at runtime. The constant name changes from `DEV_PUBLIC_KEY_HEX` to `PUBLIC_KEY_HEX` to reflect that it should hold the production key in release builds.

Update the file to:

```ts
import { publicKeyFromRawBytes } from './license-service.js';

/**
 * Ed25519 public key for verifying license JWTs.
 *
 * **BUILD-TIME SWAP TARGET** — the CI release workflow (or a local
 * `pnpm dist:mac` / `pnpm dist:win`) must replace the hex below with
 * the production public key before packaging. The guard script
 * `scripts/guard-prod-key.mjs` enforces this for distribution builds.
 *
 * For local development, `scripts/issue-dev-license.mjs` regenerates
 * a dev keypair and rewrites this constant; the matching private key
 * lives at `scripts/dev/license-keypair/private.pem`.
 *
 * Sanity guard: `loadLicensePublicKey()` throws if the hex is all-zero
 * so a release accidentally shipped with the placeholder is loud-failing
 * on first launch rather than silently accepting any forged JWT.
 */
const PUBLIC_KEY_HEX = '45137100977d34b17e6ae61ded3db7810215559157de81a0cdf4b6bcb49fb745';

export function loadLicensePublicKey() {
  if (/^0+$/.test(PUBLIC_KEY_HEX)) {
    throw new Error(
      'license public key not initialised — see src/main/services/license-public-key.ts',
    );
  }
  const bytes = Buffer.from(PUBLIC_KEY_HEX, 'hex');
  return publicKeyFromRawBytes(bytes);
}
```

The key stays as the dev key for now — the CI workflow will `sed`-replace it (see Task 4). The rename from `DEV_PUBLIC_KEY_HEX` to `PUBLIC_KEY_HEX` clarifies intent.

- [ ] **Step 3: Update the `issue-dev-license.mjs` script if it references the old constant name**

Search `scripts/issue-dev-license.mjs` for any reference to `DEV_PUBLIC_KEY_HEX`. If it writes the constant by name during key regeneration, update the reference to `PUBLIC_KEY_HEX`.

- [ ] **Step 4: Add the guard to distribution build scripts in package.json**

Add dist scripts to `package.json` that run the guard before electron-builder (the `electron-builder` dep and full config come in Task 3 — for now, just wire the guard):

```jsonc
// In "scripts":
"predist:mac": "node scripts/guard-prod-key.mjs",
"predist:win": "node scripts/guard-prod-key.mjs",
"dist:mac": "pnpm build && electron-builder --mac",
"dist:win": "pnpm build && electron-builder --win",
```

- [ ] **Step 5: Verify the guard works**

Run: `node scripts/guard-prod-key.mjs`

Expected: exits with code 1 and the message "still contains the DEVELOPMENT key" (because the dev key is present). This is correct — distribution builds should fail until the CI workflow swaps in the prod key.

- [ ] **Step 6: Verify existing tests still pass**

Run: `pnpm test`

Expected: all tests pass (the rename from `DEV_PUBLIC_KEY_HEX` to `PUBLIC_KEY_HEX` is internal to the module; no test imports it by name).

- [ ] **Step 7: Commit**

```bash
git add scripts/guard-prod-key.mjs src/main/services/license-public-key.ts package.json
git commit -m "feat(license): rename key constant + add build-time guard for production key swap"
```

---

### Task 2: Auto-updater integration (electron-updater)

**Files:**
- Create: `src/main/updater/auto-updater.ts`
- Create: `src/main/ipc/handlers/updater.ts`
- Modify: `src/main/ipc/types.ts` — add `updater:*` channels
- Modify: `src/main/ipc/setup.ts` — register updater handlers
- Modify: `src/preload/bridge.ts` — allowlist `updater:*` channels
- Create: `src/renderer/lib/api/updater.ts`
- Create: `src/renderer/components/UpdateSection.tsx`
- Modify: `src/renderer/components/SettingsPage.tsx` — add `<UpdateSection />`
- Modify: `messages/en.json` — add updater i18n keys
- Modify: `messages/zh-CN.json` — add updater i18n keys
- Create: `tests/main/updater/auto-updater.test.ts`

This task installs `electron-updater` and wires it into the main process + renderer. The updater checks for updates on launch (silent, non-blocking) and exposes a manual "Check for updates" button in Settings.

- [ ] **Step 1: Install electron-updater**

Run: `pnpm add electron-updater`

`electron-updater` is the standard auto-update library for electron-builder apps. It supports generic (S3/R2) update servers via `latest.yml` manifests.

- [ ] **Step 2: Write the auto-updater main-process module**

Create `src/main/updater/auto-updater.ts`:

```ts
import { app } from 'electron';
import type { UpdateInfo } from 'electron-updater';
import { autoUpdater } from 'electron-updater';
import { getMainWindow } from '../window.js';

/**
 * Update status pushed to the renderer via IPC.
 */
export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string; releaseDate: string }
  | { state: 'not-available' }
  | { state: 'downloading'; percent: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string };

let currentStatus: UpdateStatus = { state: 'idle' };

function setStatus(status: UpdateStatus) {
  currentStatus = status;
  const win = getMainWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send('updater:status', status);
  }
}

export function getUpdateStatus(): UpdateStatus {
  return currentStatus;
}

/**
 * Manually trigger an update check. Returns the current status after
 * initiating the check (the actual result arrives asynchronously via
 * the `updater:status` push channel).
 */
export function checkForUpdates(): void {
  autoUpdater.checkForUpdates().catch((err) => {
    setStatus({ state: 'error', message: err instanceof Error ? err.message : String(err) });
  });
}

/**
 * Install the downloaded update and restart the app.
 */
export function installUpdate(): void {
  autoUpdater.quitAndInstall(/* isSilent */ false, /* isForceRunAfter */ true);
}

/**
 * Initialize auto-updater. Call once from `app.whenReady()`.
 *
 * Configuration:
 * - `autoDownload: true` — download in background once found
 * - `autoInstallOnAppQuit: true` — install on next quit
 * - Update URL points to R2-hosted manifests
 */
export function initAutoUpdater(): void {
  // In development, electron-updater throws because there's no valid
  // code signature. Skip initialization entirely.
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  // Generic provider — electron-builder publishes latest.yml to R2.
  // The URL is configured in electron-builder.yml `publish` section.
  // electron-updater reads it from the embedded app-update.yml at build time,
  // so no runtime URL config is needed here.

  autoUpdater.on('checking-for-update', () => {
    setStatus({ state: 'checking' });
  });

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    setStatus({
      state: 'available',
      version: info.version,
      releaseDate: info.releaseDate ?? new Date().toISOString(),
    });
  });

  autoUpdater.on('update-not-available', () => {
    setStatus({ state: 'not-available' });
  });

  autoUpdater.on('download-progress', (progress) => {
    setStatus({ state: 'downloading', percent: Math.round(progress.percent) });
  });

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    setStatus({ state: 'downloaded', version: info.version });
  });

  autoUpdater.on('error', (err) => {
    setStatus({ state: 'error', message: err.message });
  });

  // Silent background check on launch. Delay by 10 seconds to avoid
  // blocking app startup with network I/O.
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {
      // Swallow — the error event handler above already sets status.
    });
  }, 10_000);
}
```

- [ ] **Step 3: Add updater IPC channel types**

Add to `src/main/ipc/types.ts`, inside the `IpcTypeMap`:

```ts
  // updater domain (Phase 5 — auto-update)
  'updater:get-status': () => import('@main/updater/auto-updater.js').UpdateStatus;
  'updater:check': () => void;
  'updater:install': () => void;
```

Add to `IpcPushTypeMap`:

```ts
  'updater:status': import('@main/updater/auto-updater.js').UpdateStatus;
```

- [ ] **Step 4: Write updater IPC handlers**

Create `src/main/ipc/handlers/updater.ts`:

```ts
import { checkForUpdates, getUpdateStatus, installUpdate } from '@main/updater/auto-updater.js';
import type { IpcTypeMap } from '../types.js';

export function updaterHandlers(): { [K in keyof IpcTypeMap]?: IpcTypeMap[K] } {
  return {
    'updater:get-status': () => getUpdateStatus(),
    'updater:check': () => checkForUpdates(),
    'updater:install': () => installUpdate(),
  };
}
```

- [ ] **Step 5: Register updater handlers in setup.ts**

In `src/main/ipc/setup.ts`, import `updaterHandlers` and spread them into the handler map alongside existing domains. Follow the same pattern used for `licenseHandlers` — updater handlers don't need the `IpcContext` since they call module-level functions.

- [ ] **Step 6: Allowlist updater channels in bridge.ts**

Add to `allowedChannels` in `src/preload/bridge.ts`:

```ts
  // updater domain (Phase 5 — auto-update)
  'updater:get-status',
  'updater:check',
  'updater:install',
```

Add to `allowedPushChannels`:

```ts
  'updater:status',
```

- [ ] **Step 7: Create renderer API wrapper**

Create `src/renderer/lib/api/updater.ts`:

```ts
import { invoke } from '../ipc.js';

export const updaterApi = {
  getStatus: () => invoke('updater:get-status'),
  check: () => invoke('updater:check'),
  install: () => invoke('updater:install'),
};
```

- [ ] **Step 8: Add i18n keys for the update UI**

Add to `messages/en.json`:

```json
"updater_section_heading": "Software Updates",
"updater_section_subheading": "Keep carbonbook up to date for the latest features and fixes.",
"updater_status_idle": "No update check performed yet.",
"updater_status_checking": "Checking for updates...",
"updater_status_available": "Version {version} is available.",
"updater_status_not_available": "You are running the latest version.",
"updater_status_downloading": "Downloading update... {percent}%",
"updater_status_downloaded": "Version {version} is ready to install. It will be applied on next restart.",
"updater_status_error": "Update check failed: {message}",
"updater_check_button": "Check for Updates",
"updater_install_button": "Restart & Update",
"updater_current_version": "Current version: {version}"
```

Add corresponding Chinese translations to `messages/zh-CN.json`:

```json
"updater_section_heading": "软件更新",
"updater_section_subheading": "保持 carbonbook 为最新版本，获取最新功能和修复。",
"updater_status_idle": "尚未检查更新。",
"updater_status_checking": "正在检查更新...",
"updater_status_available": "版本 {version} 可用。",
"updater_status_not_available": "当前已是最新版本。",
"updater_status_downloading": "正在下载更新... {percent}%",
"updater_status_downloaded": "版本 {version} 已准备就绪，将在下次重启时安装。",
"updater_status_error": "检查更新失败：{message}",
"updater_check_button": "检查更新",
"updater_install_button": "重启并更新",
"updater_current_version": "当前版本：{version}"
```

- [ ] **Step 9: Create the UpdateSection component**

Create `src/renderer/components/UpdateSection.tsx`:

```tsx
import { Button } from '@renderer/components/ui/button';
import { updaterApi } from '@renderer/lib/api/updater';
import { subscribe } from '@renderer/lib/ipc';
import * as m from '@renderer/paraglide/messages';
import type { UpdateStatus } from '@main/updater/auto-updater';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

/**
 * Settings page "Software Updates" section (Phase 5).
 *
 * Shows current app version, update status, and action buttons.
 * Subscribes to `updater:status` push events for real-time progress.
 */
export function UpdateSection() {
  const queryClient = useQueryClient();

  const statusQuery = useQuery({
    queryKey: ['updater:get-status'],
    queryFn: updaterApi.getStatus,
  });

  // Subscribe to push events and update the query cache in real-time.
  useEffect(() => {
    return subscribe('updater:status', (status) => {
      queryClient.setQueryData(['updater:get-status'], status);
    });
  }, [queryClient]);

  const check = useMutation({
    mutationFn: updaterApi.check,
  });

  const install = useMutation({
    mutationFn: updaterApi.install,
  });

  const status: UpdateStatus = statusQuery.data ?? { state: 'idle' };
  const version = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';

  return (
    <div className="border-t border-border pt-4 mt-2 space-y-3">
      <h3 className="text-sm font-medium">{m.updater_section_heading()}</h3>
      <p className="text-sm text-muted-foreground">{m.updater_section_subheading()}</p>

      <p className="text-xs text-muted-foreground">
        {m.updater_current_version({ version })}
      </p>

      <div className="rounded-md border border-border bg-secondary/30 p-3 text-sm">
        <StatusMessage status={status} />
      </div>

      <div className="flex gap-2">
        {(status.state === 'idle' ||
          status.state === 'not-available' ||
          status.state === 'error') && (
          <Button
            type="button"
            variant="outline"
            onClick={() => check.mutate()}
            disabled={check.isPending}
          >
            {m.updater_check_button()}
          </Button>
        )}

        {status.state === 'downloaded' && (
          <Button type="button" onClick={() => install.mutate()} disabled={install.isPending}>
            {m.updater_install_button()}
          </Button>
        )}
      </div>
    </div>
  );
}

function StatusMessage({ status }: { status: UpdateStatus }) {
  switch (status.state) {
    case 'idle':
      return <p className="text-muted-foreground">{m.updater_status_idle()}</p>;
    case 'checking':
      return <p className="text-muted-foreground">{m.updater_status_checking()}</p>;
    case 'available':
      return <p>{m.updater_status_available({ version: status.version })}</p>;
    case 'not-available':
      return <p className="text-muted-foreground">{m.updater_status_not_available()}</p>;
    case 'downloading':
      return <p>{m.updater_status_downloading({ percent: String(status.percent) })}</p>;
    case 'downloaded':
      return <p className="text-primary">{m.updater_status_downloaded({ version: status.version })}</p>;
    case 'error':
      return <p className="text-destructive">{m.updater_status_error({ message: status.message })}</p>;
  }
}
```

- [ ] **Step 10: Define `__APP_VERSION__` as a Vite global**

In `electron.vite.config.ts`, add a `define` block to the `renderer` section so the version is available at build time:

```ts
// Inside the renderer config:
define: {
  __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0'),
},
```

Also add a type declaration. Create or append to `src/renderer/env.d.ts`:

```ts
declare const __APP_VERSION__: string;
```

- [ ] **Step 11: Add UpdateSection to SettingsPage**

In `src/renderer/components/SettingsPage.tsx`, import and render `<UpdateSection />` below the existing `<LicenseSection />`:

```tsx
import { UpdateSection } from '@renderer/components/UpdateSection';
```

Add `<UpdateSection />` after `</LicenseSection>` (or at the bottom of the settings form, before the closing tag).

- [ ] **Step 12: Initialize auto-updater in main process**

In `src/main/index.ts`, import and call `initAutoUpdater()` inside the `app.whenReady()` callback, after `setupIpc()`:

```ts
import { initAutoUpdater } from '@main/updater/auto-updater.js';

// Inside app.whenReady().then(() => { ... }):
initAutoUpdater();
```

- [ ] **Step 13: Write unit tests for the updater module**

Create `tests/main/updater/auto-updater.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { UpdateStatus } from '@main/updater/auto-updater';

/**
 * The auto-updater module's core logic is thin (it delegates to
 * electron-updater which can't run outside Electron). We test the
 * type contract and status shape so future changes don't silently
 * break the renderer contract.
 */
describe('UpdateStatus type contract', () => {
  it('idle status has no extra fields', () => {
    const status: UpdateStatus = { state: 'idle' };
    expect(status.state).toBe('idle');
  });

  it('available status carries version + releaseDate', () => {
    const status: UpdateStatus = {
      state: 'available',
      version: '1.2.3',
      releaseDate: '2026-06-01T00:00:00Z',
    };
    expect(status.version).toBe('1.2.3');
    expect(status.releaseDate).toBeDefined();
  });

  it('downloading status carries percent', () => {
    const status: UpdateStatus = { state: 'downloading', percent: 42 };
    expect(status.percent).toBe(42);
  });

  it('error status carries message', () => {
    const status: UpdateStatus = { state: 'error', message: 'Network timeout' };
    expect(status.message).toBe('Network timeout');
  });
});
```

- [ ] **Step 14: Run lint + typecheck + tests**

Run: `pnpm lint && pnpm typecheck && pnpm test`

Expected: all pass. Fix any biome or type errors before proceeding.

- [ ] **Step 15: Commit**

```bash
git add src/main/updater/ src/main/ipc/handlers/updater.ts src/main/ipc/types.ts \
  src/main/ipc/setup.ts src/preload/bridge.ts src/renderer/lib/api/updater.ts \
  src/renderer/components/UpdateSection.tsx src/renderer/components/SettingsPage.tsx \
  src/main/index.ts electron.vite.config.ts messages/en.json messages/zh-CN.json \
  tests/main/updater/ src/renderer/env.d.ts
git commit -m "feat(updater): integrate electron-updater with Settings UI + background check on launch"
```

---

### Task 3: electron-builder configuration + code-signing

**Files:**
- Create: `electron-builder.yml`
- Modify: `package.json` — add electron-builder dep + `dist:*` scripts + productName/appId metadata

This task configures `electron-builder` to produce signed `.dmg` (macOS) and `.exe` (Windows) installers with notarization, and to publish update manifests to a generic (R2) server.

**Prerequisite:** Apple Developer ID certificate and Windows EV certificate must be available. The `dist:*` scripts will fail signing if the certs are not configured, but the builds will still produce unsigned artifacts for local testing.

- [ ] **Step 1: Install electron-builder as a dev dependency**

Run: `pnpm add -D electron-builder`

- [ ] **Step 2: Add app metadata to package.json**

Add these top-level fields to `package.json`:

```jsonc
"productName": "carbonbook",
"appId": "app.carbonbook.desktop",
"author": {
  "name": "Seneca ESG Limited",
  "email": "support@carbonbook.app"
},
```

Also ensure `"version"` is set to `1.0.0` (bump from `0.0.1-phase2a`).

- [ ] **Step 3: Create electron-builder.yml**

Create `electron-builder.yml` at the project root:

```yaml
# electron-builder configuration
# Docs: https://www.electron.build/configuration

appId: app.carbonbook.desktop
productName: carbonbook
copyright: Copyright © 2026 Seneca ESG Limited

directories:
  output: release
  buildResources: build

files:
  - out/**/*
  - "!out/main/**/*.map"
  - "!out/preload/**/*.map"
  - "!out/renderer/**/*.map"

# --- macOS ---
mac:
  category: public.app-category.business
  target:
    - target: dmg
      arch:
        - arm64
        - x64
  identity: null  # Set to Developer ID Application cert name in CI
  hardenedRuntime: true
  gatekeeperAssess: false
  entitlements: build/entitlements.mac.plist
  entitlementsInherit: build/entitlements.mac.plist
  notarize:
    teamId: ${env.APPLE_TEAM_ID}

dmg:
  sign: false
  contents:
    - x: 130
      y: 220
    - x: 410
      y: 220
      type: link
      path: /Applications

# --- Windows ---
win:
  target:
    - target: nsis
      arch:
        - x64
  # signtool or Azure Key Vault signing configured via env vars:
  # WIN_CSC_LINK + WIN_CSC_KEY_PASSWORD (pfx-based)
  # or azureSignOptions for cloud signing

nsis:
  oneClick: false
  perMachine: false
  allowToChangeInstallationDirectory: true
  deleteAppDataOnUninstall: false

# --- Auto-update publish target ---
publish:
  provider: generic
  url: https://r2.carbonbook.app/releases
  channel: stable

# --- electron-builder will look for these build resources ---
# build/
#   icon.icns        (macOS)
#   icon.ico         (Windows)
#   icon.png         (fallback)
#   entitlements.mac.plist
```

- [ ] **Step 4: Create macOS entitlements plist**

Create `build/entitlements.mac.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
  <key>com.apple.security.cs.allow-dyld-environment-variables</key>
  <true/>
  <key>com.apple.security.network.client</key>
  <true/>
  <key>com.apple.security.files.user-selected.read-write</key>
  <true/>
</dict>
</plist>
```

These entitlements are required for Electron apps to run under macOS Hardened Runtime (which is mandatory for notarization). The `network.client` entitlement allows outgoing network (for LLM API calls + update checks). The `files.user-selected.read-write` entitlement allows file open/save dialogs.

- [ ] **Step 5: Update dist scripts in package.json**

Update the `scripts` section (the `predist:*` guards were added in Task 1):

```jsonc
"dist:mac": "pnpm build && electron-builder --mac --publish never",
"dist:win": "pnpm build && electron-builder --win --publish never",
"dist:publish": "pnpm build && electron-builder --mac --win --publish always"
```

The `--publish never` variants are for local testing (no upload). The `--publish always` variant is for CI (uploads to the generic provider URL).

- [ ] **Step 6: Verify the build produces output (unsigned, local)**

Run: `pnpm dist:mac` (on macOS) or `pnpm dist:win` (on Windows).

Expected: The guard fails because the dev key is present (from Task 1). This is correct for distribution builds. To test the builder config without the guard, temporarily comment out `predist:mac` and run again. Verify that `release/` directory contains a `.dmg` or `.exe`.

Restore the `predist:mac` script after testing.

- [ ] **Step 7: Commit**

```bash
git add electron-builder.yml build/entitlements.mac.plist package.json
git commit -m "build: add electron-builder config with macOS notarization + Windows NSIS + R2 publish"
```

---

### Task 4: GitHub Actions release workflow + R2 upload

**Files:**
- Create: `.github/workflows/release.yml`
- Create: `scripts/upload-to-r2.mjs`

This task creates the CI/CD pipeline that builds signed artifacts and uploads them to R2 on git tag push. The workflow substitutes the production Ed25519 public key, runs the guard, builds + signs + notarizes, then uploads to R2.

- [ ] **Step 1: Create the release workflow**

Create `.github/workflows/release.yml`:

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

permissions:
  contents: write

jobs:
  build-mac:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Swap production public key
        env:
          PROD_PUBLIC_KEY_HEX: ${{ secrets.PROD_PUBLIC_KEY_HEX }}
        run: |
          # Replace the dev key with the production key in license-public-key.ts
          sed -i '' "s/45137100977d34b17e6ae61ded3db7810215559157de81a0cdf4b6bcb49fb745/${PROD_PUBLIC_KEY_HEX}/" \
            src/main/services/license-public-key.ts
          # Verify the guard passes
          node scripts/guard-prod-key.mjs

      - name: Set version from tag
        run: |
          VERSION=${GITHUB_REF_NAME#v}
          pnpm pkg set version="$VERSION"

      - name: Build + sign + notarize
        env:
          CSC_LINK: ${{ secrets.CSC_LINK }}
          CSC_KEY_PASSWORD: ${{ secrets.CSC_KEY_PASSWORD }}
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_ID_PASSWORD: ${{ secrets.APPLE_ID_PASSWORD }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
        run: pnpm build && pnpm exec electron-builder --mac --publish never

      - name: Upload to R2
        env:
          R2_ACCOUNT_ID: ${{ secrets.R2_ACCOUNT_ID }}
          R2_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
          R2_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
          R2_BUCKET_NAME: ${{ secrets.R2_BUCKET_NAME }}
        run: node scripts/upload-to-r2.mjs --platform darwin

      - name: Upload artifacts to GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          files: release/*.dmg
          draft: true

  build-win:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Swap production public key
        env:
          PROD_PUBLIC_KEY_HEX: ${{ secrets.PROD_PUBLIC_KEY_HEX }}
        shell: pwsh
        run: |
          $content = Get-Content src/main/services/license-public-key.ts -Raw
          $content = $content -replace '45137100977d34b17e6ae61ded3db7810215559157de81a0cdf4b6bcb49fb745', $env:PROD_PUBLIC_KEY_HEX
          Set-Content src/main/services/license-public-key.ts $content
          node scripts/guard-prod-key.mjs

      - name: Set version from tag
        shell: pwsh
        run: |
          $version = $env:GITHUB_REF_NAME -replace '^v', ''
          pnpm pkg set version="$version"

      - name: Build + sign
        env:
          WIN_CSC_LINK: ${{ secrets.WIN_CSC_LINK }}
          WIN_CSC_KEY_PASSWORD: ${{ secrets.WIN_CSC_KEY_PASSWORD }}
        run: pnpm build && pnpm exec electron-builder --win --publish never

      - name: Upload to R2
        env:
          R2_ACCOUNT_ID: ${{ secrets.R2_ACCOUNT_ID }}
          R2_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
          R2_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
          R2_BUCKET_NAME: ${{ secrets.R2_BUCKET_NAME }}
        run: node scripts/upload-to-r2.mjs --platform win32

      - name: Upload artifacts to GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          files: release/*.exe
          draft: true

  publish-release:
    needs: [build-mac, build-win]
    runs-on: ubuntu-latest
    steps:
      - name: Publish GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          draft: false
          generate_release_notes: true
```

- [ ] **Step 2: Create the R2 upload script**

Create `scripts/upload-to-r2.mjs`:

```js
#!/usr/bin/env node
/**
 * Upload electron-builder output to Cloudflare R2.
 *
 * Usage:
 *   node scripts/upload-to-r2.mjs --platform darwin
 *   node scripts/upload-to-r2.mjs --platform win32
 *
 * Uploads all files from `release/` that match the platform's expected
 * extensions, plus the `latest-*.yml` manifest files that electron-updater
 * reads.
 *
 * Required env vars:
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const releaseDir = join(__dirname, '..', 'release');

const platform = process.argv.includes('--platform')
  ? process.argv[process.argv.indexOf('--platform') + 1]
  : null;

if (!platform || !['darwin', 'win32'].includes(platform)) {
  process.stderr.write('Usage: node scripts/upload-to-r2.mjs --platform <darwin|win32>\n');
  process.exit(1);
}

const {
  R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_BUCKET_NAME,
} = process.env;

if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME) {
  process.stderr.write('ERROR: Missing R2_* environment variables.\n');
  process.exit(1);
}

const ENDPOINT = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;

// Determine which files to upload based on platform.
const extensions = platform === 'darwin'
  ? ['.dmg', '.zip', '.yml', '.yaml', '.blockmap']
  : ['.exe', '.yml', '.yaml', '.blockmap'];

const files = readdirSync(releaseDir).filter((f) => {
  const ext = f.slice(f.lastIndexOf('.'));
  return extensions.includes(ext) && statSync(join(releaseDir, f)).isFile();
});

if (files.length === 0) {
  process.stderr.write(`No uploadable files found in ${releaseDir} for platform ${platform}\n`);
  process.exit(1);
}

// Read version from package.json
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));
const version = pkg.version;

// Use the S3-compatible API via fetch with AWS Signature V4.
// For simplicity in a build script, we shell out to the AWS CLI which
// supports S3-compatible endpoints. It's pre-installed on GitHub runners.
import { execSync } from 'node:child_process';

for (const file of files) {
  const localPath = join(releaseDir, file);
  // latest.yml goes to releases/{platform}/ (no version prefix) so
  // electron-updater always finds it at a stable URL. Versioned files
  // go to releases/{platform}/{version}/.
  const isManifest = file.endsWith('.yml') || file.endsWith('.yaml');
  const r2Key = isManifest
    ? `releases/${platform}/${file}`
    : `releases/${platform}/${version}/${file}`;

  process.stderr.write(`Uploading ${file} → s3://${R2_BUCKET_NAME}/${r2Key}\n`);

  execSync(
    `aws s3 cp "${localPath}" "s3://${R2_BUCKET_NAME}/${r2Key}" --endpoint-url "${ENDPOINT}"`,
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        AWS_ACCESS_KEY_ID: R2_ACCESS_KEY_ID,
        AWS_SECRET_ACCESS_KEY: R2_SECRET_ACCESS_KEY,
        AWS_DEFAULT_REGION: 'auto',
      },
    },
  );
}

process.stderr.write(`\n✓ Uploaded ${files.length} files for ${platform} v${version}.\n`);
```

- [ ] **Step 3: Verify workflow syntax**

Run: `npx yaml-lint .github/workflows/release.yml` (or use any YAML linter).

Expected: valid YAML, no syntax errors.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/release.yml scripts/upload-to-r2.mjs
git commit -m "ci: add GitHub Actions release workflow with R2 upload + code signing"
```

---

### Task 5: Release tagging + changelog automation

**Files:**
- Modify: `package.json` — add `release` + `changelog` scripts
- Create: `.github/RELEASE_TEMPLATE.md`

This task establishes the release process: tag convention, changelog generation, and release notes template.

- [ ] **Step 1: Add changelog generation tooling**

Run: `pnpm add -D conventional-changelog-cli`

This generates changelogs from conventional commit messages (`feat:`, `fix:`, `build:`, etc.).

- [ ] **Step 2: Add release scripts to package.json**

Add to `scripts`:

```jsonc
"changelog": "conventional-changelog -p angular -i CHANGELOG.md -s",
"release": "pnpm version --no-git-tag-version"
```

The release workflow is:
1. Run `pnpm release <major|minor|patch>` to bump version in package.json
2. Run `pnpm changelog` to regenerate CHANGELOG.md
3. Commit: `git commit -am "chore: release v1.0.0"`
4. Tag: `git tag v1.0.0`
5. Push: `git push && git push --tags`
6. The CI workflow triggers on the tag push and handles the rest.

- [ ] **Step 3: Create the release notes template**

Create `.github/RELEASE_TEMPLATE.md`:

```markdown
## carbonbook v{version}

### Highlights

-

### What's New

{changelog}

### Downloads

| Platform | Download |
|----------|----------|
| macOS (Apple Silicon) | [carbonbook-{version}-arm64.dmg](https://r2.carbonbook.app/releases/darwin/{version}/carbonbook-{version}-arm64.dmg) |
| macOS (Intel) | [carbonbook-{version}-x64.dmg](https://r2.carbonbook.app/releases/darwin/{version}/carbonbook-{version}-x64.dmg) |
| Windows | [carbonbook-{version}-setup.exe](https://r2.carbonbook.app/releases/win32/{version}/carbonbook-{version}-setup.exe) |

### Auto-update

Existing installations will be notified automatically. Click "Restart & Update" when prompted, or go to **Settings → Software Updates → Check for Updates**.

### System Requirements

- macOS 12+ (Monterey or later)
- Windows 10+ (64-bit)
- 200 MB disk space
```

- [ ] **Step 4: Generate the initial CHANGELOG.md**

Run: `pnpm changelog`

Expected: `CHANGELOG.md` is created at the project root with entries from existing commits.

- [ ] **Step 5: Commit**

```bash
git add package.json CHANGELOG.md .github/RELEASE_TEMPLATE.md
git commit -m "build: add changelog generation + release notes template"
```

---

### Task 6: Final pre-launch sweep

**Files:**
- Various files across the codebase (cleanup pass)

This task is a systematic quality gate before tagging `v1.0.0`.

- [ ] **Step 1: Run full lint + typecheck + test suite**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test
```

Expected: all pass with zero errors and zero warnings. If any fail, fix them before proceeding.

- [ ] **Step 2: Scan for TODO/FIXME comments**

Run:

```bash
grep -rn 'TODO\|FIXME\|HACK\|XXX' src/ --include='*.ts' --include='*.tsx' | grep -v node_modules | grep -v '.test.'
```

For each result, decide:
- If it's a genuine pre-launch blocker: fix it now.
- If it's a future-work note that's still valid: reword to explicitly mention the version or phase it belongs to (e.g., "TODO(v1.1): ...") so it's clear it's intentionally deferred.
- If it's stale / already done: remove it.

- [ ] **Step 3: Verify i18n completeness**

Run:

```bash
node -e "
const en = require('./messages/en.json');
const zh = require('./messages/zh-CN.json');
const enKeys = new Set(Object.keys(en));
const zhKeys = new Set(Object.keys(zh));
const missingInZh = [...enKeys].filter(k => !zhKeys.has(k));
const missingInEn = [...zhKeys].filter(k => !enKeys.has(k));
if (missingInZh.length) console.log('Missing in zh-CN:', missingInZh);
if (missingInEn.length) console.log('Missing in en:', missingInEn);
if (!missingInZh.length && !missingInEn.length) console.log('All i18n keys aligned.');
"
```

Expected: "All i18n keys aligned." If any keys are missing, add them.

- [ ] **Step 4: Verify the app builds cleanly**

Run: `pnpm build`

Expected: exits 0, `out/` directory contains `main/index.cjs`, `preload/index.cjs`, `renderer/index.html`.

- [ ] **Step 5: Bump version to 1.0.0**

Run: `pnpm pkg set version="1.0.0"`

- [ ] **Step 6: Generate changelog**

Run: `pnpm changelog`

- [ ] **Step 7: Commit the release**

```bash
git add -A
git restore --staged .claude
git commit -m "chore: release v1.0.0"
```

- [ ] **Step 8: Tag the release**

```bash
git tag v1.0.0
```

Do NOT push the tag yet — the human operator pushes after the smoke tests in the Phase 5 checklist pass.
