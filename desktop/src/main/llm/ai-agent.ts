import {
  type AgentEvent,
  type AgentLoopConfig,
  type AgentMessage,
  type AgentToolResult,
  agentLoop,
  type AgentTool as PiAgentTool,
} from '@earendil-works/pi-agent-core';
import {
  type Api,
  type AssistantMessage,
  getModel,
  type Message,
  type Model,
  type StreamOptions,
  streamSimple,
  type ToolCall,
  type TSchema,
} from '@earendil-works/pi-ai';
import type { CredentialService } from '@main/services/credential-service.js';
import { apiKeyKeyrefForProvider, type ProviderConfigV2 } from '@shared/types.js';
import { Context, Effect, Layer } from 'effect';
import { type ZodSchema, z } from 'zod';
import {
  AgentMaxTurns,
  AgentStalled,
  AiAuthError,
  type AiErr,
  AiNoData,
  AiProviderError,
  AiRateLimited,
  AiSchemaMismatch,
  AiTimeout,
} from './errors.js';

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
 * Implementation note: this uses pi-agent-core's *low-level* `agentLoop`
 * primitive (not the stateful `Agent` class). The primitive is a single async
 * function call returning an `EventStream` we drain inside an `Effect.async`,
 * which composes naturally with cancellation + the rest of the Effect
 * pipeline. The `Agent` class adds session/transcript state we don't need —
 * each `run()` is a fresh transcript by design.
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
   * (canonical JSON with sorted keys) so the UI can recognize repeats
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
   * The loop injects an additional `submit_response` tool the model must
   * call exactly once with `schema`-shaped args. That call is treated as
   * the terminal step: the parsed result becomes `run()`'s output. Models
   * that never call it exhaust `maxTurns` and surface `AgentMaxTurns`.
   *
   * Defaults:
   * - `maxTurns`: 20
   * - `timeoutMs`: 300_000 (5 minutes)
   *
   * Failure modes:
   * - `AiErr` — any provider/transport failure (same union as `AiClient`).
   * - `AgentMaxTurns` — loop ran out of turn budget.
   * - `AgentStalled` — loop detected a no-progress pattern.
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
  /**
   * Test-only injection. Production callers leave this undefined — the
   * layer resolves the model via pi-ai's registry. Tests pass a faux
   * `Model` from `registerFauxProvider()` so the network is never touched.
   */
  model?: Model<Api>;
}

/**
 * Heuristic for distinguishing auth failures from other provider errors
 * inside a pi-ai error message. Mirrors `ai-client.ts` — pi-ai doesn't
 * expose status codes on `AssistantMessage`, only a free-form
 * `errorMessage` from the provider SDK.
 */
const AUTH_ERROR_HINTS = ['401', 'unauthorized', 'invalid api key', 'invalid_api_key', 'api key'];

function looksLikeAuthError(message: string | undefined): boolean {
  if (!message) return false;
  const lower = message.toLowerCase();
  return AUTH_ERROR_HINTS.some((hint) => lower.includes(hint));
}

/**
 * Stable hash of a tool-call's arguments for no-progress detection.
 *
 * `JSON.stringify` with a key-replacer that sorts keys gives us a canonical
 * form: object key order is non-deterministic by default in JS, but the
 * stalled detector needs to recognize "same call repeated" regardless of
 * how the provider's JSON parser ordered keys. Nested objects need
 * recursive sorting; the replacer handles that automatically because
 * JSON.stringify walks each property after the replacer transforms it.
 */
function argsHash(args: unknown): string {
  return JSON.stringify(args, (_key, value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(value as Record<string, unknown>).sort()) {
        sorted[k] = (value as Record<string, unknown>)[k];
      }
      return sorted;
    }
    return value;
  });
}

/**
 * Build a `Layer` that provides {@link AiAgentTag}.
 *
 * Resolves the API key + provider + model at layer-build time. `run()` wires
 * up pi-agent-core's `agentLoop` primitive inside an `Effect.async` so
 * cancellation, timeouts, and tagged-error mapping all work via the standard
 * Effect plumbing. The closure captures the resolved key/model — no per-turn
 * keychain lookup.
 */
