import { join } from 'node:path';
import { openAppDb } from '@main/db/connection.js';
import { runMigrations } from '@main/db/migrate.js';
import { cleanupIpc, setupIpc } from '@main/ipc/setup.js';
import { runAutoBackupIfDue } from '@main/services/auto-backup-service.js';
import { installLogger } from '@main/services/logger-service.js';
import { initAutoUpdater } from '@main/updater/auto-updater.js';
import { app, BrowserWindow, Menu } from 'electron';
import { buildAppMenu } from './menu.js';
import { createMainWindow, getMainWindow } from './window.js';

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

  const dbPath = join(app.getPath('userData'), 'app.sqlite');
  const db = openAppDb(dbPath);
  runMigrations(db);

  setupIpc();

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
