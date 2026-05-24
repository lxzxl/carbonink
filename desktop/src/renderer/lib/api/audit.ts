import { invoke } from '../ipc';

export const auditApi = {
  list: (input: { event_kinds?: string[]; since?: string; until?: string; limit?: number }) =>
    invoke('audit:list', input),
  exportCsv: (input: { event_kinds?: string[]; since?: string; until?: string; limit?: number }) =>
    invoke('audit:export-csv', input),
};
