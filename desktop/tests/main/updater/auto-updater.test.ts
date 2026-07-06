import type { UpdateStatus } from '@main/updater/auto-updater';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The shared electron stub (tests/stubs/electron.ts) reports an unpackaged
// app, which makes initAutoUpdater() a no-op — mock a packaged one.
vi.mock('electron', () => ({ app: { isPackaged: true } }));
// setStatus() tolerates a missing window; no need for a real BrowserWindow.
vi.mock('@main/window.js', () => ({ getMainWindow: () => null }));

const { autoUpdaterMock, listeners } = vi.hoisted(() => {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const autoUpdaterMock = {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    on(event: string, cb: (...args: unknown[]) => void) {
      listeners.set(event, cb);
      return autoUpdaterMock;
    },
    checkForUpdates: () => Promise.resolve(null),
    quitAndInstall: () => {},
  };
  return { autoUpdaterMock, listeners };
});

vi.mock('electron-updater', () => ({ autoUpdater: autoUpdaterMock }));

/**
 * The auto-updater module's core logic is thin (it delegates to
 * electron-updater which can't run outside Electron). We test the
 * type contract and status shape so future changes don't silently
 * break the renderer contract that the `updater:status` push channel
 * and the `updater:get-status` invoke channel share.
 */
describe('UpdateStatus type contract', () => {
  it('idle status has no extra fields', () => {
    const status: UpdateStatus = { state: 'idle' };
    expect(status.state).toBe('idle');
  });

  it('available status carries version + releaseDate', () => {
    const status: UpdateStatus = {
      state: 'available',
      version: '1.2.3',
      releaseDate: '2026-06-01T00:00:00Z',
    };
    expect(status.version).toBe('1.2.3');
    expect(status.releaseDate).toBeDefined();
  });

  it('available-manual status carries version + releaseDate', () => {
    const status: UpdateStatus = {
      state: 'available-manual',
      version: '1.2.3',
      releaseDate: '2026-06-01T00:00:00Z',
    };
    expect(status.version).toBe('1.2.3');
    expect(status.releaseDate).toBeDefined();
  });

  it('downloading status carries percent', () => {
    const status: UpdateStatus = { state: 'downloading', percent: 42 };
    expect(status.percent).toBe(42);
  });

  it('error status carries message', () => {
    const status: UpdateStatus = { state: 'error', message: 'Network timeout' };
    expect(status.message).toBe('Network timeout');
  });
});

/**
 * Platform gate (see initAutoUpdater): macOS builds are ad-hoc signed and
 * Squirrel.Mac's designated-requirement check makes auto-INSTALL impossible
 * there — updates must surface as `available-manual` (notify + website
 * download) instead of entering the download flow. Windows keeps the full
 * download-and-install flow.
 */
describe('auto-updater platform gate', () => {
  const realPlatform = process.platform;
  const updateInfo = { version: '9.9.9', releaseDate: '2026-07-06T00:00:00.000Z' };

  function setPlatform(platform: NodeJS.Platform) {
    Object.defineProperty(process, 'platform', { value: platform });
  }

  // auto-updater.ts holds module-level status + registers its listeners
  // once, so each test re-imports a fresh module on the desired platform.
  async function initOnPlatform(platform: NodeJS.Platform) {
    setPlatform(platform);
    vi.resetModules();
    const mod = await import('@main/updater/auto-updater.js');
    mod.initAutoUpdater();
    return mod;
  }

  beforeEach(() => {
    // initAutoUpdater schedules a 10s background check; keep it inert.
    vi.useFakeTimers();
    listeners.clear();
    autoUpdaterMock.autoDownload = true;
    autoUpdaterMock.autoInstallOnAppQuit = true;
  });

  afterEach(() => {
    setPlatform(realPlatform);
    vi.useRealTimers();
  });

  it('darwin is notify-only: no auto-download, update-available maps to available-manual', async () => {
    const mod = await initOnPlatform('darwin');

    expect(autoUpdaterMock.autoDownload).toBe(false);
    expect(autoUpdaterMock.autoInstallOnAppQuit).toBe(false);

    listeners.get('update-available')?.(updateInfo);
    expect(mod.getUpdateStatus()).toEqual({
      state: 'available-manual',
      version: '9.9.9',
      releaseDate: '2026-07-06T00:00:00.000Z',
    });
  });

  it('win32 keeps the full flow: auto-download on, update-available maps to available', async () => {
    const mod = await initOnPlatform('win32');

    expect(autoUpdaterMock.autoDownload).toBe(true);
    expect(autoUpdaterMock.autoInstallOnAppQuit).toBe(true);

    listeners.get('update-available')?.(updateInfo);
    expect(mod.getUpdateStatus()).toEqual({
      state: 'available',
      version: '9.9.9',
      releaseDate: '2026-07-06T00:00:00.000Z',
    });
  });

  it('win32 downloaded event still reports downloaded', async () => {
    const mod = await initOnPlatform('win32');

    listeners.get('update-downloaded')?.(updateInfo);
    expect(mod.getUpdateStatus()).toEqual({ state: 'downloaded', version: '9.9.9' });
  });
});
