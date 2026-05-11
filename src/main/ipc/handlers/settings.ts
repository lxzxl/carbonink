import { providerConfig } from '@shared/types.js';
import { z } from 'zod';
import type { IpcContext } from '../context.js';
import type { IpcTypeMap } from '../types.js';

/**
 * Input schemas for the write/test channels. We zod-parse at the IPC boundary
 * (defense in depth: even if `IpcTypeMap` is correct, runtime values from the
 * preload could be hostile after a renderer compromise).
 */
const saveProviderInput = z.object({
  config: providerConfig,
  apiKey: z.string().min(1),
});

const pingProviderInput = z.object({
  config: providerConfig,
  apiKey: z.string().min(1).optional(),
});

/**
 * Phase 1b settings handlers — provider config CRUD + the "Test connection"
 * action used by the Settings drawer.
 *
 * Critical: `settings:get-provider` returns a **masked** API key (or `null`),
 * never plaintext. The plaintext path (`SettingsService.getProviderConfigWithKey`)
 * is intentionally not wired here — it stays main-only for LLMClient.
 *
 * `settings:ping-provider` accepts an optional `apiKey` so the UI can verify
 * a key the user has just typed but not yet saved. The key is passed
 * in-memory to `LLMClient.pingWithKey` and is never persisted by this
 * handler — `settings:save-provider` is the only persistence path.
 */
export function settingsHandlers(ctx: IpcContext): {
  [K in keyof IpcTypeMap]?: IpcTypeMap[K];
} {
  return {
    'settings:available': () => ctx.credentialService.isAvailable(),
    'settings:get-provider': () => ctx.settingsService.getProviderConfig(),
    'settings:save-provider': (input) => {
      const parsed = saveProviderInput.parse(input);
      ctx.settingsService.saveProviderConfig(parsed.config, parsed.apiKey);
    },
    'settings:clear-provider': () => ctx.settingsService.clearProviderConfig(),
    'settings:ping-provider': async (input) => {
      const parsed = pingProviderInput.parse(input);
      if (parsed.apiKey !== undefined) {
        return ctx.llmClient.pingWithKey(parsed.config, parsed.apiKey);
      }
      return ctx.llmClient.ping(parsed.config);
    },
  };
}
