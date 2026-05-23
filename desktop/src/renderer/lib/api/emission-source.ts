import { invoke } from '../ipc.js';

/**
 * Per-domain renderer wrapper for the `source:*` IPC channels.
 *
 * EmissionSource = per-site source definition (boiler, fleet, purchased
 * electricity, etc). `/sources` route uses `listByOrg` + `create` + `update`
 * + the soft-delete `delete` (which the service maps to is_active=false).
 *
 * snake_case payloads (organization_id, site_id) match the IPC boundary
 * convention — see `orgApi` for rationale.
 */
export const sourceApi = {
  create: (input: Parameters<typeof invoke<'source:create'>>[1]) => invoke('source:create', input),
  getById: (input: { id: string }) => invoke('source:get-by-id', input),
  listBySite: (input: { site_id: string }) => invoke('source:list-by-site', input),
  listByOrg: (input: { organization_id: string }) => invoke('source:list-by-org', input),
  update: (input: Parameters<typeof invoke<'source:update'>>[1]) => invoke('source:update', input),
  delete: (input: { id: string }) => invoke('source:delete', input),
  // Preset catalog — built-in seed of typical sources (browse + 1-click add).
  listPresets: () => invoke('source:list-presets'),
  addFromPreset: (input: { organization_id: string; preset_id: string; site_id?: string }) =>
    invoke('source:add-from-preset', input),
};
