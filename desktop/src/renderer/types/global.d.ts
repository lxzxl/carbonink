import type { IpcPushTypeMap, IpcTypeMap } from '@main/ipc/types.js';

declare global {
  interface Window {
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
