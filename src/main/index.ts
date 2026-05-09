import { join } from 'node:path';
import { openAppDb } from '@main/db/connection.js';
import { runMigrations } from '@main/db/migrate.js';
import { setupIpc } from '@main/ipc/setup.js';
import { BrowserWindow, app } from 'electron';
import { createMainWindow } from './window.js';

let mainWindow: BrowserWindow | null = null;

app.whenReady().then(() => {
  const dbPath = join(app.getPath('userData'), 'app.sqlite');
  const db = openAppDb(dbPath);
  runMigrations(db);

  mainWindow = createMainWindow();
  setupIpc(mainWindow);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
      if (mainWindow) setupIpc(mainWindow);
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
