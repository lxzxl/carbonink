import { contextBridge, ipcRenderer } from 'electron';
import { createBridge, type IpcBridge } from './bridge.js';

// We don't use `@electron-toolkit/typed-ipc/renderer` here because its
// IpcEmitter reads `window.electron.ipcRenderer.invoke(...)` — a global only
// populated by `@electron-toolkit/preload`'s `electronAPI`, which we don't
// install. Calling `ipcRenderer.invoke` directly is simpler and the per-call
// typing is already enforced via the `invoke<C>(channel, ...)` signature.
contextBridge.exposeInMainWorld(
  'ipc',
  createBridge((channel, ...args) => ipcRenderer.invoke(channel, ...args)),
);

export type { IpcBridge };
