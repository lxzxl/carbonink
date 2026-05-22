import { checkForUpdates, getUpdateStatus, installUpdate } from '@main/updater/auto-updater.js';
import type { IpcContext } from '../context.js';
import type { IpcTypeMap } from '../types.js';

type HandlerMap = { [K in keyof IpcTypeMap]?: IpcTypeMap[K] };

/**
 * The updater handlers do not need the IPC context (they delegate to
 * module-level functions in auto-updater.ts which hold their own state),
 * but the `HANDLER_FACTORIES` array in `setup.ts` is typed
 * `(ctx: IpcContext) => HandlerMap`. We therefore accept and ignore the
 * context to satisfy that factory signature.
 */
export function updaterHandlers(_ctx: IpcContext): HandlerMap {
  return {
    'updater:get-status': () => getUpdateStatus(),
    'updater:check': () => checkForUpdates(),
    'updater:install': () => installUpdate(),
  };
}
