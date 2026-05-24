import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * Resolve the app's sqlite path. Mirror Electron's `app.getPath('userData')`.
 * Override with CARBONINK_MCP_DB env var for testing.
 */
export function defaultDbPath(): string {
  if (process.env.CARBONINK_MCP_DB) return process.env.CARBONINK_MCP_DB;
  const home = homedir();
  if (process.platform === 'darwin') {
    return join(home, 'Library', 'Application Support', 'carbonink', 'app.sqlite');
  }
  if (process.platform === 'win32') {
    return join(
      process.env.APPDATA ?? join(home, 'AppData', 'Roaming'),
      'carbonink',
      'app.sqlite',
    );
  }
  return join(home, '.config', 'carbonink', 'app.sqlite');
}

export function openAppDb(path: string = defaultDbPath()): DatabaseSync {
  if (!existsSync(path)) {
    throw new Error(`carbonink DB not found at ${path}. Launch the app at least once.`);
  }
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}
