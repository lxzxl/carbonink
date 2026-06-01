/**
 * Vitest stub for the `electron` module (node test project only).
 *
 * Why this exists
 * ---------------
 * Unit tests run under plain Node (vitest `node` project), never inside an
 * Electron runtime. In a Node process `require('electron')` returns the path to
 * the Electron *binary* as a string — but only if `node_modules/electron` was
 * fully installed (its postinstall writes `path.txt`). In CI the binary
 * download is skipped / soft-fails, so `path.txt` is absent and the module
 * throws `Error: Electron failed to install correctly` at import time. That
 * crashed 11 main-process suites that transitively
 * `import { app, dialog, BrowserWindow, ... } from 'electron'` even though their
 * bodies never call those APIs (they inject deps or mock at a higher layer —
 * which is exactly why the same suites pass locally, where these named imports
 * resolve to `undefined`).
 *
 * Aliasing `electron` to this stub in `vitest.config.ts` decouples the unit
 * tests from the Electron binary download entirely — matching CI's stated
 * philosophy: "we don't rebuild Electron on every PR; unit tests cover business
 * logic." The exports mirror the named bindings the main process imports; they
 * are benign placeholders. tsc still typechecks against the real `electron`
 * types (this alias is vitest-only), so this file does not affect typecheck.
 *
 * If a test genuinely needs Electron behavior it should `vi.mock('electron')`
 * locally — that takes precedence over this alias.
 */

class BrowserWindowStub {
  webContents = { send: () => {}, on: () => {} };
  loadURL = () => Promise.resolve();
  loadFile = () => Promise.resolve();
  on = () => this;
  once = () => this;
  close = () => {};
  destroy = () => {};
  static getAllWindows = () => [] as BrowserWindowStub[];
  static fromWebContents = () => null;
}

export const app = {
  getPath: () => '',
  getName: () => 'carbonink',
  getVersion: () => '0.0.0',
  getLocale: () => 'en-US',
  on: () => app,
  once: () => app,
  whenReady: () => Promise.resolve(),
  quit: () => {},
  isPackaged: false,
};

export const BrowserWindow = BrowserWindowStub;

export const dialog = {
  showSaveDialog: () => Promise.resolve({ canceled: true, filePath: undefined }),
  showOpenDialog: () => Promise.resolve({ canceled: true, filePaths: [] as string[] }),
  showMessageBox: () => Promise.resolve({ response: 0 }),
};

export const shell = {
  openExternal: () => Promise.resolve(),
  openPath: () => Promise.resolve(''),
  showItemInFolder: () => {},
};

export const safeStorage = {
  isEncryptionAvailable: () => false,
  encryptString: (s: string) => Buffer.from(s),
  decryptString: (b: Buffer) => b.toString('utf-8'),
};

export const Menu = {
  buildFromTemplate: () => ({ popup: () => {} }),
  setApplicationMenu: () => {},
};

export const nativeImage = {
  createFromPath: () => ({ isEmpty: () => true }),
  createFromBuffer: () => ({ isEmpty: () => true }),
  createEmpty: () => ({ isEmpty: () => true }),
};

export const ipcMain = {
  handle: () => {},
  on: () => {},
  removeHandler: () => {},
};

export const ipcRenderer = {
  invoke: () => Promise.resolve(undefined),
  on: () => {},
  send: () => {},
};

export const contextBridge = {
  exposeInMainWorld: () => {},
};

export default {
  app,
  BrowserWindow,
  dialog,
  shell,
  safeStorage,
  Menu,
  nativeImage,
  ipcMain,
  ipcRenderer,
  contextBridge,
};
