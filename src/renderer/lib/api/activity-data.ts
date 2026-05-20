import { invoke } from '../ipc.js';

/**
 * Per-domain renderer wrapper for the `activity:*` IPC channels.
 *
 * ActivityData rows pin a snapshot of the EF used at entry time + carry the
 * service-computed `computed_co2e_kg`. `/activities` route uses
 * `listByPeriod`; the dashboard consumes `totalsByPeriod`
 * ({ total_co2e_kg, scope1_kg, scope2_kg, scope3_kg }) directly via
 * TanStack Query.
 *
 * `getById` (Phase 3 sub-project 2) reads an activity with the joined pinned_ef,
 * used by the RebindEfDrawer.
 */
export const activityApi = {
  create: (input: Parameters<typeof invoke<'activity:create'>>[1]) =>
    invoke('activity:create', input),
  listByPeriod: (input: { reporting_period_id: string }) =>
    invoke('activity:list-by-period', input),
  totalsByPeriod: (input: { reporting_period_id: string }) =>
    invoke('activity:totals-by-period', input),
  getById: (input: { id: string }) => invoke('activity:get-by-id', input),
  rebindEf: (input: {
    activity_id: string;
    new_ef_pk: { factor_code: string; year: number; source: string; geography: string; dataset_version: string };
  }) => invoke('activity:rebind-ef', input),
};
