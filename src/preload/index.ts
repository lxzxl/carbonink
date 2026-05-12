import { contextBridge, ipcRenderer } from 'electron';
import { createBridge, type IpcBridge } from './bridge.js';

contextBridge.exposeInMainWorld(
  'ipc',
  createBridge(
    (channel, ...args) => ipcRenderer.invoke(channel, ...args),
    (channel, handler) => {
      // Wrapping the listener so we hand back a one-shot
      // unsubscribe that calls `removeListener` with the SAME
      // function reference Electron is holding. Returning the raw
      // `on` listener would force callers to track it themselves.
      ipcRenderer.on(channel, handler);
      return () => {
        ipcRenderer.removeListener(channel, handler);
      };
    },
  ),
);

export type { IpcBridge };
