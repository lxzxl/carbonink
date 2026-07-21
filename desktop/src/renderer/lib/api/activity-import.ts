import type {
  ActivityImportEfChoice,
  ActivityImportMapping,
  TextRecommendQuery,
} from '@shared/types.js';
import { invoke } from '../ipc.js';

/**
 * Batch activity-import API (ROADMAP §8.1-①). `pickFile` opens the native
 * dialog in the main process; every later call drives the staged token the
 * preview returned. `recommendText` is the group-level EF recommendation
 * (FTS backbone + optional LLM top-3, one call per confirm-group).
 */
export const activityImportApi = {
  pickFile: () => invoke('activity-import:pick-file'),
  revalidate: (input: { token: string; mapping: ActivityImportMapping; period_id: string }) =>
    invoke('activity-import:revalidate', input),
  listSources: (input: { token: string; organization_id: string }) =>
    invoke('activity-import:list-sources', input),
  resolveSource: (input: { token: string; name: string; source_id: string | null }) =>
    invoke('activity-import:resolve-source', input),
  listGroups: (input: { token: string }) => invoke('activity-import:list-groups', input),
  confirmGroup: (input: {
    token: string;
    group_key: string;
    ef: ActivityImportEfChoice;
    fuel_code: string | null;
  }) => invoke('activity-import:confirm-group', input),
  skipGroup: (input: { token: string; group_key: string }) =>
    invoke('activity-import:skip-group', input),
  import: (input: { token: string }) => invoke('activity-import:import', input),
  discard: (input: { token: string }) => invoke('activity-import:discard', input),
  recommendText: (input: TextRecommendQuery) => invoke('ef:recommend-text', input),
};
