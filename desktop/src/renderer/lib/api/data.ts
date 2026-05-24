import { invoke } from '../ipc.js';

/**
 * Phase 5.2 data lifecycle API. Three channels for the user's database
 * file (export / import / reset) plus two for cache cleanup.
 *
 * Operations that schedule an app relaunch (`importBackup`, `reset`)
 * return `{ ok: true }` immediately — the renderer should surface a
 * "restarting…" UI state and let Electron's relaunch sequence carry
 * the user back to the freshly-loaded app.
 */
export const dataApi = {
  exportBackup: () => invoke('data:export-backup'),
  importBackup: () => invoke('data:import-backup'),
  reset: () => invoke('data:reset'),
};

export const cacheApi = {
  getStats: () => invoke('cache:get-stats'),
  clearExtractionRaw: () => invoke('cache:clear-extraction-raw'),
};
