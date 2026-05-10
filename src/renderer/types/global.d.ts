import type { IpcTypeMap } from '@main/ipc/types.js';

declare global {
  interface Window {
    ipc: {
      invoke<C extends keyof IpcTypeMap>(
        channel: C,
        ...args: Parameters<IpcTypeMap[C]>
      ): Promise<ReturnType<IpcTypeMap[C]>>;
    };
  }
}
