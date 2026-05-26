import { type Api, complete, getModel, type Model } from '@earendil-works/pi-ai';
import type { CredentialService } from '@main/services/credential-service.js';
import type { ProviderConfig } from '@shared/types.js';
import { Context, Effect, Layer } from 'effect';
import type { ZodSchema } from 'zod';
import { AiAuthError, type AiErr, AiProviderError } from './errors.js';

/**
 * Effect-wrapped wrapper around `@earendil-works/pi-ai`.
 *
 * `AiClient` replaces the old Promise-shape `LLMClient`. Three method
 * signatures are exposed for downstream consumers:
 *
 * - `generateObject` — structured extraction with a zod schema (Task 2).
 * - `generateText` — free-text completion, used by report-narrative (Task 2).
 * - `ping` — smoke-test the provider + key, used by the Settings UI.
 *
 * All methods return `Effect.Effect<T, AiErr, never>` so the consumer can
 * pattern-match on the tagged error union from `./errors.ts`. Retries +
 * timeouts are built into the implementation (Task 2 wires them up; Task 1
 * ships only `ping`).
 *
 * The service is constructed lazily inside a `Layer` so the credential
 * lookup (and any future model construction) happens once at Layer-build
 * time, not on every method call. Production callers build the layer per
 * IPC request (provider config can change between requests); tests inject
 * a faux pi-ai `Model` directly via `deps.model`.
 */
export interface AiClient {
  /**
   * Structured extraction. Sends `prompt` (and `system` / `images` if
   * present) to the model with a tool-call schema derived from `schema`;
   * validates the response against `schema`; returns the parsed object.
   *
   * Stub in Task 1 — wired up in Task 2 via pi-ai's tool-call pattern.
   */
  generateObject<T>(args: {
    schema: ZodSchema<T>;
    prompt: string;
    system?: string;
    images?: Buffer[];
    timeoutMs?: number;
  }): Effect.Effect<T, AiErr, never>;

  /**
   * Free-text completion. Used by report-narrative for streaming-style
   * generation (in v1 we collect the full text; streaming UI is future work).
   *
   * Stub in Task 1 — wired up in Task 2.
   */
  generateText(args: {
    prompt: string;
    system?: string;
    timeoutMs?: number;
  }): Effect.Effect<string, AiErr, never>;

  /**
   * Smoke-test the provider + API key. Sends a one-token "ok" prompt with
   * a small max-token budget. Returns `{ ok: true }` on success.
   *
   * - missing/invalid key → {@link AiAuthError}
   * - any other failure (5xx, network, malformed response) → {@link AiProviderError}
   *
   * Unlike the old `LLMClient.ping`, this does NOT swallow errors — the
   * caller (IPC handler) maps the typed error onto the UI's
   * `{ok: false, error}` shape so the error label can be localized.
   */
  ping(): Effect.Effect<{ ok: true }, AiAuthError | AiProviderError, never>;
}

/**
 * Context.Tag for dependency injection. Services consume `AiClient` by
 * yielding the tag and let an upstream Layer provide the implementation.
 * The tag string is stable so devtools and Layer composition remain
 * predictable across the codebase.
 */
export class AiClientTag extends Context.Tag('llm/AiClient')<AiClientTag, AiClient>() {}

export interface BuildAiClientDeps {
  /** Selected provider + model. `apiKeyKeyref` points at the keychain entry. */
  config: ProviderConfig;
  /** Credential store; consulted for the API key unless `overrideKey` is set. */
  credentials: CredentialService;
  /**
   * Optional plaintext key that bypasses `credentials`. Used by the Settings
   * UI's "Test connection" button to verify a typed-but-not-saved key.
   */
  overrideKey?: string;
  /**
   * Test-only injection. Production callers leave this undefined — the
   * layer resolves the model via pi-ai's registry. Tests pass a faux
   * `Model` from `registerFauxProvider()` so the network is never touched.
   */
  model?: Model<Api>;
}

/**
 * Heuristic for distinguishing auth failures from other provider errors
 * inside a pi-ai error message. pi-ai doesn't expose the HTTP status code
 * on the `AssistantMessage`, only a free-form `errorMessage` from the
 * provider SDK. These substrings cover the common shape: OpenAI / Anthropic
 * / DeepSeek all surface "401", "Unauthorized", or "invalid API key" when
 * the credential is bad.
 */
const AUTH_ERROR_HINTS = ['401', 'unauthorized', 'invalid api key', 'invalid_api_key', 'api key'];

function looksLikeAuthError(message: string | undefined): boolean {
  if (!message) return false;
  const lower = message.toLowerCase();
  return AUTH_ERROR_HINTS.some((hint) => lower.includes(hint));
}

