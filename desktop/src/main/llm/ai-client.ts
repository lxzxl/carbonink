import {
  type Api,
  type AssistantMessage,
  complete,
  type Model,
  type Tool,
} from '@earendil-works/pi-ai';
import type { CredentialService } from '@main/services/credential-service.js';
import { apiKeyKeyrefForProvider, type ProviderConfigV2 } from '@shared/types.js';
import { Context, Effect, Layer, Schedule } from 'effect';
import { type ZodSchema, z } from 'zod';
import {
  AiAuthError,
  type AiErr,
  AiNoData,
  AiProviderError,
  AiRateLimited,
  AiSchemaMismatch,
  AiTimeout,
} from './errors.js';
import { resolveModel } from './pi-catalog.js';

/**
 * Effect-wrapped wrapper around `@earendil-works/pi-ai`.
 *
 * Three method signatures are exposed for downstream consumers:
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
   * This does NOT swallow errors — the caller (IPC handler) maps the
   * typed error onto the UI's `{ok: false, error}` shape so the error
   * label can be localized.
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
  /**
   * Selected provider + model. V2's flat shape — the keychain keyref is
   * derived from `provider` via {@link apiKeyKeyrefForProvider} (stable
   * across providers), rather than carried as a literal field.
   */
  config: ProviderConfigV2;
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
 * - Resolves the pi-ai `Model` via `resolveModel(provider, modelId)` unless
 *   the caller provides one (tests). That helper falls back to a synthetic
 *   same-provider model for ids the bundled catalog doesn't know (the
 *   Settings custom-model escape hatch) and returns `undefined` only for
 *   unknown providers; we fail loudly with `AiProviderError` then.
 */
