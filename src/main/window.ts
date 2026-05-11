import { join } from 'node:path';
import { BrowserWindow, shell } from 'electron';

const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'carbonbook',
    // ── platform-specific window chrome ──────────────────────────────
    // macOS: hide native titlebar, position traffic lights inside content,
    // enable under-window vibrancy so renderer transparent background lets
    // the desktop blur through. Visual effect 'active' = always on, not
    // just on focus.
    ...(isMac && {
      titleBarStyle: 'hiddenInset' as const,
      trafficLightPosition: { x: 18, y: 16 },
      vibrancy: 'under-window' as const,
      visualEffectState: 'active' as const,
    }),
    // Windows 11: Mica is the modern flagship (composited desktop sample);
    // falls back to acrylic on Win10 1903+. autoHideMenuBar removes the
    // legacy F10/Alt menu bar that nobody wants on a desktop SaaS app.
    ...(isWin && {
      backgroundMaterial: 'mica' as const,
      autoHideMenuBar: true,
    }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
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
