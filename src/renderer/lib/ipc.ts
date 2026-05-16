import type { IpcPushTypeMap, IpcTypeMap } from '@main/ipc/types.js';

/**
 * Type-safe wrapper around window.ipc.invoke.
 *
 * Prefer the per-domain wrappers in src/renderer/lib/api/<domain>.ts —
 * they give callers nice function names (e.g. orgApi.create) and let
 * domains evolve independently. This generic invoke is the foundation.
 */
export function invoke<C extends keyof IpcTypeMap>(
  channel: C,
  ...args: Parameters<IpcTypeMap[C]>
): Promise<Awaited<ReturnType<IpcTypeMap[C]>>> {
  if (!window.ipc) {
    throw new Error('window.ipc not available — preload script not loaded?');
  }
  return window.ipc.invoke(channel, ...args);
}

/**
 * Type-safe wrapper around window.ipc.subscribe. Subscribes to a
 * main→renderer push channel and returns an unsubscribe function.
 *
 * Typical use inside a React component:
 *   useEffect(() => subscribe('extraction:progress', (p) => { ... }), [...]);
 * — returning the unsubscribe directly from the effect ensures React
 * runs it on unmount.
 */
export function subscribe<C extends keyof IpcPushTypeMap & string>(
  channel: C,
  callback: (payload: IpcPushTypeMap[C]) => void,
): () => void {
  if (!window.ipc) {
    throw new Error('window.ipc not available — preload script not loaded?');
  }
  return window.ipc.subscribe(channel, callback);
}
