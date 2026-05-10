import type { IpcTypeMap } from '@main/ipc/types.js';

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
): Promise<ReturnType<IpcTypeMap[C]>> {
  if (!window.ipc) {
    throw new Error('window.ipc not available — preload script not loaded?');
  }
  return window.ipc.invoke(channel, ...args);
}
