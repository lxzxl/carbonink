import type { ProviderConfigV2 } from '@shared/types.js';
import { invoke } from '../ipc.js';

/**
 * Per-domain renderer wrapper for the `settings:*` IPC channels.
 *
 * Phase 1b — LLM provider config. The split-storage policy lives in
 * `SettingsService`: provider config (no key) goes to sqlite, the API key
 * itself goes to OS keychain via `CredentialService`. The renderer never
 * sees plaintext keys — `getProvider()` returns `{ ...config, apiKeyMasked }`
 * where `apiKeyMasked` is e.g. `sk-...abcd` or `null` if no key is stored.
 *
 * Wire shape (Item 3 Task 10b): all three provider channels speak
 * `ProviderConfigV2` — a flat `{provider, model, baseUrl?}`. The legacy
 * V1 discriminated union is gone from the wire; the main side derives
 * `apiKeyKeyref` from `provider` deterministically.
 *
 * `pingProvider`'s optional `apiKey` lets the Settings drawer's "Test
 * connection" button work against a freshly-typed key that hasn't been
 * saved yet. The handler builds a one-shot AiClient layer with the
 * overrideKey and does not persist (no `save-provider` is called).
 */
export const settingsApi = {
  available: () => invoke('settings:available'),
  getProvider: () => invoke('settings:get-provider'),
  saveProvider: (input: { config: ProviderConfigV2; apiKey: string }) =>
    invoke('settings:save-provider', input),
  clearProvider: () => invoke('settings:clear-provider'),
  pingProvider: (input: { config: ProviderConfigV2; apiKey?: string }) =>
    invoke('settings:ping-provider', input),
  getAmapKey: () => invoke('settings:get-amap-key'),
  setAmapKey: (input: { value: string }) => invoke('settings:set-amap-key', input),
  // Item 3 Task 10c — pi-ai runtime catalog. The renderer caches both lists
  // via TanStack Query; provider list is invalidated never (pi-ai's catalog
  // is bundled, not network-fetched), model list is invalidated per provider.
  listProviders: () => invoke('settings:list-providers'),
  listModels: (provider: string) => invoke('settings:list-models', { provider }),
};