/**
 * Build a `Layer` that provides {@link AiClientTag}.
 *
 * - Reads the API key up front (overrideKey ?? credentials.get(keyref)).
 *   This is cheap enough to do at layer build time, and lets methods short-
 *   circuit synchronously with `AiAuthError` when the key is missing.
 * - Resolves the pi-ai `Model` via `getModel(provider, modelId)` unless the
 *   caller provides one (tests). pi-ai's `getModel` returns `undefined` for
 *   unknown provider/model strings; we fail loudly with `AiProviderError`.
 */
export function buildAiClientLayer(deps: BuildAiClientDeps): Layer.Layer<AiClientTag> {
  return Layer.effect(
    AiClientTag,
    Effect.sync(() => {
      const { config, credentials, overrideKey } = deps;
      const apiKey = overrideKey ?? credentials.get(config.apiKeyKeyref);

      // The pi-ai model object: either supplied by tests, or looked up from
      // pi-ai's generated MODELS registry. The cast is unavoidable —
      // `ProviderConfig.provider` is a free-form string (the legacy shape
      // narrows it via discriminated union, but pi-ai's `getModel` is keyed
      // off `KnownProvider`). If the lookup misses, every method fails with
      // `AiProviderError`; we don't pre-validate at Layer construction so a
      // build with a stale config still loads and surfaces a recognizable
      // error at call time.
      const resolvedModel: Model<Api> | undefined =
        deps.model ??
        (getModel as unknown as (p: string, m: string) => Model<Api> | undefined)(
          config.provider,
          config.model,
        );

      /**
       * Validate auth + model availability up front. Returns the same narrow
       * error union as `ping()` so the typed-error signature flows through
       * unchanged. generateObject/generateText (Task 2) will wrap this and
       * widen to the full `AiErr` union.
       */
      const ensureReady = (): Effect.Effect<
        { model: Model<Api>; apiKey: string },
        AiAuthError | AiProviderError
      > => {
        if (apiKey === null || apiKey === undefined || apiKey === '') {
          return Effect.fail(new AiAuthError({ provider: config.provider }));
        }
        if (!resolvedModel) {
          return Effect.fail(
            new AiProviderError({
              cause: `pi-ai has no model registered for provider="${config.provider}" model="${config.model}"`,
            }),
          );
        }
        return Effect.succeed({ model: resolvedModel, apiKey });
      };

      const client: AiClient = {
        // generateObject + generateText are scaffolded but not implemented in
        // Task 1. Effect.die is loud at runtime so any consumer that calls
        // them before Task 2 lands gets an unmissable defect, not a silent
        // hang or a bogus result.
        generateObject: <T>(_args: {
          schema: ZodSchema<T>;
          prompt: string;
          system?: string;
          images?: Buffer[];
          timeoutMs?: number;
        }): Effect.Effect<T, AiErr, never> =>
          Effect.die(new Error('AiClient.generateObject not yet implemented (Task 2)')),

        generateText: (_args: {
          prompt: string;
          system?: string;
          timeoutMs?: number;
        }): Effect.Effect<string, AiErr, never> =>
          Effect.die(new Error('AiClient.generateText not yet implemented (Task 2)')),

        ping: (): Effect.Effect<{ ok: true }, AiAuthError | AiProviderError, never> =>
          Effect.gen(function* () {
            const { model, apiKey } = yield* ensureReady();

            // The smallest valid request pi-ai supports: a single user message
            // with a one-token answer budget. We don't care about the content
            // of the response — only that the provider returns a 2xx and
            // pi-ai's stopReason isn't 'error'.
            const message = yield* Effect.tryPromise({
              try: () =>
                complete(
                  model,
                  { messages: [{ role: 'user', content: 'ok', timestamp: Date.now() }] },
                  { apiKey, maxTokens: 4 },
                ),
              catch: (e): AiAuthError | AiProviderError => {
                // pi-ai's `complete()` only rejects on unexpected throws (the
                // provider's normal error paths surface as stopReason='error'
                // below, not as a rejection). Map any throw to ProviderError
                // unless the underlying message looks like an auth failure.
                const errMsg = e instanceof Error ? e.message : String(e);
                return looksLikeAuthError(errMsg)
                  ? new AiAuthError({ provider: config.provider })
                  : new AiProviderError({ cause: e });
              },
            });

            // pi-ai's error path: `stopReason === 'error'` carries
            // `errorMessage`. Distinguish auth from generic provider errors
            // by string-matching the message (pi-ai doesn't expose status
            // codes on AssistantMessage).
            if (message.stopReason === 'error' || message.stopReason === 'aborted') {
              if (looksLikeAuthError(message.errorMessage)) {
                return yield* Effect.fail(new AiAuthError({ provider: config.provider }));
              }
              return yield* Effect.fail(
                new AiProviderError({ cause: message.errorMessage ?? message.stopReason }),
              );
            }

            return { ok: true } as const;
          }),
      };

      return client;
    }),
  );
}
