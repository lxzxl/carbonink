import { invoke } from '../ipc.js';

/**
 * Per-domain renderer wrapper for the `license:*` IPC channels (Phase 4
 * sub-project A). The Settings page License section (sub-project B) calls
 * `licenseApi.getState()` from a TanStack `useQuery`; the activation form
 * calls `setJwt` from a mutation; the device-list "Deactivate" calls
 * `clear()`.
 */
export const licenseApi = {
  getState: () => invoke('license:get-state'),
  setJwt: (input: { jwt: string }) => invoke('license:set-jwt', input),
  clear: () => invoke('license:clear'),
};
