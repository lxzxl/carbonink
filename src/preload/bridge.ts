import type { IpcPushTypeMap, IpcTypeMap } from '@main/ipc/types.js';

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
  // ef-matcher domain (Phase 1c — LLM-assisted EF recommendation)
  'ef:recommend',
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
  'document:read-bytes',
  // extraction domain (Phase 1b — AI extraction pipeline)
  'extraction:classify-and-run',
  'extraction:run',
  'extraction:list-pending',
  'extraction:list-by-document',
  'extraction:list-statuses',
  'extraction:get-by-id',
  'extraction:confirm',
  'extraction:discard',
  // stages domain (Phase 1b — read-only extraction stage registry)
  'stages:list',
  // questionnaire domain (Phase 2.2a — questionnaire upload + extract pipeline)
  'questionnaire:create',
  'questionnaire:list',
  'questionnaire:get-by-id',
  // answer domain (Phase 2.2b — auto-answer pipeline)
  'answer:generate',
  'answer:save',
  'answer:list-by-questionnaire',
];

/**
 * Whitelist of push channels (main→renderer events via webContents.send).
 * Subscribe-side counterpart to `allowedChannels`. Keep aligned with
 * `IpcPushTypeMap` keys in `src/main/ipc/types.ts`.
 */
export const allowedPushChannels: ReadonlyArray<keyof IpcPushTypeMap> = ['extraction:progress'];

export type InvokeFn = (channel: string, ...args: unknown[]) => Promise<unknown>;

/**
 * Preload-side subscribe primitive. Implementations wire to
 * `ipcRenderer.on` + return a cleanup that calls `removeListener`.
 *
 * The handler signature mirrors Electron's: receives the event object
 * (which we never pass through) plus the payload. The bridge translates
 * this to a payload-only callback on the renderer side.
 */
export type SubscribeFn = (
  channel: string,
  handler: (event: unknown, payload: unknown) => void,
) => () => void;

export interface IpcBridge {
  invoke<C extends keyof IpcTypeMap & string>(
    channel: C,
    ...args: Parameters<IpcTypeMap[C]>
  ): Promise<Awaited<ReturnType<IpcTypeMap[C]>>>;
  /**
   * Subscribe to a main→renderer push channel. Returns an unsubscribe
   * function that detaches the listener.
   */
  subscribe<C extends keyof IpcPushTypeMap & string>(
    channel: C,
    callback: (payload: IpcPushTypeMap[C]) => void,
  ): () => void;
}

/**
 * Builds the bridge object exposed to the renderer. Extracted from
 * `src/preload/index.ts` so the channel-allowlist gate can be unit-tested
 * without bundling the preload script through Electron.
 */
export function createBridge(invokeFn: InvokeFn, subscribeFn: SubscribeFn): IpcBridge {
  return {
    invoke<C extends keyof IpcTypeMap & string>(
      channel: C,
      ...args: Parameters<IpcTypeMap[C]>
    ): Promise<Awaited<ReturnType<IpcTypeMap[C]>>> {
      if (!allowedChannels.includes(channel)) {
        return Promise.reject(new Error(`IPC channel not allowed: ${String(channel)}`));
      }
      return invokeFn(channel, ...args) as Promise<Awaited<ReturnType<IpcTypeMap[C]>>>;
    },
    subscribe<C extends keyof IpcPushTypeMap & string>(
      channel: C,
      callback: (payload: IpcPushTypeMap[C]) => void,
    ): () => void {
      if (!allowedPushChannels.includes(channel)) {
        throw new Error(`IPC push channel not allowed: ${String(channel)}`);
      }
      const unsubscribe = subscribeFn(channel, (_event, payload) => {
        callback(payload as IpcPushTypeMap[C]);
      });
      return unsubscribe ?? (() => {});
    },
  };
}
