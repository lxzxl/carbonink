import type { IpcTypeMap } from '@main/ipc/types.js';

/**
 * Whitelist of channel names. Defense-in-depth: even if the preload were
 * compromised, the renderer can only invoke channels listed here.
 *
 * Keep in sync with handler registration in `src/main/ipc/setup.ts`.
 */
export const allowedChannels: ReadonlyArray<keyof IpcTypeMap> = [
  'org:has-any',
  'org:get-by-id',
  'org:create',
  'org:list-sites',
  'org:create-site',
  'org:list-reporting-periods',
  'org:create-reporting-period',
  'org:complete-onboarding',
];

export type InvokeFn = (channel: string, ...args: unknown[]) => Promise<unknown>;

export interface IpcBridge {
  invoke<C extends keyof IpcTypeMap & string>(
    channel: C,
    ...args: Parameters<IpcTypeMap[C]>
  ): Promise<ReturnType<IpcTypeMap[C]>>;
}

/**
 * Builds the bridge object exposed to the renderer. Extracted from
 * `src/preload/index.ts` so the channel-allowlist gate can be unit-tested
 * without bundling the preload script through Electron.
 */
export function createBridge(invokeFn: InvokeFn): IpcBridge {
  return {
    invoke<C extends keyof IpcTypeMap & string>(
      channel: C,
      ...args: Parameters<IpcTypeMap[C]>
    ): Promise<ReturnType<IpcTypeMap[C]>> {
      if (!allowedChannels.includes(channel)) {
        return Promise.reject(new Error(`IPC channel not allowed: ${String(channel)}`));
      }
      return invokeFn(channel, ...args) as Promise<ReturnType<IpcTypeMap[C]>>;
    },
  };
}
