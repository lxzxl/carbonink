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
  // User-facing activation: paste a humanized cik- key from the activation
  // email; main process trades it for a JWT via /api/v1/activate and stores
  // the verified JWT in Keychain. setJwt above is now a power-user / dev
  // backdoor (used by issue-dev-license.mjs).
  activateWithKey: (input: { license_key: string }) =>
    invoke('license:activate-with-key', input),
  clear: () => invoke('license:clear'),
};
