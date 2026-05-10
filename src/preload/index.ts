import { IpcEmitter } from '@electron-toolkit/typed-ipc/renderer';
import type { IpcTypeMap } from '@main/ipc/types.js';
import { contextBridge } from 'electron';

const emitter = new IpcEmitter<IpcTypeMap>();

// Whitelist all known channels — typed-ipc gives us the types but doesn't
// enforce a runtime channel allowlist; we add one here for defense-in-depth.
const allowedChannels: ReadonlyArray<keyof IpcTypeMap> = [
  'org:has-any',
  'org:get-by-id',
  'org:create',
  'org:list-sites',
  'org:create-site',
  'org:list-reporting-periods',
  'org:create-reporting-period',
  'org:complete-onboarding',
];

contextBridge.exposeInMainWorld('ipc', {
  invoke: <C extends keyof IpcTypeMap & string>(
    channel: C,
    ...args: Parameters<IpcTypeMap[C]>
  ): Promise<ReturnType<IpcTypeMap[C]>> => {
    if (!allowedChannels.includes(channel)) {
      return Promise.reject(new Error(`IPC channel not allowed: ${String(channel)}`));
    }
    // typed-ipc requires `Extract<E, string>` for `channel`; the generic C is
    // already constrained to a string, but TS can't see through the conditional
    // when bridged via contextBridge so we cast at this boundary.
    return emitter.invoke(channel as Extract<C, string>, ...args) as Promise<
      ReturnType<IpcTypeMap[C]>
    >;
  },
});

export type IpcBridge = {
  invoke: <C extends keyof IpcTypeMap & string>(
    channel: C,
    ...args: Parameters<IpcTypeMap[C]>
  ) => Promise<ReturnType<IpcTypeMap[C]>>;
};
