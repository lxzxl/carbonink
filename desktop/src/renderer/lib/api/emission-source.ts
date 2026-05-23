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
  /**
   * Same shape as `listByOrg` plus per-source usage stats (activity_count,
   * total_co2e_kg, last_activity_at). Used by /sources for the enriched
   * card view; do NOT call this from other surfaces — they pay extra
   * aggregation cost for stats they don't display.
   */
  listByOrgWithStats: (input: { organization_id: string }) =>
    invoke('source:list-by-org-with-stats', input),
  update: (input: Parameters<typeof invoke<'source:update'>>[1]) => invoke('source:update', input),
  delete: (input: { id: string }) => invoke('source:delete', input),
  // Preset catalog — built-in seed of typical sources (browse + 1-click add).
  listPresets: () => invoke('source:list-presets'),
  addFromPreset: (input: { organization_id: string; preset_id: string; site_id?: string }) =>
    invoke('source:add-from-preset', input),
  /**
   * Batch-add N presets in one atomic transaction. The catalog drawer uses
   * this for its "添加选中" action so users can flip a whole category
   * (e.g. all 12 Air Travel presets) into their org in a single click.
   */
  addFromPresets: (input: { organization_id: string; preset_ids: string[]; site_id?: string }) =>
    invoke('source:add-from-presets', input),
};
