import { join } from 'node:path';
import { BrowserWindow, shell } from 'electron';

const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';

/**
 * Module-level slot for the most-recent main window. Other main-process
 * subsystems (e.g. `progress.ts`) need to push events to "the" renderer
 * without re-threading a `BrowserWindow` reference through every IPC
 * setup call. We cleared the slot on `closed` so a closed-then-not-yet-
 * reopened app correctly returns null.
 */
let currentMainWindow: BrowserWindow | null = null;

/**
 * Returns the most recent `BrowserWindow` created by `createMainWindow`,
 * or null if no window currently exists. Callers should treat null as
 * "renderer is unavailable, skip this event".
 */
export function getMainWindow(): BrowserWindow | null {
  return currentMainWindow;
}

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'CarbonInk',
    ...(isMac && {
      titleBarStyle: 'hiddenInset' as const,
      trafficLightPosition: { x: 18, y: 16 },
      // Round 4 hotfix4: vibrancy dropped. The redesign committed to
      // an opaque-white aesthetic (matches Craft Agents reference;
      // simpler than vibrancy edge-cases). The OS still owns the
      // window-corner clipping via `roundedCorners`.
      roundedCorners: true,
    }),
    ...(isWin && {
      // Win11 mica dropped for the same reason — pure-white opaque
      // window matches mac, and mica had its own flicker bugs.
      autoHideMenuBar: true,
    }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  currentMainWindow = win;
  win.on('closed', () => {
    if (currentMainWindow === win) currentMainWindow = null;
  });

  win.on('ready-to-show', () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return win;
}
