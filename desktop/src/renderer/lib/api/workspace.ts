import { invoke } from '../ipc.js';

/**
 * Client workspace API (spec 2026-07-22 — 账套). `switch` resolves with the
 * acknowledgment only; the main process then swaps the database, rebuilds
 * IPC, and reloads this very renderer — don't await anything after it.
 */
export const workspaceApi = {
  list: () => invoke('workspace:list'),
  getActive: () => invoke('workspace:get-active'),
  create: (input: { name: string }) => invoke('workspace:create', input),
  rename: (input: { id: string; name: string }) => invoke('workspace:rename', input),
  switch: (input: { id: string }) => invoke('workspace:switch', input),
  delete: (input: { id: string }) => invoke('workspace:delete', input),
};
