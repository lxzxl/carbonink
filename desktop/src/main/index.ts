import { closeAppDb, openAppDb } from '@main/db/connection.js';
import { runMigrations } from '@main/db/migrate.js';
import { cleanupIpc, setupIpc } from '@main/ipc/setup.js';
import { runAutoBackupIfDue } from '@main/services/auto-backup-service.js';
import { installLogger } from '@main/services/logger-service.js';
import { notifyOverdueDisclosures } from '@main/services/overdue-notify-service.js';
import { WorkspaceService } from '@main/services/workspace-service.js';
import { initAutoUpdater } from '@main/updater/auto-updater.js';
import { configureWorkspaceSwitch } from '@main/workspace-switch.js';
import { app, BrowserWindow, Menu, nativeImage } from 'electron';
import { buildAppMenu } from './menu.js';
import { createMainWindow, devIconPath, getMainWindow } from './window.js';

// E2E test hook: honor a per-test temp userData dir if the env var is set.
// MUST run before any service reads `app.getPath('userData')`. Runs at
// module-load time so it precedes `app.whenReady`.
if (process.env.CARBONINK_TEST_USER_DATA_DIR) {
  app.setPath('userData', process.env.CARBONINK_TEST_USER_DATA_DIR);
}

app.whenReady().then(() => {
  // Phase 5.3: file logger has to install BEFORE anything else can
  // console.log/warn/error — otherwise startup-time output is lost.
  // Skipped in E2E so playwright's per-test temp dirs don't accumulate
  // log files (the dir is wiped on teardown anyway, but no log writing
  // also means slightly faster test launches).
  if (process.env.CARBONINK_E2E !== '1') {
    installLogger();
  }

  // macOS dev-mode Dock icon. In a packaged build the OS reads icon.icns
  // from the bundle's Contents/Resources — but in dev (no bundle) the
  // Dock falls back to the default Electron logo unless we override it
  // explicitly. BrowserWindow.icon is ignored on macOS, hence the
  // separate `app.dock.setIcon` call here.
  const devIcon = devIconPath();
  if (devIcon && process.platform === 'darwin') {
    app.dock?.setIcon(nativeImage.createFromPath(devIcon));
  }

  // Client workspaces (spec 2026-07-22): the registry decides which
  // SQLite file is active; first run bootstraps app.sqlite as 默认账套.
  const workspaceService = new WorkspaceService(app.getPath('userData'));
  const db = openAppDb(workspaceService.activeDbPath());
  runMigrations(db);

  setupIpc();

  // Wire the workspace-switch orchestration (reply → teardown → reopen →
  // rebuild IPC → reload renderer). Lives outside the IPC layer because
  // the switch disposes the very listener that dispatched it.
  configureWorkspaceSwitch({
    workspaceService,
    cleanupIpc,
    closeAppDb,
    openAppDb,
    runMigrations,
    setupIpc,
    reloadWindow: () => getMainWindow()?.webContents.reload(),
    schedule: (fn) => setTimeout(fn, 50),
  });

  // Post-launch (spec 2026-05-25): install the application menu so
  // ⌘Z / Ctrl+Z reach the renderer's undo handler. Skipped in E2E so
  // playwright doesn't have a real menu intercepting test keystrokes.
  if (process.env.CARBONINK_E2E !== '1') {
    Menu.setApplicationMenu(buildAppMenu(() => getMainWindow()));
  }

  // Phase 5 — wire electron-updater. No-ops in non-packaged dev runs
  // (gated inside initAutoUpdater) and fires a silent check 10s after
  // the renderer comes up.
  initAutoUpdater();

  // Phase 5.3: opportunistic auto-backup. Decides for itself whether
  // a backup is due (>23h since last) — safe to call every launch.
  // E2E skipped to avoid writing files into the test temp dir.
  //
  // User toggle: `setting` table key `auto_backup.enabled`. Defaults
  // to ENABLED (a row that doesn't exist or any value !== 'false' counts
  // as enabled) — most users get the safety net without needing to
  // discover the toggle. SettingsService.{get,set}AutoBackupEnabled
  // owns the canonical read/write; we duplicate the trivial lookup here
  // to avoid pulling SettingsService + CredentialService into the boot
  // path just to gate one feature flag.
  if (process.env.CARBONINK_E2E !== '1') {
    const row = db.prepare('SELECT value FROM setting WHERE key = ?').get('auto_backup.enabled') as
      | { value: string }
      | undefined;
    const enabled = row?.value !== 'false';
    if (enabled) runAutoBackupIfDue();
  }

  // ROADMAP §8.1-⑤ v2: one aggregate OS notification per local day when
  // inbound supplier disclosures are overdue. Decides for itself whether
  // it's due (setting `overdue_notify.last_notified_date`) — safe every
  // launch. E2E skipped so notifications never pop over test runs.
  if (process.env.CARBONINK_E2E !== '1') {
    notifyOverdueDisclosures(db);
  }

  // E2E test hook: when `CARBONINK_E2E_DEFER_WINDOW=1`, defer opening the
  // window. The harness installs IPC mocks first, then invokes the captured
  // reference via `app.evaluate(() => globalThis.__e2eOpenWindow())`.
  // Avoids a race where the renderer's first IPC calls (org:has-any,
  // settings:get-provider) hit the real handlers before mocks are installed.
  if (process.env.CARBONINK_E2E_DEFER_WINDOW === '1') {
    (globalThis as unknown as { __e2eOpenWindow?: () => void }).__e2eOpenWindow = createMainWindow;
  } else {
    createMainWindow();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  cleanupIpc();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
