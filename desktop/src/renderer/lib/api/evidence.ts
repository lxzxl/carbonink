import { invoke } from '../ipc';

export const evidenceApi = {
  /** Exactly one of activity_data_id / answer_id (enforced main-side). */
  add: (input: {
    activity_data_id?: string;
    answer_id?: string;
    filename: string;
    mimeType: string;
    bytes: Uint8Array;
    note?: string;
  }) => invoke('evidence:add', input),
  list: (input: { activity_data_id?: string; answer_id?: string }) =>
    invoke('evidence:list', input),
  remove: (input: { id: string }) => invoke('evidence:remove', input),
};
