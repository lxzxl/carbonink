import { join } from 'node:path';
import { openAppDb } from '@main/db/connection.js';
import { runMigrations } from '@main/db/migrate.js';
import { cleanupIpc, setupIpc } from '@main/ipc/setup.js';
import { app, BrowserWindow } from 'electron';
import { createMainWindow } from './window.js';

// E2E test hook: honor a per-test temp userData dir if the env var is set.
// MUST run before any service reads `app.getPath('userData')`. Runs at
// module-load time so it precedes `app.whenReady`.
if (process.env.CARBONBOOK_TEST_USER_DATA_DIR) {
  app.setPath('userData', process.env.CARBONBOOK_TEST_USER_DATA_DIR);
}

app.whenReady().then(() => {
  const dbPath = join(app.getPath('userData'), 'app.sqlite');
  const db = openAppDb(dbPath);
  runMigrations(db);

  setupIpc();

  // E2E test hook: when `CARBONBOOK_E2E_DEFER_WINDOW=1`, defer opening the
  // window. The harness installs IPC mocks first, then invokes the captured
  // reference via `app.evaluate(() => globalThis.__e2eOpenWindow())`.
  // Avoids a race where the renderer's first IPC calls (org:has-any,
  // settings:get-provider) hit the real handlers before mocks are installed.
  if (process.env.CARBONBOOK_E2E_DEFER_WINDOW === '1') {
    (globalThis as unknown as { __e2eOpenWindow?: () => void }).__e2eOpenWindow =
      createMainWindow;
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
