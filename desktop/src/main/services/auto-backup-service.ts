import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { getDataBackupService } from '@main/services/data-backup-service.js';
import { WorkspaceService } from '@main/services/workspace-service.js';
import type { WorkspaceRegistry } from '@shared/types.js';
import Database from 'better-sqlite3';
import { app } from 'electron';

/**
 * AutoBackupService — opportunistic daily backup of EVERY workspace
 * database (spec 2026-07-23-backup-workspace-aware).
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
 * Workspace awareness (v2): a consultant's inactive client workspaces
 * hold real ledgers too, so the pass walks the whole registry — one
 * subdirectory per workspace:
 *
 *     <userData>/auto-backups/<workspace_id>/auto-YYYYMMDD-HHmmss.carbonink-backup
 *
 * Retention (last 7) and the ~24h due-check both apply PER WORKSPACE, so
 * a freshly created workspace gets its first snapshot on the next launch
 * without disturbing the others' cadence. The ACTIVE workspace is copied
 * through DataBackupService.exportToFile (checkpoints the live
 * connection); inactive workspaces are closed files — a throwaway
 * connection runs `wal_checkpoint(TRUNCATE)` first so a crash-left WAL
 * is folded in before the copy. A workspace that was created but never
 * opened has no file yet and is skipped. One broken workspace never
 * blocks the rest of the pass.
 *
 * Legacy layout: pre-workspace builds wrote flat `auto-*` files directly
 * in auto-backups/. On the first v2 pass those are moved into the
 * default workspace's subdirectory (the registry entry backed by
 * `app.sqlite`) so retention history carries over.
 *
 * Toggle: `setting` table key `auto_backup.enabled` (read/written by
 * SettingsService.{get,set}AutoBackupEnabled). Defaults to ENABLED —
 * the gate is checked in `main/index.ts` before this function is
 * called, so this module stays pure / doesn't touch the app DB.
 *
 * Failure semantics: if the pass throws, log + swallow. Auto-backup
 * is a safety net, not a hard guarantee — it shouldn't break app
 * startup if (e.g.) the disk is full.
 */

const AUTO_BACKUP_DIR_NAME = 'auto-backups';
const RETENTION_COUNT = 7;
const MIN_INTERVAL_MS = 23 * 60 * 60 * 1000; // 23h — give an hour of slop
/** The registry file entry every pre-workspace install was bootstrapped with. */
const DEFAULT_DB_FILENAME = 'app.sqlite';

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
 * Injectable seams so tests can run the whole pass against a temp dir
 * without Electron or the live-connection singleton. Production callers
 * pass nothing — every default resolves to the real thing.
 */
export interface AutoBackupDeps {
  /** Directory holding workspaces.json + the workspace sqlite files. */
  userDataDir: string;
  /** Root backups directory (per-workspace subdirs live under it). */
  backupsDir: string;
  /** Backs up the LIVE (active) workspace via the open connection. */
  exportActive: (targetPath: string) => void;
  now: () => number;
}

/**
 * Walk the workspace registry; snapshot every workspace whose newest
 * backup is older than ~24h (or that has none yet). Safe to call at app
 * boot — does its own decision logic, never throws.
 */
export function runAutoBackupIfDue(overrides?: Partial<AutoBackupDeps>): {
  ran: boolean;
  reason?: string;
} {
  try {
    const deps: AutoBackupDeps = {
      userDataDir: overrides?.userDataDir ?? app.getPath('userData'),
      backupsDir: overrides?.backupsDir ?? getAutoBackupDir(),
      exportActive:
        overrides?.exportActive ?? ((target) => void getDataBackupService().exportToFile(target)),
      now: overrides?.now ?? Date.now,
    };
    const registry = new WorkspaceService(deps.userDataDir).load();
    migrateLegacyFlatBackups(deps.backupsDir, registry);

    let ranAny = false;
    for (const workspace of registry.workspaces) {
      try {
        if (backupWorkspaceIfDue(workspace.id, workspace.file, registry.active_id, deps)) {
          ranAny = true;
        }
      } catch (err) {
        // One broken workspace (corrupt file, permissions) must not cost
        // the others their snapshot.
        console.error(`[auto-backup] workspace ${workspace.id} failed:`, err);
      }
    }
    return ranAny ? { ran: true } : { ran: false, reason: 'recent' };
  } catch (err) {
    // Logging happens via console.error → mirrored to log file by
    // LoggerService when installed. Auto-backup never throws to the
    // caller — startup must not fail because of a backup hiccup.
    console.error('[auto-backup] failed:', err);
    return { ran: false, reason: 'error' };
  }
}

/** @returns true when a snapshot was written for this workspace. */
function backupWorkspaceIfDue(
  workspaceId: string,
  workspaceFile: string,
  activeId: string,
  deps: AutoBackupDeps,
): boolean {
  const workspaceDir = join(deps.backupsDir, workspaceId);
  const newest = newestBackupMtime(workspaceDir);
  if (newest !== null && deps.now() - newest < MIN_INTERVAL_MS) return false;

  const dbFile = join(deps.userDataDir, workspaceFile);
  const isActive = workspaceId === activeId;
  // Created-but-never-opened workspaces have no file yet; nothing to
  // snapshot. (The active workspace always has one — it's open.)
  if (!isActive && !existsSync(dbFile)) return false;

  mkdirSync(workspaceDir, { recursive: true });
  const timestamp = new Date(deps.now())
    .toISOString()
    .replace(/[-:]/g, '')
    .replace('T', '-')
    .slice(0, 15);
  const target = join(workspaceDir, `auto-${timestamp}.carbonink-backup`);

  if (isActive) {
    deps.exportActive(target);
  } else {
    backupClosedDb(dbFile, target);
  }
  pruneToRetention(workspaceDir);
  return true;
}

/**
 * Snapshot a CLOSED workspace database: fold any WAL left by an unclean
 * shutdown into the main file via a throwaway connection, then copy.
 * (For a cleanly-switched-away workspace the checkpoint is a no-op.)
 */
function backupClosedDb(dbFile: string, targetPath: string): void {
  const tmp = new Database(dbFile);
  try {
    tmp.pragma('wal_checkpoint(TRUNCATE)');
  } finally {
    tmp.close();
  }
  copyFileSync(dbFile, targetPath);
}

/**
 * One-time layout migration: move flat pre-workspace `auto-*` files from
 * the backups root into the default workspace's subdirectory so its
 * retention history stays continuous. The default workspace is the
 * registry entry backed by `app.sqlite` (bootstrapped on upgrade); if it
 * was deleted, fall back to the active one. Best-effort — a file that
 * can't be moved just stays flat and inert.
 */
function migrateLegacyFlatBackups(backupsDir: string, registry: WorkspaceRegistry): void {
  try {
    const legacy = readdirSync(backupsDir).filter(
      (f) => f.startsWith('auto-') && statSync(join(backupsDir, f)).isFile(),
    );
    if (legacy.length === 0) return;
    const owner =
      registry.workspaces.find((w) => w.file === DEFAULT_DB_FILENAME) ??
      registry.workspaces.find((w) => w.id === registry.active_id) ??
      registry.workspaces[0];
    if (!owner) return;
    const ownerDir = join(backupsDir, owner.id);
    mkdirSync(ownerDir, { recursive: true });
    for (const file of legacy) {
      try {
        renameSync(join(backupsDir, file), join(ownerDir, file));
      } catch {
        // Best-effort per file.
      }
    }
  } catch {
    // Best-effort.
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
