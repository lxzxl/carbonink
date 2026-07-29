import type { IpcPushTypeMap, IpcTypeMap } from '@main/ipc/types.js';

declare global {
  interface Window {
    /**
     * Environment facts injected by the preload script. Optional because
     * vitest mounts renderer components without a preload bridge.
     */
    carbonink?: {
      /** E2E runs suppress auto-playing guidance tours — see preload. */
      suppressGuidance: boolean;
    };
    ipc: {
      invoke<C extends keyof IpcTypeMap>(
        channel: C,
        ...args: Parameters<IpcTypeMap[C]>
      ): Promise<Awaited<ReturnType<IpcTypeMap[C]>>>;
      subscribe<C extends keyof IpcPushTypeMap & string>(
        channel: C,
        callback: (payload: IpcPushTypeMap[C]) => void,
      ): () => void;
    };
  }
}
