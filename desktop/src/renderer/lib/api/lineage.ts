import { invoke } from '../ipc';

export const lineageApi = {
  get: (input: { entity: 'activity_data' | 'answer'; id: string }) => invoke('lineage:get', input),
};