export function buildAiAgentLayer(deps: BuildAiAgentDeps): Layer.Layer<AiAgentTag> {
  return Layer.effect(
    AiAgentTag,
    Effect.sync(() => {
      const { config, credentials, overrideKey } = deps;
      const apiKey = overrideKey ?? credentials.get(apiKeyKeyrefForProvider(config.provider));

      // Mirror ai-client.ts: tests inject a Model directly; production looks
      // it up from pi-ai's generated registry. The `getModel` signature in
      // pi-ai's d.ts is keyed off `KnownProvider`, but our config carries a
      // free-form `string` — the cast is the same trick ai-client uses.
      const resolvedModel: Model<Api> | undefined =
        deps.model ??
        (getModel as unknown as (p: string, m: string) => Model<Api> | undefined)(
          config.provider,
          config.model,
        );

      const agent: AiAgent = {
        run: <T>(args: {
          systemPrompt: string;
          userPrompt: string;
          schema: ZodSchema<T>;
          tools: AgentTool[];
          maxTurns?: number;
          timeoutMs?: number;
        }): Effect.Effect<
          { result: T; trace: AgentTrace },
          AiErr | AgentMaxTurns | AgentStalled,
          never
        > => {
          const maxTurns = args.maxTurns ?? 20;
          const timeoutMs = args.timeoutMs ?? 300_000;

          return Effect.async<
            { result: T; trace: AgentTrace },
            AiErr | AgentMaxTurns | AgentStalled,
            never
          >((resume) => {
            // ---- Pre-flight: auth + model availability -----------------
            if (apiKey === null || apiKey === undefined || apiKey === '') {
              resume(Effect.fail(new AiAuthError({ provider: config.provider })));
              return;
            }
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

            // ---- Per-run state ------------------------------------------
            const startTime = Date.now();
            const controller = new AbortController();
            const toolCallLog: AgentTrace['toolCalls'] = [];
            const totalTokens = { input: 0, output: 0 };
            let turnCount = 0;
            let httpStatus: number | undefined;
            let timedOut = false;
            let settled = false;
            // The submit_response tool stashes either a parsed answer or a
            // schema-mismatch error so the post-loop code can pick the
            // appropriate Effect to resume with. Captures across the loop's
            // event lifetime; resolved once after agentLoop's promise settles.
            let finalResponse: T | null = null;
            let finalResponseError: AiSchemaMismatch | null = null;
            // Tracks "same (tool, argsHash) twice in a row" for stalled
            // detection. `prepareNextTurn` checks this after each turn.
            let stalledTool: string | null = null;

            const timer = setTimeout(() => {
              timedOut = true;
              controller.abort();
            }, timeoutMs);

            const settleWith = (
              effect: Effect.Effect<
                { result: T; trace: AgentTrace },
                AiErr | AgentMaxTurns | AgentStalled
              >,
            ) => {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              resume(effect);
            };

            // ---- Tools: inject submit_response + wrap callers ----------
            // The submit_response tool's "execution" is just argument
            // validation — the model calls it once to signal "here is the
            // final answer". We stash the parsed value (or the error) for
            // the post-loop pickup; the tool itself returns an empty
            // success result so the agent doesn't get confused.
            const submitResponseTool: AgentTool = {
              name: 'submit_response',
              description:
                'Submit your final structured response. Call this exactly once when you have gathered enough information to answer the question.',
              parameters: z.toJSONSchema(args.schema),
              execute: async (rawArgs) => {
                const parsed = args.schema.safeParse(rawArgs);
                if (!parsed.success) {
                  finalResponseError = new AiSchemaMismatch({
                    raw: JSON.stringify(rawArgs),
                    cause: parsed.error,
                  });
                  return { ok: false, error: 'schema_mismatch' };
                }
                finalResponse = parsed.data;
                return { ok: true };
              },
            };

            const allTools = [...args.tools, submitResponseTool];

            // Adapt our `AgentTool` shape onto pi-agent-core's `AgentTool`
            // (which extends pi-ai's `Tool`). The library calls
            // `execute(toolCallId, validatedArgs, signal, onUpdate)` with
            // pre-validated arguments; we collapse to our simpler
            // `(args) => Promise<unknown>` contract.
            //
            // `terminate: true` on the submit_response result tells
            // pi-agent-core to stop after this batch instead of starting a
            // new turn — saves an unnecessary LLM round-trip.
            const piTools: PiAgentTool<TSchema>[] = allTools.map((tool) => ({
              name: tool.name,
              label: tool.name,
              description: tool.description,
              parameters: tool.parameters as TSchema,
              execute: async (
                _toolCallId: string,
                params: unknown,
              ): Promise<AgentToolResult<unknown>> => {
                const result = await tool.execute(params);
                const terminate = tool.name === 'submit_response' && finalResponse !== null;
                return {
                  content: [{ type: 'text', text: JSON.stringify(result) }],
                  details: result,
                  ...(terminate ? { terminate: true } : {}),
                };
                // Caller-side throws bubble up naturally; pi-agent-core
                // converts them to an error tool result the model can
                // observe and react to on the next turn.
              },
            }));

            // ---- agentLoop config --------------------------------------
            const config_: AgentLoopConfig = {
              model: resolvedModel,
              apiKey,
              maxRetries: 0,
              // Pass-through filter: pi-agent-core's `AgentMessage` is a
              // superset of pi-ai's `Message` (it also covers harness-only
              // custom message types like bashExecution). We only push
              // user/assistant/toolResult messages in v1, so the filter is
              // a narrowing type guard.
              convertToLlm: (messages) =>
                messages.filter(
                  (m): m is Message =>
                    m.role === 'user' || m.role === 'assistant' || m.role === 'toolResult',
                ),
              shouldStopAfterTurn: () => {
                turnCount += 1;
                // The submit_response tool sets `finalResponse`; once set,
                // we're done — agentLoop will emit agent_end and the
                // promise resolves. We don't need to actively stop here,
                // but doing so lets us avoid wasting another LLM call if
                // the model produced text alongside the tool call.
                if (finalResponse !== null || finalResponseError !== null) {
                  return true;
                }
                // Max turns: signal stop. Post-loop check converts to
                // AgentMaxTurns since no finalResponse is set.
                return turnCount >= maxTurns;
              },
              // When the model calls submit_response with args that pass
              // pi-agent-core's parameter validation but fail our zod
              // safeParse (inside execute), our tool execute sets
              // `finalResponseError` and returns `{ok: false}`. This hook
              // promotes that to a `terminate: true` so the loop ends
              // after this batch instead of looping the model again.
              afterToolCall: async ({ toolCall }) => {
                if (toolCall.name !== 'submit_response') return undefined;
                // Either path that reaches here means submit_response was
                // called — done either way.
                return { terminate: true };
              },
              prepareNextTurn: ({ message }) => {
                // No-progress detection: look at the tool calls in this
                // assistant message + the previous turn's last tool call.
                // If the model repeats the same (name, argsHash) it gets a
                // single retry; doing it twice in a row → stalled.
                const toolCalls = message.content.filter(
                  (c): c is ToolCall => c.type === 'toolCall',
                );
                for (const tc of toolCalls) {
                  if (tc.name === 'submit_response') continue;
                  const hash = argsHash(tc.arguments);
                  const last = toolCallLog[toolCallLog.length - 1];
                  if (last && last.tool === tc.name && last.argsHash === hash) {
                    // Already saw this exact call last turn — stalled.
                    stalledTool = tc.name;
                  }
                  toolCallLog.push({
                    tool: tc.name,
                    argsHash: hash,
                    durationMs: 0,
                  });
                }
                // Aggregate per-turn usage. pi-ai always populates `usage`
                // with zeros when a provider doesn't report; safe to add.
                totalTokens.input += message.usage.input;
                totalTokens.output += message.usage.output;
                return undefined;
              },
            };

            // ---- Stream function: pi-ai's streamSimple + our onResponse
            // We wrap streamSimple so onResponse captures HTTP status (for
            // 401/429/5xx mapping) and our timeout's AbortController wins
            // over pi-ai's own (per-provider, inconsistent) timeout.
            const streamFn = (
              model: Model<Api>,
              context: Parameters<typeof streamSimple>[1],
              opts?: StreamOptions,
            ): ReturnType<typeof streamSimple> => {
              return streamSimple(model, context, {
                ...opts,
                apiKey,
                signal: controller.signal,
                onResponse: (r) => {
                  httpStatus = r.status;
                },
              });
            };

            // ---- Kick off the loop -------------------------------------
            const promptMessages: AgentMessage[] = [
              { role: 'user', content: args.userPrompt, timestamp: Date.now() },
            ];

            const stream = agentLoop(
              promptMessages,
              {
                systemPrompt: args.systemPrompt,
                messages: [],
                tools: piTools,
              },
              config_,
              controller.signal,
              streamFn,
            );

            // Drain events for trace-side telemetry; result() resolves on
            // agent_end. Tool execution start/end events let us record per-
            // tool duration without touching the dispatcher.
            const toolStartedAt = new Map<string, number>();
            const toolArgsById = new Map<string, unknown>();
            (async () => {
              try {
                for await (const event of stream as unknown as AsyncIterable<AgentEvent>) {
                  if (event.type === 'tool_execution_start') {
                    toolStartedAt.set(event.toolCallId, Date.now());
                    toolArgsById.set(event.toolCallId, event.args);
                  } else if (event.type === 'tool_execution_end') {
                    const startedAt = toolStartedAt.get(event.toolCallId);
                    if (startedAt !== undefined) {
                      // Latest entry with matching tool name + no
                      // duration: update with elapsed. Walks backwards so
                      // parallel tool calls don't collide.
                      for (let i = toolCallLog.length - 1; i >= 0; i--) {
                        const entry = toolCallLog[i];
                        if (entry && entry.tool === event.toolName && entry.durationMs === 0) {
                          entry.durationMs = Date.now() - startedAt;
                          break;
                        }
                      }
                      toolStartedAt.delete(event.toolCallId);
                    }
                    // If pi-agent-core's argument validation failed for
                    // submit_response, our execute() never ran — the loop
                    // got back an error tool result and would otherwise
                    // loop again. Promote that to AiSchemaMismatch so the
                    // caller surface gets a typed failure, then abort.
                    if (
                      event.toolName === 'submit_response' &&
                      event.isError === true &&
                      finalResponseError === null
                    ) {
                      const args = toolArgsById.get(event.toolCallId);
                      const errText =
                        event.result &&
                        typeof event.result === 'object' &&
                        Array.isArray((event.result as { content?: unknown }).content)
                          ? (event.result as { content: unknown[] }).content
                              .filter(
                                (c: unknown): c is { type: 'text'; text: string } =>
                                  typeof c === 'object' &&
                                  c !== null &&
                                  (c as { type?: unknown }).type === 'text',
                              )
                              .map((c) => c.text)
                              .join('')
                          : '';
                      finalResponseError = new AiSchemaMismatch({
                        raw: JSON.stringify(args ?? {}),
                        cause: errText || 'submit_response validation failed',
                      });
                    }
                    toolArgsById.delete(event.toolCallId);
                  }
                  // Stalled-detection trigger after each turn — done here
                  // (vs prepareNextTurn) so we can resume the Effect
                  // *during* the event loop without racing the promise.
                  if (event.type === 'turn_end' && stalledTool && !settled) {
                    const tool = stalledTool;
                    controller.abort();
                    settleWith(Effect.fail(new AgentStalled({ tool, turnCount })));
                    return;
                  }
                }
              } catch {
                // Stream iteration failures bubble through the
                // .result()/promise path below — swallow here so we don't
                // double-settle.
              }
            })();

            // Wait for agent_end + final message list.
            stream
              .result()
              .then((messages: AgentMessage[]) => {
                if (settled) return;
                clearTimeout(timer);

                // Build the trace common to every exit path.
                const trace = (stopReason: AgentTrace['stopReason']): AgentTrace => ({
                  turnCount,
                  toolCalls: toolCallLog,
                  totalTokens,
                  totalDurationMs: Date.now() - startTime,
                  stopReason,
                });

                if (timedOut) {
                  settleWith(Effect.fail(new AiTimeout({ timeoutMs })));
                  return;
                }

                // Look at the last assistant message: if pi-ai surfaced an
                // error/aborted stop reason, translate it. pi-agent-core
                // doesn't throw — failures live in the final message's
                // stopReason + errorMessage.
                const lastAssistant = [...messages]
                  .reverse()
                  .find((m): m is AssistantMessage => m.role === 'assistant');
                if (
                  lastAssistant &&
                  (lastAssistant.stopReason === 'error' || lastAssistant.stopReason === 'aborted')
                ) {
                  if (lastAssistant.stopReason === 'aborted') {
                    settleWith(Effect.fail(new AiProviderError({ cause: 'aborted' })));
                    return;
                  }
                  if (httpStatus === 401 || httpStatus === 403) {
                    settleWith(Effect.fail(new AiAuthError({ provider: config.provider })));
                    return;
                  }
                  if (httpStatus === 429) {
                    settleWith(Effect.fail(new AiRateLimited({})));
                    return;
                  }
                  if (httpStatus !== undefined && httpStatus >= 500 && httpStatus < 600) {
                    settleWith(
                      Effect.fail(
                        new AiProviderError({
                          status: httpStatus,
                          ...(lastAssistant.errorMessage !== undefined
                            ? { cause: lastAssistant.errorMessage }
                            : {}),
                        }),
                      ),
                    );
                    return;
                  }
                  if (looksLikeAuthError(lastAssistant.errorMessage)) {
                    settleWith(Effect.fail(new AiAuthError({ provider: config.provider })));
                    return;
                  }
                  settleWith(
                    Effect.fail(
                      new AiProviderError({
                        ...(httpStatus !== undefined ? { status: httpStatus } : {}),
                        ...(lastAssistant.errorMessage !== undefined
                          ? { cause: lastAssistant.errorMessage }
                          : {}),
                      }),
                    ),
                  );
                  return;
                }

                // Schema-mismatch from submit_response wins next: the model
                // tried to finalize but produced invalid args.
                if (finalResponseError) {
                  settleWith(Effect.fail(finalResponseError));
                  return;
                }

                // Happy path: finalResponse set by submit_response.
                if (finalResponse !== null) {
                  settleWith(
                    Effect.succeed({
                      result: finalResponse,
                      trace: trace('completed'),
                    }),
                  );
                  return;
                }

                // Max turns reached without a final answer.
                if (turnCount >= maxTurns) {
                  const lastTool = toolCallLog[toolCallLog.length - 1]?.tool;
                  settleWith(
                    Effect.fail(
                      new AgentMaxTurns({
                        turnCount,
                        ...(lastTool !== undefined ? { lastTool } : {}),
                      }),
                    ),
                  );
                  return;
                }

                // Loop exited but no final response — model gave up.
                settleWith(Effect.fail(new AiNoData({})));
              })
              .catch((err: unknown) => {
                if (settled) return;
                clearTimeout(timer);
                if (timedOut) {
                  settleWith(Effect.fail(new AiTimeout({ timeoutMs })));
                  return;
                }
                const errMsg = err instanceof Error ? err.message : String(err);
                settleWith(
                  Effect.fail(
                    looksLikeAuthError(errMsg)
                      ? new AiAuthError({ provider: config.provider })
                      : new AiProviderError({ cause: err }),
                  ),
                );
              });

            // Cancellation hook: caller-driven interrupt (e.g. user closes
            // the modal). Mirrors ai-client.ts's pattern.
            return Effect.sync(() => {
              clearTimeout(timer);
              controller.abort();
            });
          });
        },
      };
      return agent;
    }),
  );
}
