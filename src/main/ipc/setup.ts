import { IpcListener } from '@electron-toolkit/typed-ipc/main';
import { getAppDb } from '@main/db/connection.js';
import { defaultNow } from '@main/services/base.js';
import { createIpcContext, type IpcContext } from './context.js';
import { activityDataHandlers } from './handlers/activity-data.js';
import { efLibraryHandlers } from './handlers/ef-library.js';
import { emissionSourceHandlers } from './handlers/emission-source.js';
import { organizationHandlers } from './handlers/organization.js';
import { sanitize } from './sanitize.js';
import type { IpcTypeMap } from './types.js';

let listener: IpcListener<IpcTypeMap> | null = null;

type HandlerMap = { [K in keyof IpcTypeMap]?: IpcTypeMap[K] };
type HandlerFactory = (ctx: IpcContext) => HandlerMap;

/**
 * Every handler factory the app exposes. Order is cosmetic — channels live in
 * a flat namespace and registration is independent of order.
 */
const HANDLER_FACTORIES: ReadonlyArray<HandlerFactory> = [
  organizationHandlers,
  efLibraryHandlers,
  emissionSourceHandlers,
  activityDataHandlers,
];

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

  for (const factory of HANDLER_FACTORIES) {
    for (const [channel, handler] of Object.entries(factory(ctx))) {
      const wrapped = sanitize(channel, handler as (...a: unknown[]) => unknown);
      // typed-ipc's `handle()` is generic per-channel, but we're iterating over
      // a heterogeneous map here — per-channel typing is preserved at the call
      // boundary in the renderer wrapper. We call `l.handle(...)` directly
      // (not via an extracted reference) so the method retains its `this`
      // binding to the IpcListener instance — extracting it via
      // `const handle = l.handle` strips `this` and `this.handlers.push()`
      // throws at runtime.
      // biome-ignore lint/suspicious/noExplicitAny: heterogeneous handler dispatch
      (l.handle as (c: string, h: (...a: any[]) => unknown) => void)(
        channel,
        (_event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => wrapped(...args),
      );
    }
  }

  listener = l;
}

export function cleanupIpc(): void {
  if (!listener) return;
  listener.dispose();
  listener = null;
}
