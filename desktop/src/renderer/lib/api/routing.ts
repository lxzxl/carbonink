import { invoke } from '../ipc.js';

export const routingApi = {
  lookup: (input: { mode: 'driving' | 'transit' | 'air'; origin: string; destination: string }) =>
    invoke('routing:lookup', input),
};
