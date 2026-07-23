import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Workspace, WorkspaceRegistry } from '@shared/types.js';
import { newId } from '@shared/ulid.js';

/** Registry filename inside userData — deliberately outside every workspace DB. */
const REGISTRY_FILENAME = 'workspaces.json';
/** The pre-workspace database file every existing install already has. */
const DEFAULT_DB_FILENAME = 'app.sqlite';

const MAX_NAME_LENGTH = 60;

/**
 * Client workspaces (账套) — spec 2026-07-22-client-workspaces, ROADMAP
 * §8.1-③ v1. One workspace = one standalone SQLite file; the single-org
 * invariant lives on INSIDE each file, so multi-client needs no schema or
 * query changes at all. This service owns only the registry JSON: which
 * files exist, their display names, and which one is active. It never
 * opens a database — switching is orchestrated in workspace-switch.ts.
 *
 * Bootstrap contract: the first load() on an existing install registers
 * `app.sqlite` as the「默认账套」and marks it active, so upgrades are
 * invisible until the user creates a second workspace.
 */
export class WorkspaceService {
  constructor(private readonly userDataDir: string) {}

  private registryPath(): string {
    return join(this.userDataDir, REGISTRY_FILENAME);
  }

  /** Load the registry, bootstrapping the default workspace on first run. */
  load(): WorkspaceRegistry {
    const path = this.registryPath();
    if (existsSync(path)) {
      const parsed = JSON.parse(readFileSync(path, 'utf-8')) as WorkspaceRegistry;
      if (parsed.version === 1 && Array.isArray(parsed.workspaces)) return parsed;
    }
    const defaultWorkspace: Workspace = {
      id: newId(),
      name: '默认账套',
      file: DEFAULT_DB_FILENAME,
      created_at: new Date().toISOString(),
    };
    const registry: WorkspaceRegistry = {
      version: 1,
      workspaces: [defaultWorkspace],
      active_id: defaultWorkspace.id,
    };
    this.save(registry);
    return registry;
  }

  list(): Workspace[] {
    return this.load().workspaces;
  }

  activeWorkspace(): Workspace {
    const registry = this.load();
    const active = registry.workspaces.find((w) => w.id === registry.active_id);
    // A corrupt active_id degrades to the first workspace instead of a
    // boot loop — there is always at least the bootstrapped default.
    return active ?? (registry.workspaces[0] as Workspace);
  }

  /** Absolute path of the active workspace's database file. */
  activeDbPath(): string {
    return join(this.userDataDir, this.activeWorkspace().file);
  }

  /** Absolute path for any registered workspace id, or null. */
  dbPathOf(id: string): string | null {
    const workspace = this.load().workspaces.find((w) => w.id === id);
    return workspace ? join(this.userDataDir, workspace.file) : null;
  }

  create(name: string): { ok: true; workspace: Workspace } | { ok: false; error: 'InvalidName' } {
    const trimmed = name.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_NAME_LENGTH) {
      return { ok: false, error: 'InvalidName' };
    }
    const registry = this.load();
    const workspace: Workspace = {
      id: newId(),
      // File is always a generated basename — user input never reaches the
      // filesystem path, so the registry cannot be steered outside userData.
      name: trimmed,
      file: `workspace-${newId().toLowerCase()}.sqlite`,
      created_at: new Date().toISOString(),
    };
    registry.workspaces.push(workspace);
    this.save(registry);
    return { ok: true, workspace };
  }

  rename(id: string, name: string): boolean {
    const trimmed = name.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_NAME_LENGTH) return false;
    const registry = this.load();
    const workspace = registry.workspaces.find((w) => w.id === id);
    if (!workspace) return false;
    workspace.name = trimmed;
    this.save(registry);
    return true;
  }

  /**
   * Remove a workspace from the registry and archive its database file
   * (rename to `<file>.deleted-<stamp>`, WAL/SHM siblings included) —
   * never a hard delete, so a mistaken removal is recoverable by hand.
   * The active workspace and the last remaining workspace are refused;
   * switch away first.
   */
  remove(
    id: string,
  ):
    | { ok: true; archived_file: string | null }
    | { ok: false; error: 'NotFound' | 'ActiveWorkspace' | 'LastWorkspace' } {
    const registry = this.load();
    const workspace = registry.workspaces.find((w) => w.id === id);
    if (!workspace) return { ok: false, error: 'NotFound' };
    if (registry.active_id === id) return { ok: false, error: 'ActiveWorkspace' };
    if (registry.workspaces.length <= 1) return { ok: false, error: 'LastWorkspace' };

    registry.workspaces = registry.workspaces.filter((w) => w.id !== id);
    this.save(registry);

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const base = join(this.userDataDir, workspace.file);
    let archivedFile: string | null = null;
    // A workspace that was created but never opened has no file yet.
    if (existsSync(base)) {
      archivedFile = `${workspace.file}.deleted-${stamp}`;
      renameSync(base, join(this.userDataDir, archivedFile));
    }
    for (const suffix of ['-wal', '-shm']) {
      const sibling = `${base}${suffix}`;
      if (existsSync(sibling)) {
        renameSync(sibling, `${join(this.userDataDir, workspace.file)}${suffix}.deleted-${stamp}`);
      }
    }
    return { ok: true, archived_file: archivedFile };
  }

  /** Mark a workspace active (the orchestrator does the actual DB swap). */
  setActive(id: string): boolean {
    const registry = this.load();
    if (!registry.workspaces.some((w) => w.id === id)) return false;
    registry.active_id = id;
    this.save(registry);
    return true;
  }

  /**
   * Atomic-ish write: tmp file + rename so a crash mid-write can't leave a
   * truncated registry (rename on the same volume is atomic on POSIX).
   */
  private save(registry: WorkspaceRegistry): void {
    mkdirSync(this.userDataDir, { recursive: true });
    // Defense-in-depth: refuse any file entry that isn't a bare basename.
    for (const workspace of registry.workspaces) {
      if (workspace.file !== basename(workspace.file)) {
        throw new Error(`workspace file must be a bare filename: ${workspace.file}`);
      }
    }
    const tmp = join(this.userDataDir, `${REGISTRY_FILENAME}.tmp`);
    writeFileSync(tmp, `${JSON.stringify(registry, null, 2)}\n`, 'utf-8');
    renameSync(tmp, this.registryPath());
  }
}
