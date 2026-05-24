import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { getDataBackupService } from '@main/services/data-backup-service.js';
import { app } from 'electron';

/**
 * AutoBackupService — opportunistic daily backup of the app database.
 *
 * Why not a long-running scheduler?
 *   - A `setInterval(runBackup, 24h)` only fires when the app is open,
 *     and users keep CarbonInk closed most of the time. Instead we use
 *     a "check on startup" pattern: each launch, see when the last
 *     auto-backup ran; if it was more than 24h ago (and the feature is
 *     enabled), run one now.
 *   - Simpler to test (no time mocking), simpler to reason about, no
 *     timer leaks in dev with HMR.
 *
 * Backup location: `<userData>/auto-backups/`. We keep the last 7 daily
 * snapshots, oldest pruned automatically. Filenames are
 * `auto-YYYYMMDD-HHmmss.carbonink-backup` so they sort lexically by
 * timestamp.
 *
 * Toggle: stored in the `setting` table under key `auto_backup_enabled`
 * via the existing SettingsService — TODO once that lands. For now,
 * default to ENABLED so users get backups even before they discover
 * the setting; the cost is small (a ~1MB file per day).
 *
 * Failure semantics: if the backup throws, log + swallow. Auto-backup
 * is a safety net, not a hard guarantee — it shouldn't break app
 * startup if (e.g.) the disk is full.
 */

const AUTO_BACKUP_DIR_NAME = 'auto-backups';
const RETENTION_COUNT = 7;
const MIN_INTERVAL_MS = 23 * 60 * 60 * 1000; // 23h — give an hour of slop

export function getAutoBackupDir(): string {
  const dir = join(app.getPath('userData'), AUTO_BACKUP_DIR_NAME);
  if (!existsSync(dir)) {
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      // Best-effort; runIfDue swallows downstream errors too.
    }
  }
  return dir;
}

/**
 * If the most recent auto-backup is older than ~24h (or no auto-backup
 * exists yet), produce a new one in `<userData>/auto-backups/` and
 * prune anything beyond the retention window.
 *
 * Safe to call at app boot — does its own decision logic.
 */
export function runAutoBackupIfDue(): { ran: boolean; reason?: string } {
  const dir = getAutoBackupDir();
  try {
    const newest = newestBackupMtime(dir);
    if (newest !== null && Date.now() - newest < MIN_INTERVAL_MS) {
      return { ran: false, reason: 'recent' };
    }
    const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    const target = join(dir, `auto-${timestamp}.carbonink-backup`);
    getDataBackupService().exportToFile(target);
    pruneToRetention(dir);
    return { ran: true };
  } catch (err) {
    // Logging happens via console.error → mirrored to log file by
    // LoggerService when installed. Auto-backup never throws to the
    // caller — startup must not fail because of a backup hiccup.
    console.error('[auto-backup] failed:', err);
    return { ran: false, reason: 'error' };
  }
}

function newestBackupMtime(dir: string): number | null {
  try {
    const entries = readdirSync(dir);
    let newest = -1;
    for (const file of entries) {
      if (!file.startsWith('auto-')) continue;
      const stat = statSync(join(dir, file));
      if (stat.mtimeMs > newest) newest = stat.mtimeMs;
    }
    return newest > 0 ? newest : null;
  } catch {
    return null;
  }
}

function pruneToRetention(dir: string): void {
  try {
    const files = readdirSync(dir)
      .filter((f) => f.startsWith('auto-'))
      .map((f) => ({ name: f, mtime: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    // Keep first N (newest); delete the rest.
    for (const entry of files.slice(RETENTION_COUNT)) {
      try {
        unlinkSync(join(dir, entry.name));
      } catch {
        // Skip ones we can't delete.
      }
    }
  } catch {
    // Best-effort.
  }
}
