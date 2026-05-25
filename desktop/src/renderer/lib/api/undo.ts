import { invoke } from '../ipc.js';

/**
 * Renderer wrapper for the undo:* IPC channels (spec
 * `docs/specs/2026-05-25-undo-redo-design.md`).
 *
 * `peek` is a cheap read used by the menu / the `useUndo` hook to
 * drive enabled state. `do` runs the closure on the named side and
 * propagates throws (the UI surfaces them as toasts).
 */
export const undoApi = {
  peek: () => invoke('undo:peek'),
  do: (input: { direction: 'undo' | 'redo' }) => invoke('undo:do', input),
};
