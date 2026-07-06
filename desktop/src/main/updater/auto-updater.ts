import { getMainWindow } from '@main/window.js';
import { app } from 'electron';
import type { UpdateInfo } from 'electron-updater';
import { autoUpdater } from 'electron-updater';

/**
 * Update status pushed to the renderer via IPC.
 */
export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string; releaseDate: string }
  // An update exists but this platform cannot auto-install it (macOS while
  // builds are ad-hoc signed) — the UI offers the website download instead.
  | { state: 'available-manual'; version: string; releaseDate: string }
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
 * - Windows: `autoDownload` + `autoInstallOnAppQuit` — full auto-update.
 * - macOS: notify-only (`available-manual` status, no download). See below.
 * - Update source is the GitHub Releases feed, via the embedded
 *   `app-update.yml` baked in by electron-builder (publish: github) at
 *   packaging time; no runtime URL config is needed here.
 *
 * In development (non-packaged), electron-updater throws because the
 * `app-update.yml` file isn't present and there's no valid code
 * signature. We short-circuit so dev runs don't crash.
 */
export function initAutoUpdater(): void {
  if (!app.isPackaged) return;

  // macOS cannot auto-INSTALL while releases are ad-hoc signed:
  // electron-updater hands the final swap to native Squirrel.Mac, which
  // validates the downloaded bundle against the running app's designated
  // requirement — an ad-hoc signature pins that requirement to the current
  // binary's cdhash, so a different version can never pass. (It would also
  // need a `zip` mac target; dmg alone can't feed Squirrel.) If real
  // Developer ID signing ever returns: flip this gate, add the zip target,
  // and upload *.zip/*.zip.blockmap in release.yml. Windows NSIS installs
  // fine unsigned, so it keeps the full flow.
  const canAutoInstall = process.platform !== 'darwin';

  autoUpdater.autoDownload = canAutoInstall;
  autoUpdater.autoInstallOnAppQuit = canAutoInstall;

  autoUpdater.on('checking-for-update', () => {
    setStatus({ state: 'checking' });
  });

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    setStatus({
      state: canAutoInstall ? 'available' : 'available-manual',
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
