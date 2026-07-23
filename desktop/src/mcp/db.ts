import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * Mirror Electron's `app.getPath('userData')` without importing Electron —
 * this module runs in the standalone MCP server process (plain Node via
 * ELECTRON_RUN_AS_NODE), where the `electron` module is unavailable.
 */
function userDataDir(): string {
  const home = homedir();
  if (process.platform === 'darwin') {
    return join(home, 'Library', 'Application Support', 'CarbonInk');
  }
  if (process.platform === 'win32') {
    return join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'CarbonInk');
  }
  return join(home, '.config', 'CarbonInk');
}

/**
 * Database FILENAME of the active workspace per `<userData>/workspaces.json`
 * (client workspaces, spec 2026-07-22; MCP awareness,
 * spec 2026-07-23-mcp-workspace-aware). Falls back to the pre-workspace
 * `app.sqlite` whenever the registry is missing, unreadable, or malformed —
 * older installs never wrote one. A dangling `active_id` degrades to the
 * first workspace, mirroring `WorkspaceService.activeWorkspace`.
 *
 * `basename()` is defense-in-depth mirroring `WorkspaceService.save`: a
 * hand-tampered registry entry must not be able to steer the MCP server to
 * a file outside userData.
 *
 * Exported for tests; production goes through {@link defaultDbPath}.
 */
export function activeWorkspaceFile(dir: string): string {
  try {
    const raw = readFileSync(join(dir, 'workspaces.json'), 'utf-8');
    const registry = JSON.parse(raw) as {
      version?: number;
      workspaces?: Array<{ id?: string; file?: string }>;
      active_id?: string;
    };
    if (registry.version !== 1 || !Array.isArray(registry.workspaces)) return 'app.sqlite';
    const active =
      registry.workspaces.find((w) => w.id === registry.active_id) ?? registry.workspaces[0];
    if (active && typeof active.file === 'string' && active.file !== '') {
      return basename(active.file);
    }
    return 'app.sqlite';
  } catch {
    return 'app.sqlite';
  }
}

/**
 * Resolve the ACTIVE workspace's sqlite path (not always `app.sqlite` —
 * see {@link activeWorkspaceFile}). Override with the CARBONINK_MCP_DB env
 * var for testing; the override names a concrete file and skips the
 * registry entirely.
 *
 * Freshness: `index.ts` calls `openAppDb()` per tool request, so a
 * workspace switch in the desktop app is picked up on the very next MCP
 * call — no long-lived stale handle.
 */
export function defaultDbPath(): string {
  if (process.env.CARBONINK_MCP_DB) return process.env.CARBONINK_MCP_DB;
  const dir = userDataDir();
  return join(dir, activeWorkspaceFile(dir));
}

export function openAppDb(path: string = defaultDbPath()): DatabaseSync {
  if (!existsSync(path)) {
    throw new Error(`CarbonInk DB not found at ${path}. Launch the app at least once.`);
  }
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}
