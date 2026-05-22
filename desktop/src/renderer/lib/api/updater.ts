import { invoke } from '../ipc.js';

/**
 * Per-domain renderer wrapper for the `updater:*` IPC channels (Phase 5
 * — auto-update via electron-updater). The Settings page UpdateSection
 * calls `getStatus()` from a TanStack `useQuery` for the initial value
 * and subscribes to `updater:status` push events for real-time updates;
 * the "Check" / "Restart & Update" buttons call `check()` / `install()`.
 */
export const updaterApi = {
  getStatus: () => invoke('updater:get-status'),
  check: () => invoke('updater:check'),
  install: () => invoke('updater:install'),
};
