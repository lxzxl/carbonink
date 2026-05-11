import type { IpcTypeMap } from '@main/ipc/types.js';

/**
 * Whitelist of channel names. Defense-in-depth: even if the preload were
 * compromised, the renderer can only invoke channels listed here.
 *
 * Keep in sync with handler registration in `src/main/ipc/setup.ts`.
 */
export const allowedChannels: ReadonlyArray<keyof IpcTypeMap> = [
  // organization domain
  'org:has-any',
  'org:get-current',
  'org:get-by-id',
  'org:create',
  'org:list-sites',
  'org:create-site',
  'org:list-reporting-periods',
  'org:create-reporting-period',
  'org:complete-onboarding',
  // ef-library domain (read-only catalog)
  'ef:list',
  'ef:get-by-pk',
  'units:list',
  // emission-source domain
  'source:create',
  'source:get-by-id',
  'source:list-by-site',
  'source:list-by-org',
  'source:update',
  'source:delete',
  // activity-data domain
  'activity:create',
  'activity:list-by-period',
  'activity:totals-by-period',
  // settings domain (Phase 1b — LLM provider config)
  'settings:available',
  'settings:get-provider',
  'settings:save-provider',
  'settings:clear-provider',
  'settings:ping-provider',
  // document domain (Phase 1b — uploaded source files)
  'document:upload',
  'document:list',
  'document:get-by-id',
  // extraction domain (Phase 1b — AI extraction pipeline)
  'extraction:run',
  'extraction:list-pending',
  'extraction:list-by-document',
  'extraction:get-by-id',
  'extraction:confirm',
  'extraction:discard',
  // stages domain (Phase 1b — read-only extraction stage registry)
  'stages:list',
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
