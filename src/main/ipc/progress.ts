import type { BrowserWindow } from 'electron';
import type { IpcPushTypeMap } from './types.js';

/**
 * One-way push channel from main to renderer. Used during long-running
 * IPC handlers (vision extraction is currently the only one) to nudge
 * the UI with phase changes without making the renderer poll.
 *
 * The factory takes a `getWindow` resolver instead of a `BrowserWindow`
 * directly so the consumer doesn't need to re-thread the window
 * reference each time a new one is created — `window.ts` owns the
 * latest-window slot and the emitter follows it.
 *
 * Gracefully handles:
 *   - getWindow returning null (no window yet, or all closed)
 *   - webContents being destroyed mid-flight (window closed between
 *     the resolver call and the actual `.send`)
 *
 * Both cases are non-errors: the renderer is supposed to be
 * subscriber-of-record; if it's gone, the event is simply discarded.
 */
export type ProgressEmitter = <C extends keyof IpcPushTypeMap>(
  channel: C,
  payload: IpcPushTypeMap[C],
) => void;

export function createProgressEmitter(getWindow: () => BrowserWindow | null): ProgressEmitter {
  return <C extends keyof IpcPushTypeMap>(channel: C, payload: IpcPushTypeMap[C]) => {
    const win = getWindow();
    if (!win) return;
    if (win.webContents.isDestroyed()) return;
    win.webContents.send(channel, payload);
  };
}
