import type { CredentialService } from '@main/services/credential-service.js';
import { apiKeyKeyrefForProvider, type ProviderConfigV2 } from '@shared/types.js';
import { Context, Effect, Layer } from 'effect';
import type { ZodSchema } from 'zod';
import type { AgentMaxTurns, AgentStalled, AiErr } from './errors.js';

/**
 * Effect-wrapped wrapper around `@earendil-works/pi-agent-core`.
 *
 * Where {@link AiClient} (in `./ai-client.ts`) performs a single-shot LLM
 * round-trip with optional structured-output validation, `AiAgent` drives a
 * tool-using *agent loop*: the model is given a toolbox + a final-answer
 * schema and chooses how many turns it needs to compose the answer. The loop
 * terminates when the model produces a result that validates against
 * `schema`, when the `maxTurns` budget is exhausted, when the loop stalls
 * (same tool + same args, repeatedly), or when the deadline (`timeoutMs`)
 * elapses.
 *
 * The service mirrors {@link AiClient}'s Tag/Layer pattern so consumers can
 * compose both freely. Both services resolve their API key + model at
 * Layer-build time and cache them in the closure — production callers build
 * the layer per IPC request because provider config can change between
 * requests; tests bypass the network entirely by faux-ing pi-agent-core's
 * stream function.
 *
 * Task 1 (this commit) ships only the scaffold: Layer + Tag + the public
 * surface (`AiAgent.run`) wired to `Effect.die`. Task 2 implements the turn
 * loop on top of pi-agent-core's `Agent` class.
 */
export interface AgentTool {
  /**
   * Stable tool identifier the model uses to invoke this capability. Must be
   * unique across the toolbox; pi-agent-core surfaces collisions as
   * runtime errors.
   */
  name: string;
  /**
   * Natural-language description the model sees in the system prompt's tool
   * list. Be specific about side effects and return-value shape — the model
   * picks tools by matching descriptions, not by reading the executor.
   */
  description: string;
  /**
   * JSON Schema (or TypeBox `TSchema`, which is structurally compatible) for
   * the tool's argument object. Validated by pi-agent-core before `execute`
   * runs; validation failures surface as tool-result errors the model can
   * react to.
   */
  parameters: unknown;
  /**
   * Async executor invoked once per tool call the model issues. Receives
   * validated `args` (matching `parameters`); returns any JSON-serializable
   * value. Throwing here becomes a tool-result error visible to the model
   * on its next turn.
   */
  execute: (args: unknown) => Promise<unknown>;
}

/**
 * Execution trace captured during a single `run()` invocation. Used by the
 * UI to surface "the agent took N turns to answer this question" without
 * needing to subscribe to pi-agent-core's lower-level event stream. The
 * `stopReason` lets the caller distinguish a clean completion from one of
 * the recoverable failure modes — useful in the `Effect.catchTags` branch
 * even though those modes also surface as typed errors.
 */
export interface AgentTrace {
  /** Number of completed assistant turns. */
  turnCount: number;
  /**
   * Per-tool-call telemetry. `argsHash` is a stable hash of the args
   * (sha256 of canonical JSON, truncated) so the UI can recognize repeats
   * without leaking arg payloads into logs.
   */
  toolCalls: Array<{ tool: string; argsHash: string; durationMs: number }>;
  /**
   * Token totals aggregated across every assistant turn in this run.
   * Sourced from pi-ai's per-turn usage telemetry; providers that don't
   * report usage contribute 0 + 0.
   */
  totalTokens: { input: number; output: number };
  /** Wall-clock duration of `run()` from invocation to settlement. */
  totalDurationMs: number;
  /**
   * Why the loop exited:
   *
   * - `completed` — model produced a schema-valid final answer.
   * - `max_turns` — `maxTurns` reached without a final answer.
   * - `stalled` — no-progress detector tripped.
   * - `aborted` — caller-driven cancellation (e.g. user dismissed the modal).
   */
  stopReason: 'completed' | 'max_turns' | 'stalled' | 'aborted';
}

export interface AiAgent {
  /**
   * Run the agent loop against `systemPrompt` + `userPrompt` with access to
   * `tools`, stopping when the model produces an answer that validates
   * against `schema`.
   *
   * Defaults (Task 2 will codify these):
   * - `maxTurns`: 20
   * - `timeoutMs`: 5 minutes
   *
   * Failure modes:
   * - `AiErr` — any provider/transport failure (same union as `AiClient`).
   * - `AgentMaxTurns` — loop ran out of turn budget.
   * - `AgentStalled` — loop detected a no-progress pattern.
   *
   * Stubbed in Task 1: any invocation fails with `Effect.die`. Task 2 wires
   * pi-agent-core's `Agent` class up to this method.
   */
  run<T>(args: {
    systemPrompt: string;
    userPrompt: string;
    schema: ZodSchema<T>;
    tools: AgentTool[];
    maxTurns?: number;
    timeoutMs?: number;
  }): Effect.Effect<{ result: T; trace: AgentTrace }, AiErr | AgentMaxTurns | AgentStalled, never>;
}

/**
 * Context.Tag for dependency injection. Mirrors {@link AiClientTag}; the
 * stable string makes Layer composition and devtools traces predictable.
 */
export class AiAgentTag extends Context.Tag('llm/AiAgent')<AiAgentTag, AiAgent>() {}

export interface BuildAiAgentDeps {
  /**
   * Selected provider + model. V2's flat shape — the keychain keyref is
   * derived from `provider` via {@link apiKeyKeyrefForProvider}.
   */
  config: ProviderConfigV2;
  /** Credential store; consulted for the API key unless `overrideKey` is set. */
  credentials: CredentialService;
  /**
   * Optional plaintext key that bypasses `credentials`. Primarily for the
   * Settings UI's "Test connection" surface; agent flows in v1 always read
   * from the credential store.
   */
  overrideKey?: string;
}

/**
 * Build a `Layer` that provides {@link AiAgentTag}.
 *
 * Task 1 scaffold: resolves the API key + provider + model at layer-build
 * time (so future invocations don't pay the lookup cost per-turn) and
 * stores them in the closure. `run()` is `Effect.die` so any consumer that
 * accidentally invokes it before Task 2 lands gets a loud failure rather
 * than a silent hang or a misleading stub result.
 */
export function buildAiAgentLayer(deps: BuildAiAgentDeps): Layer.Layer<AiAgentTag> {
  return Layer.effect(
    AiAgentTag,
    Effect.sync(() => {
      // Layer-build-time resolution. Stored in the closure so Task 2's
      // `run()` implementation can reach them without re-resolving on every
      // turn. The underscore prefix marks them as "scaffold-only" — Task 2
      // will rename and consume them. We intentionally do NOT validate here
      // (no eager throw on missing key) so the layer always loads; the
      // missing-key failure surfaces as a typed `AiAuthError` at call time,
      // matching `AiClient`'s behavior.
      const _apiKey =
        deps.overrideKey ?? deps.credentials.get(apiKeyKeyrefForProvider(deps.config.provider));
      const _provider = deps.config.provider;
      const _model = deps.config.model;

      const agent: AiAgent = {
        run: () => Effect.die(new Error('AiAgent.run not yet implemented (Item 4 Task 2)')),
      };
      return agent;
    }),
  );
}
