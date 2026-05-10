import { IpcListener } from '@electron-toolkit/typed-ipc/main';
import { getAppDb } from '@main/db/connection.js';
import { defaultNow } from '@main/services/base.js';
import { createIpcContext } from './context.js';
import { organizationHandlers } from './handlers/organization.js';
import { sanitize } from './sanitize.js';
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
  // typed-ipc's `handle()` is generic per-channel, but we're iterating over a
  // heterogeneous map here — per-channel typing is preserved at the call
  // boundary in the renderer wrapper, so a single cast at this seam is fine.
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous handler dispatch
  const handle = l.handle as unknown as (channel: string, h: (...a: any[]) => unknown) => void;

  for (const [channel, handler] of Object.entries(organizationHandlers(ctx))) {
    const wrapped = sanitize(channel, handler as (...a: unknown[]) => unknown);
    // typed-ipc's handler signature is `(event, ...args)`. Ignore the event in
    // Phase 0 — sender-id-based authorization waits for MCP (§9).
    handle(channel, (_event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => wrapped(...args));
  }

  listener = l;
}

export function cleanupIpc(): void {
  if (!listener) return;
  listener.dispose();
  listener = null;
}
