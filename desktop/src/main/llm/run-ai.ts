import type { CredentialService } from '@main/services/credential-service.js';
import type { ProviderConfigV2 } from '@shared/types.js';
import { Cause, Effect, Exit, Option } from 'effect';
import type { ZodSchema } from 'zod';
import { type AgentTool, type AgentTrace, AiAgentTag, buildAiAgentLayer } from './ai-agent.js';
import { AiClientTag, buildAiClientLayer } from './ai-client.js';
import type { AgentMaxTurns, AgentStalled, AiErr } from './errors.js';

/**
 * Boundary helper for Promise-shape consumers (extraction-service,
 * ef-matcher-service, questionnaire-service) that need a one-shot
 * `generateObject` call against pi-ai but haven't migrated to Effect-
 * returning public APIs.
 *
 * Builds a fresh `AiClientLayer` per call so that provider config
 * changes between requests are picked up — matches the per-call layer
 * construction pattern already used by the IpcContext lazy getters for
 * `classificationService` / `answerLayer`. Future PR can hoist this to
 * a per-context layer if the per-call cost matters; today the pi-ai
 * model registry lookup is cheap and the credentials read is a single
 * `safeStorage` decrypt.
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
  },
): Promise<T> {
  const layer = buildAiClientLayer({ config, credentials });
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
  if (Exit.isSuccess(exit)) return exit.value;
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
  },
): Promise<{ result: T; trace: AgentTrace }> {
  const layer = buildAiAgentLayer({ config, credentials });
  const program = Effect.gen(function* () {
    const agent = yield* AiAgentTag;
    return yield* agent.run(args);
  });
  const exit = await Effect.runPromiseExit(program.pipe(Effect.provide(layer)));
  if (Exit.isSuccess(exit)) return exit.value;
  const failure = Cause.failureOption(exit.cause);
  if (Option.isSome(failure)) {
    throw failure.value satisfies AiErr | AgentMaxTurns | AgentStalled;
  }
  throw Cause.squash(exit.cause);
}
