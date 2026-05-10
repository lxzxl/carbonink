import { join } from 'node:path';
import { openAppDb } from '@main/db/connection.js';
import { runMigrations } from '@main/db/migrate.js';
import { cleanupIpc, setupIpc } from '@main/ipc/setup.js';
import { app, BrowserWindow } from 'electron';
import { createMainWindow } from './window.js';

app.whenReady().then(() => {
  const dbPath = join(app.getPath('userData'), 'app.sqlite');
  const db = openAppDb(dbPath);
  runMigrations(db);

  setupIpc();
  createMainWindow();

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
