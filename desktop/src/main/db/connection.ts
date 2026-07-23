import Database, { type Database as DbInstance } from 'better-sqlite3';

let instance: DbInstance | null = null;
let instancePath: string | null = null;

/**
 * Opens (or returns the cached) SQLite connection at `path`.
 *
 * Per spec §3 关键约束 0:
 *   - PRAGMA foreign_keys = ON is forced; if it cannot be enabled, throw.
 *   - WAL journal mode is enabled for better concurrency.
 */
export function openAppDb(path: string): DbInstance {
  if (instance) return instance;
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const fkOn = db.pragma('foreign_keys', { simple: true });
  if (fkOn !== 1) {
    db.close();
    throw new Error(
      'SQLite foreign_keys could not be enabled — refusing to start. ' +
        'CarbonInk requires FK enforcement for data integrity (spec §3).',
    );
  }
  instance = db;
  instancePath = path;
  return db;
}

export function getAppDb(): DbInstance {
  if (!instance) throw new Error('App DB not opened — call openAppDb() first.');
  return instance;
}

/**
 * Absolute path of the database file the live connection was opened on.
 * With client workspaces (spec 2026-07-22) this is NOT always
 * `<userData>/app.sqlite` — any consumer that needs "the current db
 * file" (backup export/restore/reset) must read it from here instead of
 * hardcoding the pre-workspace filename.
 */
export function getAppDbPath(): string {
  if (!instance || instancePath === null) {
    throw new Error('App DB not opened — call openAppDb() first.');
  }
  return instancePath;
}

export function closeAppDb(): void {
  if (instance) {
    instance.close();
    instance = null;
    instancePath = null;
  }
}
