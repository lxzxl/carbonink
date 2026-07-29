import { contextBridge, ipcRenderer } from 'electron';
import { createBridge, type IpcBridge } from './bridge.js';

// Environment facts the renderer can't derive on its own. Currently just
// the guidance kill-switch: in-app guidance tours auto-play on first
// visit, which would drop an overlay over every Playwright screenshot and
// swallow the clicks of specs that never asked for a tour. So E2E runs
// suppress them by default; `CARBONINK_E2E_GUIDANCE=1` opts a spec back
// in so the guidance feature can test itself in a real window.
contextBridge.exposeInMainWorld('carbonink', {
  suppressGuidance: process.env.CARBONINK_E2E === '1' && process.env.CARBONINK_E2E_GUIDANCE !== '1',
});

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
