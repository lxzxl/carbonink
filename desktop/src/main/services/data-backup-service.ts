import { copyFileSync, existsSync, openSync, readSync, statSync, unlinkSync } from 'node:fs';
import { closeAppDb, getAppDb } from '@main/db/connection.js';
import { app } from 'electron';

/**
 * DataBackupService — file-level export / import / reset for the
 * CarbonInk app database.
 *
 * Why a service module (vs. inline IPC handler code):
 *   - All three operations need careful lifecycle management around the
 *     better-sqlite3 connection: close → file op → reopen. Centralizing
 *     this here keeps the IPC layer thin.
 *   - Import validation (magic bytes + schema sanity) is non-trivial;
 *     bundling it with the file write avoids drift between "validation
 *     here" and "actual replacement there".
 *
 * Backup format:
 *   - Single SQLite file. We literally copy `app.sqlite` and recommend
 *     `.carbonink-backup` as the extension so the OS associates the
 *     file with CarbonInk (open-with menu), but `.sqlite` works too.
 *   - Restore validates the SQLite magic header bytes + checks for the
 *     `schema_migrations` table presence. Cross-version restores rely
 *     on the normal migration runner — older backups get auto-migrated
 *     up to the current schema on next launch.
 *   - Attachments (PDFs in `userData/documents/`) are NOT in this
 *     backup. They are user-uploaded files that can be re-uploaded
 *     after restore. v2 of this format will bundle them via tar.
 *
 * App relaunch (used by importFromFile + reset):
 *   - Electron's `app.relaunch()` + `app.quit()` is the canonical pattern.
 *     `relaunch` schedules a process start that fires after this process
 *     exits via `quit`. The IPC reply must be sent BEFORE quit, so the
 *     handler returns success first, then schedules.
 */

const SQLITE_MAGIC = Buffer.from('SQLite format 3\0', 'ascii');
const RELAUNCH_DELAY_MS = 250;

export class DataBackupService {
  /**
   * Copies the live `app.sqlite` to `targetPath`.
   *
   * Process:
   *   1. WAL-checkpoint to flush any pending writes from the WAL into
   *      the main database file (otherwise the copy would miss the most
   *      recent writes).
   *   2. Copy file with `copyFileSync` (synchronous is fine — the file
   *      is small and we're in main process where blocking briefly is
   *      acceptable for a user-triggered export).
   *   3. Returns the copied size so the UI can show "Saved N KB to ...".
   *
   * Connection stays open throughout. SQLite supports concurrent reads
   * via WAL; the copy reads the main file, the connection holds the
   * WAL pointer. Safe.
   */
  exportToFile(targetPath: string): { bytes_written: number } {
    const db = getAppDb();
    db.pragma('wal_checkpoint(TRUNCATE)');
    const dbPath = this.getDbPath();
    copyFileSync(dbPath, targetPath);
    const stats = statSync(targetPath);
    return { bytes_written: stats.size };
  }

  /**
   * Validates `sourcePath` is a CarbonInk-compatible backup, then
   * replaces the live `app.sqlite` and schedules an app relaunch.
   *
   * Validation:
   *   - File exists and is readable.
   *   - First 16 bytes match the SQLite magic header.
   *   - Opening it returns a valid db with at least one of our migration
   *     entries — confirming the schema_migrations table exists.
   *
   * On success the live connection is closed, the file is copied over
   * `app.sqlite`, and `app.relaunch() + app.quit()` is scheduled.
   * Migrations re-run on the next launch and pick up any schema upgrades
   * between the backup's version and current code.
   */
  importFromFile(sourcePath: string): { ok: true } | { ok: false; error: string } {
    if (!existsSync(sourcePath)) {
      return { ok: false, error: 'Backup file not found.' };
    }
    const validationError = this.validateBackup(sourcePath);
    if (validationError) {
      return { ok: false, error: validationError };
    }
    const dbPath = this.getDbPath();
    closeAppDb();
    // Best-effort: clean up WAL/SHM siblings before copying in the new
    // db. If they're stale, the next openAppDb call would mix them with
    // the new file and get inconsistent reads.
    for (const ext of ['-wal', '-shm']) {
      const sidecar = `${dbPath}${ext}`;
      if (existsSync(sidecar)) {
        try {
          unlinkSync(sidecar);
        } catch {
          // Best-effort cleanup; sqlite will recreate as needed.
        }
      }
    }
    copyFileSync(sourcePath, dbPath);
    this.scheduleRelaunch();
    return { ok: true };
  }

  /**
   * Deletes the live `app.sqlite` (and WAL/SHM siblings) and schedules
   * an app relaunch. On next launch, `openAppDb` creates a fresh file,
   * migrations run, and the dashboard's `org:has-any` returns false
   * → onboarding redirect.
   *
   * Does NOT clear the keychain — the license JWT stays for re-use on
   * the next onboarding completion. Users wanting a TRULY fresh start
   * also need to clear the license in Settings → License before reset
   * (or we can add a `keepLicense` flag later if this becomes a
   * common request).
   */
  reset(): void {
    const dbPath = this.getDbPath();
    closeAppDb();
    for (const ext of ['', '-wal', '-shm']) {
      const target = `${dbPath}${ext}`;
      if (existsSync(target)) {
        try {
          unlinkSync(target);
        } catch {
          // Continue with whichever siblings we could remove; openAppDb
          // on next launch is forgiving about missing WAL/SHM.
        }
      }
    }
    this.scheduleRelaunch();
  }

  private getDbPath(): string {
    return `${app.getPath('userData')}/app.sqlite`;
  }

  private validateBackup(sourcePath: string): string | null {
    // SQLite v3 files always start with "SQLite format 3\0" (16 bytes).
    let fd: number | null = null;
    try {
      fd = openSync(sourcePath, 'r');
      const header = Buffer.alloc(16);
      readSync(fd, header, 0, 16, 0);
      if (!header.equals(SQLITE_MAGIC)) {
        return 'Not a SQLite database file.';
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Could not read file: ${msg}`;
    } finally {
      if (fd !== null) {
        try {
          const fs = require('node:fs') as typeof import('node:fs');
          fs.closeSync(fd);
        } catch {
          // best-effort cleanup
        }
      }
    }
    // Open the file in a tmp connection to verify the schema_migrations
    // table exists. This proves it was produced by carbonink at some
    // point — random sqlite databases from other apps will fail here.
    try {
      // Use a separate Database instance, not the global one (the global
      // is closed during importFromFile). Late require to avoid forcing
      // better-sqlite3 import in code paths that don't need it.
      const Database = require('better-sqlite3') as typeof import('better-sqlite3');
      const tmp = new Database(sourcePath, { readonly: true });
      try {
        const row = tmp
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'")
          .get();
        if (!row) {
          return 'Backup is missing the schema_migrations table — not a CarbonInk export.';
        }
      } finally {
        tmp.close();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Could not open backup as SQLite: ${msg}`;
    }
    return null;
  }

  private scheduleRelaunch(): void {
    // Slight delay so the IPC reply lands in the renderer before the
    // process exits — without this, the renderer sees a closed pipe
    // and might log a spurious "IPC failed" before the new process
    // starts.
    setTimeout(() => {
      app.relaunch();
      app.quit();
    }, RELAUNCH_DELAY_MS);
  }
}

/**
 * Singleton convenience — module-level instance to match the pattern
 * other services use (license-service, etc.). Construct lazily so test
 * code can stub the class methods.
 */
let serviceInstance: DataBackupService | null = null;
export function getDataBackupService(): DataBackupService {
  if (!serviceInstance) serviceInstance = new DataBackupService();
  return serviceInstance;
}
