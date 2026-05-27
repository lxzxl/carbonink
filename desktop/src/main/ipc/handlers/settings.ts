import { AiClientTag, buildAiClientLayer } from '@main/llm/ai-client.js';
import { providerConfig } from '@shared/types.js';
import { Effect } from 'effect';
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

const setAmapKeyInput = z.object({
  value: z.string(),
});

/**
 * Phase 1b settings handlers — provider config CRUD + the "Test connection"
 * action used by the Settings drawer.
 *
 * Critical: `settings:get-provider` returns a **masked** API key (or `null`),
 * never plaintext. The plaintext path (`SettingsService.getProviderConfigWithKey`)
 * is intentionally not wired here — it stays main-only for AiClient.
 *
 * `settings:ping-provider` accepts an optional `apiKey` so the UI can verify
 * a key the user has just typed but not yet saved. The key is passed
 * in-memory to AiClient via the `overrideKey` build dep and is never
 * persisted by this handler — `settings:save-provider` is the only
 * persistence path.
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
      // Build a one-shot AiClient layer for this ping. `overrideKey` is the
      // typed-but-not-saved key flow — the Settings UI passes a fresh key
      // through here without committing it to the credential store. When
      // omitted, the layer falls back to `credentials.get(apiKeyKeyref)`.
      const layer = buildAiClientLayer({
        config: parsed.config,
        credentials: ctx.credentialService,
        ...(parsed.apiKey !== undefined ? { overrideKey: parsed.apiKey } : {}),
      });
      // ping() only fails with AiAuthError | AiProviderError; map both onto
      // the `{ok: false, error}` shape the renderer toasts verbatim under a
      // localized "Connection failed" title (see AIProviderSection.tsx).
      // Error labels are short, machine-readable strings — the UI does NOT
      // currently translate them, so we keep them in English and informative
      // (provider name for auth failures, cause for provider errors).
      return Effect.runPromise(
        Effect.gen(function* () {
          const ai = yield* AiClientTag;
          yield* ai.ping();
          return { ok: true as const };
        }).pipe(
          Effect.provide(layer),
          Effect.catchTags({
            AiAuthError: (e) =>
              Effect.succeed({
                ok: false as const,
                error: `auth_failed: ${e.provider}`,
              }),
            AiProviderError: (e) =>
              Effect.succeed({
                ok: false as const,
                error: `provider_error: ${e.cause ?? 'unknown'}`,
              }),
          }),
        ),
      );
    },
    'settings:get-amap-key': () => ctx.settingsService.getAmapKey(),
    'settings:set-amap-key': (input) => {
      const parsed = setAmapKeyInput.parse(input);
      ctx.settingsService.setAmapKey(parsed.value);
    },
  };
}
