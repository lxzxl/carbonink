import type {
  ActivityImportEfChoice,
  ActivityImportGroupDecision,
  ActivityImportMapping,
  TextRecommendQuery,
} from '@shared/types.js';
import { invoke } from '../ipc.js';

/**
 * Batch activity-import API (ROADMAP §8.1-①). `pickFile` opens the native
 * dialog in the main process; every later call drives the staged token the
 * preview returned. Four steps: configure (mapping + period + org),
 * resolve-source*, decide (batch group EF decisions), import. `revalidate`
 * stays for the mapping-step live preview while editing. `recommendText`
 * is the group-level EF recommendation (FTS backbone + optional LLM top-3).
 */
export const activityImportApi = {
  pickFile: () => invoke('activity-import:pick-file'),
  revalidate: (input: { token: string; mapping: ActivityImportMapping; period_id: string }) =>
    invoke('activity-import:revalidate', input),
  configure: (input: {
    token: string;
    mapping: ActivityImportMapping;
    period_id: string;
    organization_id: string;
  }) => invoke('activity-import:configure', input),
  listSources: (input: { token: string; organization_id: string }) =>
    invoke('activity-import:list-sources', input),
  resolveSource: (input: { token: string; name: string; source_id: string | null }) =>
    invoke('activity-import:resolve-source', input),
  listGroups: (input: { token: string }) => invoke('activity-import:list-groups', input),
  decide: (input: { token: string; decisions: ActivityImportGroupDecision[] }) =>
    invoke('activity-import:decide', input),
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
