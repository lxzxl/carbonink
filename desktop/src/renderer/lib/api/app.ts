import { invoke } from '../ipc.js';

/**
 * Per-domain renderer wrapper for the `app:*` IPC channels (Phase 5.1 —
 * Settings → About + Data management). `getInfo()` returns runtime
 * version info for the About section; `openDataDir()` reveals the
 * userData directory in Finder/Explorer for power users + support.
 */
export const appApi = {
  getInfo: () => invoke('app:get-info'),
  openDataDir: () => invoke('app:open-data-dir'),
};
