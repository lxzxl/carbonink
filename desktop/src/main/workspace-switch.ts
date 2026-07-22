import type { WorkspaceService } from '@main/services/workspace-service.js';
import type { Database } from 'better-sqlite3';

export type WorkspaceSwitchDeps = {
  workspaceService: WorkspaceService;
  cleanupIpc: () => void;
  closeAppDb: () => void;
  openAppDb: (path: string) => Database;
  runMigrations: (db: Database) => void;
  setupIpc: () => void;
  reloadWindow: () => void;
  /** Defers the teardown so the IPC reply leaves first. Injectable for tests. */
  schedule: (fn: () => void) => void;
};

let deps: WorkspaceSwitchDeps | null = null;

/**
 * Boot-time wiring (spec 2026-07-22-client-workspaces). The switch tears
 * down the very IPC listener that dispatched it, so the orchestration can't
 * live inside the handler module without an import cycle
 * (handlers → switch → setup → handlers). index.ts injects the real deps
 * once; handlers call {@link requestWorkspaceSwitch}.
 */
export function configureWorkspaceSwitch(next: WorkspaceSwitchDeps): void {
  deps = next;
}

/**
 * Mark the workspace active and schedule the swap: reply first, then
 * cleanupIpc → closeAppDb → openAppDb(new) + migrate → setupIpc (fresh
 * IpcContext over the new db) → reload the renderer. A brand-new workspace
 * file is created here by openAppDb + runMigrations; its empty org table
 * then routes the renderer straight into onboarding — exactly the flow for
 * taking on a new client.
 */
export function requestWorkspaceSwitch(id: string): { ok: boolean } {
  if (!deps) throw new Error('workspace switch not configured — call configureWorkspaceSwitch()');
  const d = deps;
  const path = d.workspaceService.dbPathOf(id);
  if (path === null) return { ok: false };
  if (d.workspaceService.activeWorkspace().id === id) return { ok: true };
  d.workspaceService.setActive(id);
  d.schedule(() => {
    d.cleanupIpc();
    d.closeAppDb();
    const db = d.openAppDb(path);
    d.runMigrations(db);
    d.setupIpc();
    d.reloadWindow();
  });
  return { ok: true };
}
