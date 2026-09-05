import type { CredentialService } from '@main/services/credential-service.js';
import type { ProviderConfigV2 } from '@shared/types.js';
import { Cause, Effect, Exit, Option } from 'effect';
import type { ZodSchema } from 'zod';
import { type AgentTool, type AgentTrace, AiAgentTag, buildAiAgentLayer } from './ai-agent.js';
import { AiClientTag, buildAiClientLayer } from './ai-client.js';
import type { AgentMaxTurns, AgentStalled, AiErr } from './errors.js';
import type { LlmCache } from './llm-cache.js';

/**
 * Optional deterministic-result cache for a single AI call. When present
 * the boundary checks the store (zod-validated) before building the
 * AiClient layer and stores successes after. Callers build the key with
 * `buildCacheKey` so every input the result depends on — provider, model,
 * prompt version, dataset/inventory fingerprint — invalidates correctly.
 */
export interface AiCacheRequest {
  store: LlmCache;
  key: string;
  /** Per-call-site TTL: EF data moves slowly, inventories faster. */
  ttlMs: number;
}

/**
 * Boundary helper for Promise-shape consumers (extraction-service,
 * ef-matcher-service, questionnaire-service) that need a one-shot
 * `generateObject` call against pi-ai but haven't migrated to Effect-
 * returning public APIs.
 *
 * Builds a fresh `AiClientLayer` per call so that provider config
 * changes between requests are picked up — matches the per-call layer
 * construction pattern already used by the IpcContext lazy getters for
 * `classificationService` / `answerLayer`.
 *
 * On failure, the underlying `AiErr` is rethrown directly (not wrapped
 * in Effect's `FiberFailure`). Callers do `catch (err)` and `instanceof`
 * one of the `AiErr` subclasses (or use the `_tag` discriminant) to
 * translate the typed error into their own public error shape.
 */
export async function runAiObject<T>(
  config: ProviderConfigV2,
  credentials: CredentialService,
  args: {
    schema: ZodSchema<T>;
    prompt: string;
    system?: string;
    images?: Buffer[];
    timeoutMs?: number;
    cache?: AiCacheRequest;
    /**
     * Test-only, forwarded to {@link buildAiClientLayer}'s existing hook: a
     * faux-backed `Models` collection so a suite can drive the real call path
     * without a network or a key. Production callers leave it undefined and
     * the layer resolves the model from the shared collection.
     */
    modelsInstance?: Parameters<typeof buildAiClientLayer>[0]['modelsInstance'];
  },
): Promise<T> {
  if (args.cache) {
    const hit = args.cache.store.get(args.cache.key, args.schema);
    if (hit !== null) return hit;
  }
  const layer = buildAiClientLayer({
    config,
    credentials,
    ...(args.modelsInstance !== undefined ? { modelsInstance: args.modelsInstance } : {}),
  });
  const program = Effect.gen(function* () {
    const ai = yield* AiClientTag;
    return yield* ai.generateObject(args);
  });
  // `runPromiseExit` (not `runPromise`) lets us unwrap the cause and
  // rethrow the original tagged AiErr instead of Effect's
  // `FiberFailure` wrapper. The wrapper's `cause` field carries the
  // underlying error but its stringification is opaque ("FiberFailure:
  // An error has occurred"), which makes it useless for downstream
  // `instanceof AiAuthError` / `err._tag === 'AiAuthError'` checks.
  const exit = await Effect.runPromiseExit(program.pipe(Effect.provide(layer)));
  if (Exit.isSuccess(exit)) {
    args.cache?.store.set(args.cache.key, exit.value, args.cache.ttlMs);
    return exit.value;
  }
  const failure = Cause.failureOption(exit.cause);
  if (Option.isSome(failure)) {
    throw failure.value satisfies AiErr;
  }
  // Defects (Effect.die / panic) — not part of the typed AiErr union.
  // Rethrow Effect's wrapper so the unexpected failure is at least
  // observable in logs; downstream catch handlers will see it as a
  // generic Error and surface a "something went wrong" message.
  throw Cause.squash(exit.cause);
}

/**
 * Agent-loop sibling of {@link runAiObject} for Promise-shape consumers
 * (today: ef-matcher-service's group-recommendation loop). Same per-call
 * layer construction, same tagged-error rethrow contract — the extra
 * failure modes (`AgentMaxTurns`, `AgentStalled`) join the `AiErr` union
 * in the throw path so callers can pattern-match on `_tag` to decide
 * whether to fall back to a single-shot request.
 */
export async function runAiAgent<T>(
  config: ProviderConfigV2,
  credentials: CredentialService,
  args: {
    systemPrompt: string;
    userPrompt: string;
    schema: ZodSchema<T>;
    tools: AgentTool[];
    maxTurns?: number;
    timeoutMs?: number;
    cache?: AiCacheRequest;
    /**
     * Test-only, forwarded to {@link buildAiAgentLayer}'s existing hook: a
     * faux-backed `Models` collection so a suite can drive the real turn loop
     * without a network or a key. Production callers leave it undefined and
     * the layer resolves the model from the shared collection.
     */
    modelsInstance?: Parameters<typeof buildAiAgentLayer>[0]['modelsInstance'];
  },
): Promise<{ result: T; trace: AgentTrace; cached: boolean }> {
  if (args.cache) {
    const hit = args.cache.store.get(args.cache.key, args.schema);
    if (hit !== null) {
      return {
        result: hit,
        trace: {
          turnCount: 0,
          toolCalls: [],
          totalTokens: { input: 0, output: 0 },
          totalDurationMs: 0,
          stopReason: 'completed',
        },
        cached: true,
      };
    }
  }
  const layer = buildAiAgentLayer({
    config,
    credentials,
    ...(args.modelsInstance !== undefined ? { modelsInstance: args.modelsInstance } : {}),
  });
  const program = Effect.gen(function* () {
    const agent = yield* AiAgentTag;
    return yield* agent.run(args);
  });
  const exit = await Effect.runPromiseExit(program.pipe(Effect.provide(layer)));
  if (Exit.isSuccess(exit)) {
    args.cache?.store.set(args.cache.key, exit.value.result, args.cache.ttlMs);
    return { ...exit.value, cached: false };
  }
  const failure = Cause.failureOption(exit.cause);
  if (Option.isSome(failure)) {
    throw failure.value satisfies AiErr | AgentMaxTurns | AgentStalled;
  }
  throw Cause.squash(exit.cause);
}
