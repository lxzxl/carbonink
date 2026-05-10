import { IpcListener } from '@electron-toolkit/typed-ipc/main';
import { getAppDb } from '@main/db/connection.js';
import { defaultNow } from '@main/services/base.js';
import { createIpcContext } from './context.js';
import { organizationHandlers } from './handlers/organization.js';
import type { IpcTypeMap } from './types.js';

let listener: IpcListener<IpcTypeMap> | null = null;

/**
 * Registers all IPC handlers. Idempotent — safe to call once at app startup.
 * `cleanupIpc()` disposes via the IpcListener's built-in dispose() (which
 * internally calls ipcMain.removeHandler for each handle()'d channel and off
 * for each on()'d channel).
 */
export function setupIpc(): void {
  if (listener) return;

  const ctx = createIpcContext({ db: getAppDb(), now: defaultNow });
  const l = new IpcListener<IpcTypeMap>();

  for (const [channel, handler] of Object.entries(organizationHandlers(ctx))) {
    // typed-ipc's handler signature is (event, ...args). Ignore the event in
    // Phase 0 — sender-id-based authorization waits for MCP (§9).
    // The cast is unavoidable: typed-ipc's `handle()` is generic per-channel,
    // but we're iterating over a heterogeneous map here. Per-channel typing
    // is preserved at the call boundary in the renderer wrapper.
    // biome-ignore lint/suspicious/noExplicitAny: heterogeneous handler dispatch
    (l.handle as any)(channel, (_event: Electron.IpcMainInvokeEvent, ...args: unknown[]) =>
      (handler as (...a: unknown[]) => unknown)(...args),
    );
  }

  listener = l;
}

export function cleanupIpc(): void {
  if (!listener) return;
  listener.dispose();
  listener = null;
}