export function buildAiClientLayer(deps: BuildAiClientDeps): Layer.Layer<AiClientTag> {
  return Layer.effect(
    AiClientTag,
    Effect.sync(() => {
      const { config, credentials, overrideKey } = deps;
      const apiKey = overrideKey ?? credentials.get(apiKeyKeyrefForProvider(config.provider));

      // The pi-ai model object: either supplied by tests, or resolved from
      // pi-ai's generated MODELS registry — with a synthetic fallback for
      // custom ids newer than the bundled catalog (see resolveModel). Only
      // an unknown provider leaves this undefined; every method then fails
      // with `AiProviderError`. We don't pre-validate at Layer construction
      // so a build with a stale config still loads and surfaces a
      // recognizable error at call time.
      const resolvedModel: Model<Api> | undefined =
        deps.model ?? resolveModel(config.provider, config.model);

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

      /**
       * Single round-trip to pi-ai with status + timeout capture.
       *
       * Uses an `AbortController` + setTimeout pair to enforce `timeoutMs`
       * client-side (pi-ai's `timeoutMs` option is per-provider-SDK and not
       * uniformly honored across our 32 providers — we want one canonical
       * timeout that always works). `onResponse` captures the HTTP status
       * so `mapPiToAiErr` can discriminate 401 / 429 / 5xx without falling
       * back to string matching.
       *
       * On rejection, distinguishes "we caused the abort" (→ AiTimeout) from
       * "the provider threw something else" (→ AiAuthError when the message
       * looks like an auth failure, else AiProviderError).
       */
      const callPi = (args: {
        tools?: Tool[];
        prompt: string;
        system?: string;
        images?: Buffer[];
        timeoutMs: number;
      }): Effect.Effect<{ msg: AssistantMessage; httpStatus: number | undefined }, AiErr, never> =>
        Effect.async<{ msg: AssistantMessage; httpStatus: number | undefined }, AiErr, never>(
          (resume) => {
            if (!resolvedModel) {
              resume(
                Effect.fail(
                  new AiProviderError({
                    cause: `pi-ai has no model registered for provider="${config.provider}" model="${config.model}"`,
                  }),
                ),
              );
              return;
            }
            if (!apiKey) {
              resume(Effect.fail(new AiAuthError({ provider: config.provider })));
              return;
            }
            const controller = new AbortController();
            let timedOut = false;
            let httpStatus: number | undefined;
            const timer = setTimeout(() => {
              timedOut = true;
              controller.abort();
            }, args.timeoutMs);

            // When images are present, the user message becomes a parts array
            // (text + image blocks). All our image input is PNG from the
            // pdf-to-images render path; widen later if other mime types
            // surface.
            const userContent:
              | string
              | Array<
                  { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
                > =
              args.images && args.images.length > 0
                ? [
                    { type: 'text', text: args.prompt },
                    ...args.images.map((buf) => ({
                      type: 'image' as const,
                      data: buf.toString('base64'),
                      mimeType: 'image/png',
                    })),
                  ]
                : args.prompt;

            complete(
              resolvedModel,
              {
                ...(args.system ? { systemPrompt: args.system } : {}),
                messages: [{ role: 'user', content: userContent, timestamp: Date.now() }],
                ...(args.tools ? { tools: args.tools } : {}),
              },
              {
                apiKey,
                signal: controller.signal,
                maxRetries: 0, // Effect.retry is the single retry authority
                onResponse: (r) => {
                  httpStatus = r.status;
                },
              },
            )
              .then((msg) => {
                clearTimeout(timer);
                // pi-ai catches AbortSignal-driven rejections and returns a
                // `stopReason: 'aborted'` message rather than throwing. Without
                // this guard the `.then()` path would route through
                // `mapPiToAiErr` and surface AiProviderError instead of the
                // typed AiTimeout the caller asked for.
                if (timedOut) {
                  resume(Effect.fail(new AiTimeout({ timeoutMs: args.timeoutMs })));
                  return;
                }
                resume(Effect.succeed({ msg, httpStatus }));
              })
              .catch((e: unknown) => {
                clearTimeout(timer);
                if (timedOut) {
                  resume(Effect.fail(new AiTimeout({ timeoutMs: args.timeoutMs })));
                  return;
                }
                const errMsg = e instanceof Error ? e.message : String(e);
                resume(
                  Effect.fail(
                    looksLikeAuthError(errMsg)
                      ? new AiAuthError({ provider: config.provider })
                      : new AiProviderError({ cause: e }),
                  ),
                );
              });

            return Effect.sync(() => {
              clearTimeout(timer);
              controller.abort();
            });
          },
        );

      /**
       * Map a pi-ai error path (`stopReason: 'error' | 'aborted'`) onto our
       * tagged `AiErr` union. Prefers HTTP status (captured via onResponse)
       * over string heuristics — see `AUTH_ERROR_HINTS`.
       */
      const mapPiToAiErr = (msg: AssistantMessage, httpStatus: number | undefined): AiErr => {
        if (msg.stopReason === 'aborted') {
          // Aborted but not by our timer (timer path is handled in callPi).
          // Surface as a provider error so retry policy treats it like a
          // transient failure.
          return new AiProviderError({ cause: 'aborted' });
        }
        if (httpStatus === 401 || httpStatus === 403) {
          return new AiAuthError({ provider: config.provider });
        }
        if (httpStatus === 429) {
          return new AiRateLimited({});
        }
        if (httpStatus !== undefined && httpStatus >= 500 && httpStatus < 600) {
          return new AiProviderError({
            status: httpStatus,
            ...(msg.errorMessage !== undefined ? { cause: msg.errorMessage } : {}),
          });
        }
        if (looksLikeAuthError(msg.errorMessage)) {
          return new AiAuthError({ provider: config.provider });
        }
        return new AiProviderError({
          ...(httpStatus !== undefined ? { status: httpStatus } : {}),
          ...(msg.errorMessage !== undefined ? { cause: msg.errorMessage } : {}),
        });
      };

      /**
       * Retry transient failures (rate limited + 5xx). Auth / schema /
       * timeout / no-data fail fast — those won't get better with retries
       * and the user/UI should see them immediately. 200ms exponential
       * backoff capped at 2 retries (3 attempts total).
       */
      const RETRY_SCHEDULE = Schedule.exponential('200 millis').pipe(
        Schedule.compose(Schedule.recurs(2)),
      );

      const isRetryable = (e: AiErr): boolean =>
        e._tag === 'AiRateLimited' || e._tag === 'AiProviderError';

      const client: AiClient = {
        generateObject: <T>(args: {
          schema: ZodSchema<T>;
          prompt: string;
          system?: string;
          images?: Buffer[];
          timeoutMs?: number;
        }): Effect.Effect<T, AiErr, never> => {
          const timeoutMs = args.timeoutMs ?? 60_000;
          // Force the model to emit its answer through a single tool whose
          // parameters are the user's Zod schema, rendered as JSON Schema.
          // pi-ai's `Tool.parameters` is typed `TSchema` (TypeBox); plain
          // JSON Schema is structurally a `TSchema` and providers we've
          // verified accept it (spike + faux tests).
          const jsonSchema = z.toJSONSchema(args.schema) as unknown as Tool['parameters'];
          const tool: Tool = {
            name: 'submit_response',
            description: 'Submit your structured response.',
            parameters: jsonSchema,
          };

          const program = callPi({
            tools: [tool],
            prompt: args.prompt,
            ...(args.system !== undefined ? { system: args.system } : {}),
            ...(args.images !== undefined ? { images: args.images } : {}),
            timeoutMs,
          }).pipe(
            Effect.flatMap(({ msg, httpStatus }) => {
              if (msg.stopReason === 'error' || msg.stopReason === 'aborted') {
                return Effect.fail(mapPiToAiErr(msg, httpStatus));
              }
              // Look for the structured response in the tool-call output.
              const toolCall = msg.content.find(
                (c): c is Extract<AssistantMessage['content'][number], { type: 'toolCall' }> =>
                  c.type === 'toolCall' && c.name === 'submit_response',
              );
              if (!toolCall) {
                return Effect.fail(new AiNoData({}));
              }
              const parsed = args.schema.safeParse(toolCall.arguments);
              if (!parsed.success) {
                return Effect.fail(
                  new AiSchemaMismatch({
                    raw: JSON.stringify(toolCall.arguments),
                    cause: parsed.error,
                  }),
                );
              }
              return Effect.succeed(parsed.data);
            }),
            Effect.retry({
              schedule: RETRY_SCHEDULE,
              while: isRetryable,
            }),
          );

          return program;
        },

        generateText: (args: {
          prompt: string;
          system?: string;
          timeoutMs?: number;
        }): Effect.Effect<string, AiErr, never> => {
          const timeoutMs = args.timeoutMs ?? 60_000;
          const program = callPi({
            prompt: args.prompt,
            ...(args.system !== undefined ? { system: args.system } : {}),
            timeoutMs,
          }).pipe(
            Effect.flatMap(({ msg, httpStatus }) => {
              if (msg.stopReason === 'error' || msg.stopReason === 'aborted') {
                return Effect.fail(mapPiToAiErr(msg, httpStatus));
              }
              // Concatenate every text block — some providers split long
              // responses across multiple TextContent entries.
              const text = msg.content
                .filter(
                  (c): c is Extract<AssistantMessage['content'][number], { type: 'text' }> =>
                    c.type === 'text',
                )
                .map((c) => c.text)
                .join('');
              if (!text) return Effect.fail(new AiNoData({}));
              return Effect.succeed(text);
            }),
            Effect.retry({
              schedule: RETRY_SCHEDULE,
              while: isRetryable,
            }),
          );

          return program;
        },

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
