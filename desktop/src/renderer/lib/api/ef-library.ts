import { invoke } from '../ipc.js';

/**
 * Per-domain renderer wrapper for the `ef:*` / `units:*` IPC channels.
 *
 * Read-only catalog API. ActivityForm uses `list` to surface EF candidates
 * once the user picks an emission source (filtered by category + scope),
 * `getByPk` to resolve a citation, and `listUnits` to render the unit
 * selector / aliases.
 *
 * Inputs are typed via `Parameters<typeof invoke<...>>[1]` so we don't
 * duplicate the shape here — IpcTypeMap is the single source of truth.
 */
export const efApi = {
  list: (input: Parameters<typeof invoke<'ef:list'>>[1]) => invoke('ef:list', input),
  getByPk: (input: Parameters<typeof invoke<'ef:get-by-pk'>>[1]) => invoke('ef:get-by-pk', input),
  listUnits: () => invoke('units:list'),
};
