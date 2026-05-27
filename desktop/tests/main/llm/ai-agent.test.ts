import type { StreamOptions } from '@earendil-works/pi-ai';
import {
  type FauxProviderRegistration,
  type FauxResponseFactory,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  registerFauxProvider,
} from '@earendil-works/pi-ai';
import { type AgentTool, AiAgentTag, buildAiAgentLayer } from '@main/llm/ai-agent';
import type { CredentialService } from '@main/services/credential-service';
import type { ProviderConfigV2 } from '@shared/types';
import { Effect } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
//
// Mirrors `ai-client.test.ts`: same fakeCredentials shape, same fakeConfig
// shape, same faux pi-ai provider. The agent loop's only LLM-facing seam is
// the `streamFn` (wired to `streamSimple` in the impl), so we get the same
// stub-by-queueing-responses behavior here.

function fakeCredentials(apiKey: string | null = 'sk-fake-test-key'): CredentialService {
  return {
    get: vi.fn((_k: string) => apiKey),
    set: vi.fn(),
    getMasked: vi.fn(),
    delete: vi.fn(),
    isAvailable: vi.fn().mockReturnValue(true),
  } as unknown as CredentialService;
}

function fakeConfig(): ProviderConfigV2 {
  return { provider: 'deepseek', model: 'deepseek-chat' };
}

/**
 * Build a faux response factory that simulates a given HTTP status via the
 * pi-ai `onResponse` hook. Mirrors the ai-client.test.ts helper.
 */
function fauxErrorWithStatus(status: number, errorMessage: string): FauxResponseFactory {
  return async (_ctx, opts: StreamOptions | undefined, _state, model) => {
    await opts?.onResponse?.({ status, headers: {} }, model);
    return fauxAssistantMessage([fauxText('error')], {
      stopReason: 'error',
      errorMessage,
    });
  };
}

let faux: FauxProviderRegistration | undefined;

afterEach(() => {
  faux?.unregister();
  faux = undefined;
});

// ---------------------------------------------------------------------------
// AiAgent.run — Layer + Tag wiring
// ---------------------------------------------------------------------------

describe('AiAgent — Layer + Tag wiring', () => {
  it('resolves the tag and exposes run()', async () => {
    faux = registerFauxProvider();

    const layer = buildAiAgentLayer({
      config: fakeConfig(),
      credentials: fakeCredentials(),
      model: faux.getModel(),
    });

    const program = Effect.gen(function* () {
      const agent = yield* AiAgentTag;
      expect(typeof agent.run).toBe('function');
      return 'ok';
    });

    const r = await Effect.runPromise(program.pipe(Effect.provide(layer)));
    expect(r).toBe('ok');
  });

  it('rejects with AiAuthError when credentials are missing', async () => {
    faux = registerFauxProvider();

    const layer = buildAiAgentLayer({
      config: fakeConfig(),
      credentials: fakeCredentials(null),
      model: faux.getModel(),
    });

    const program = Effect.gen(function* () {
      const agent = yield* AiAgentTag;
      return yield* agent.run({
        systemPrompt: 's',
        userPrompt: 'u',
        schema: z.object({ answer: z.string() }),
        tools: [],
      });
    });

    const result = await Effect.runPromise(
      program.pipe(
        Effect.provide(layer),
        Effect.catchTag('AiAuthError', (e) =>
          Effect.succeed({ caught: true, provider: e.provider }),
        ),
      ),
    );
    expect(result).toEqual({ caught: true, provider: 'deepseek' });
    expect(faux.state.callCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AiAgent.run — happy path
// ---------------------------------------------------------------------------

describe('AiAgent.run — happy path', () => {
  it('completes after tool call + submit_response with the parsed object + trace', async () => {
    const answerSchema = z.object({ answer: z.string() });

    // Tool the agent will call before submitting. Spec: list_activities-ish.
    const listActivities: AgentTool = {
      name: 'list_activities',
      description: 'List activity data rows',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      execute: vi.fn(async () => ({ rows: [{ id: 1, co2e_kg: 42 }] })),
    };

    faux = registerFauxProvider();
    faux.setResponses([
      // Turn 1: model calls our domain tool.
      fauxAssistantMessage([fauxToolCall('list_activities', {})], { stopReason: 'toolUse' }),
      // Turn 2: model submits the final response with valid args.
      fauxAssistantMessage([fauxToolCall('submit_response', { answer: 'forty two kg' })], {
        stopReason: 'toolUse',
      }),
    ]);

    const layer = buildAiAgentLayer({
      config: fakeConfig(),
      credentials: fakeCredentials(),
      model: faux.getModel(),
    });

    const program = Effect.gen(function* () {
      const agent = yield* AiAgentTag;
      return yield* agent.run({
        systemPrompt: 'you are a helpful agent',
        userPrompt: 'tell me about activities',
        schema: answerSchema,
        tools: [listActivities],
      });
    });

    const { result, trace } = await Effect.runPromise(program.pipe(Effect.provide(layer)));

    expect(result).toEqual({ answer: 'forty two kg' });
    expect(listActivities.execute).toHaveBeenCalledOnce();
    expect(trace.stopReason).toBe('completed');
    // 2 turns: tool call + submit_response. shouldStopAfterTurn fires after
    // each, so turnCount increments twice.
    expect(trace.turnCount).toBeGreaterThanOrEqual(2);
    // Domain tool recorded (submit_response is intentionally not tracked).
    expect(trace.toolCalls.map((c) => c.tool)).toEqual(['list_activities']);
    expect(trace.totalDurationMs).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// AiAgent.run — max turns
// ---------------------------------------------------------------------------

describe('AiAgent.run — max turns', () => {
  it('fails AgentMaxTurns when the model never calls submit_response', async () => {
    const answerSchema = z.object({ answer: z.string() });

    // Tool that always returns success — the model is "stuck" calling it
    // repeatedly with varying args (each call uses the turn count as the
    // arg so stalled detection doesn't fire first).
    const callMany: AgentTool = {
      name: 'call_many',
      description: 'a tool the model keeps calling',
      parameters: {
        type: 'object',
        properties: { n: { type: 'integer' } },
        required: ['n'],
        additionalProperties: false,
      },
      execute: vi.fn(async () => ({ ok: true })),
    };

    faux = registerFauxProvider();
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall('call_many', { n: 1 })], { stopReason: 'toolUse' }),
      fauxAssistantMessage([fauxToolCall('call_many', { n: 2 })], { stopReason: 'toolUse' }),
      fauxAssistantMessage([fauxToolCall('call_many', { n: 3 })], { stopReason: 'toolUse' }),
      fauxAssistantMessage([fauxToolCall('call_many', { n: 4 })], { stopReason: 'toolUse' }),
    ]);

    const layer = buildAiAgentLayer({
      config: fakeConfig(),
      credentials: fakeCredentials(),
      model: faux.getModel(),
    });

    const program = Effect.gen(function* () {
      const agent = yield* AiAgentTag;
      return yield* agent.run({
        systemPrompt: 's',
        userPrompt: 'u',
        schema: answerSchema,
        tools: [callMany],
        maxTurns: 3,
      });
    });

    const result = await Effect.runPromise(
      program.pipe(
        Effect.provide(layer),
        Effect.catchTag('AgentMaxTurns', (e) =>
          Effect.succeed({
            caught: true,
            turnCount: e.turnCount,
            lastTool: e.lastTool,
          }),
        ),
      ),
    );
    expect(result).toMatchObject({ caught: true, turnCount: 3, lastTool: 'call_many' });
  });
});

// ---------------------------------------------------------------------------
// AiAgent.run — stalled detection
// ---------------------------------------------------------------------------

describe('AiAgent.run — stalled detection', () => {
  it('fails AgentStalled when the same tool + args repeats twice in a row', async () => {
    const answerSchema = z.object({ answer: z.string() });

    const repeatable: AgentTool = {
      name: 'repeatable',
      description: 'a tool',
      parameters: {
        type: 'object',
        properties: { q: { type: 'string' } },
        required: ['q'],
        additionalProperties: false,
      },
      execute: vi.fn(async () => ({ ok: true })),
    };

    faux = registerFauxProvider();
    // Two identical calls in a row → stalled trips on the second.
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall('repeatable', { q: 'same' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage([fauxToolCall('repeatable', { q: 'same' })], { stopReason: 'toolUse' }),
      // Safety net: if stalled fails to fire, max turns will catch.
      fauxAssistantMessage([fauxToolCall('repeatable', { q: 'same' })], { stopReason: 'toolUse' }),
    ]);

    const layer = buildAiAgentLayer({
      config: fakeConfig(),
      credentials: fakeCredentials(),
      model: faux.getModel(),
    });

    const program = Effect.gen(function* () {
      const agent = yield* AiAgentTag;
      return yield* agent.run({
        systemPrompt: 's',
        userPrompt: 'u',
        schema: answerSchema,
        tools: [repeatable],
        maxTurns: 10,
      });
    });

    const result = await Effect.runPromise(
      program.pipe(
        Effect.provide(layer),
        Effect.catchTag('AgentStalled', (e) =>
          Effect.succeed({ caught: true, tool: e.tool, turnCount: e.turnCount }),
        ),
      ),
    );
    expect(result).toMatchObject({ caught: true, tool: 'repeatable' });
  });

  it('argsHash is order-insensitive (keys in different order are still "same")', async () => {
    const answerSchema = z.object({ answer: z.string() });

    const repeatable: AgentTool = {
      name: 'repeatable',
      description: 'a tool',
      parameters: {
        type: 'object',
        properties: { a: { type: 'string' }, b: { type: 'integer' } },
        required: ['a', 'b'],
        additionalProperties: false,
      },
      execute: vi.fn(async () => ({ ok: true })),
    };

    faux = registerFauxProvider();
    // Same logical args, different key order. Stalled detector should
    // recognize these as equal via canonicalized JSON.
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall('repeatable', { a: 'x', b: 1 })], {
        stopReason: 'toolUse',
      }),
      fauxAssistantMessage([fauxToolCall('repeatable', { b: 1, a: 'x' })], {
        stopReason: 'toolUse',
      }),
      fauxAssistantMessage([fauxToolCall('repeatable', { a: 'x', b: 1 })], {
        stopReason: 'toolUse',
      }),
    ]);

    const layer = buildAiAgentLayer({
      config: fakeConfig(),
      credentials: fakeCredentials(),
      model: faux.getModel(),
    });

    const program = Effect.gen(function* () {
      const agent = yield* AiAgentTag;
      return yield* agent.run({
        systemPrompt: 's',
        userPrompt: 'u',
        schema: answerSchema,
        tools: [repeatable],
        maxTurns: 10,
      });
    });

    const result = await Effect.runPromise(
      program.pipe(
        Effect.provide(layer),
        Effect.catchTag('AgentStalled', () => Effect.succeed({ caught: true })),
      ),
    );
    expect(result).toEqual({ caught: true });
  });
});

// ---------------------------------------------------------------------------
// AiAgent.run — schema mismatch in submit_response
// ---------------------------------------------------------------------------

describe('AiAgent.run — schema mismatch in submit_response', () => {
  it('fails AiSchemaMismatch when submit_response args do not satisfy the schema', async () => {
    const answerSchema = z.object({
      scope: z.union([z.literal(1), z.literal(2), z.literal(3)]),
      category: z.string(),
    });

    faux = registerFauxProvider();
    faux.setResponses([
      // scope=99 is outside the literal union → safeParse fails.
      fauxAssistantMessage(
        [fauxToolCall('submit_response', { scope: 99, category: 'electricity' })],
        { stopReason: 'toolUse' },
      ),
    ]);

    const layer = buildAiAgentLayer({
      config: fakeConfig(),
      credentials: fakeCredentials(),
      model: faux.getModel(),
    });

    const program = Effect.gen(function* () {
      const agent = yield* AiAgentTag;
      return yield* agent.run({
        systemPrompt: 's',
        userPrompt: 'u',
        schema: answerSchema,
        tools: [],
      });
    });

    const result = await Effect.runPromise(
      program.pipe(
        Effect.provide(layer),
        Effect.catchTag('AiSchemaMismatch', (e) =>
          Effect.succeed({ caught: true, raw: e.raw } as const),
        ),
      ),
    );
    if (!('caught' in result)) throw new Error('expected caught AiSchemaMismatch');
    expect(result.caught).toBe(true);
    expect(result.raw).toContain('"scope":99');
  });
});

// ---------------------------------------------------------------------------
// AiAgent.run — tool execution throws
// ---------------------------------------------------------------------------

describe('AiAgent.run — tool execution failure recovery', () => {
  it('routes a thrown tool error back to the model, allowing recovery', async () => {
    const answerSchema = z.object({ answer: z.string() });

    let callCount = 0;
    const flaky: AgentTool = {
      name: 'flaky',
      description: 'a tool that fails on its first call',
      // Permissive schema so the retry call with different args still
      // passes pi-agent-core's argument validation.
      parameters: {
        type: 'object',
        properties: { retry: { type: 'boolean' } },
        additionalProperties: false,
      },
      execute: vi.fn(async () => {
        callCount += 1;
        if (callCount === 1) {
          throw new Error('first call fails');
        }
        return { ok: true, count: callCount };
      }),
    };

    faux = registerFauxProvider();
    faux.setResponses([
      // Turn 1: model calls the flaky tool — it throws, pi-agent-core
      // surfaces the error as a toolResult to the model.
      fauxAssistantMessage([fauxToolCall('flaky', {})], { stopReason: 'toolUse' }),
      // Turn 2: model retries with a different arg so stalled detection
      // doesn't fire (same name + same args twice would trip it).
      fauxAssistantMessage([fauxToolCall('flaky', { retry: true })], { stopReason: 'toolUse' }),
      // Turn 3: success — model submits.
      fauxAssistantMessage([fauxToolCall('submit_response', { answer: 'recovered' })], {
        stopReason: 'toolUse',
      }),
    ]);

    const layer = buildAiAgentLayer({
      config: fakeConfig(),
      credentials: fakeCredentials(),
      model: faux.getModel(),
    });

    const program = Effect.gen(function* () {
      const agent = yield* AiAgentTag;
      return yield* agent.run({
        systemPrompt: 's',
        userPrompt: 'u',
        schema: answerSchema,
        tools: [flaky],
      });
    });

    const { result } = await Effect.runPromise(program.pipe(Effect.provide(layer)));
    expect(result).toEqual({ answer: 'recovered' });
    expect(callCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// AiAgent.run — timeout
// ---------------------------------------------------------------------------

describe('AiAgent.run — timeout', () => {
  it('fails AiTimeout when the LLM stream exceeds timeoutMs', async () => {
    const answerSchema = z.object({ answer: z.string() });

    faux = registerFauxProvider();
    // Slow factory — respects the abort signal so the test exits promptly
    // when the impl's AbortController fires.
    faux.setResponses([
      async (_ctx, opts) => {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, 5_000);
          opts?.signal?.addEventListener('abort', () => {
            clearTimeout(t);
            reject(new Error('aborted'));
          });
        });
        return fauxAssistantMessage([fauxToolCall('submit_response', { answer: 'too late' })], {
          stopReason: 'toolUse',
        });
      },
    ]);

    const layer = buildAiAgentLayer({
      config: fakeConfig(),
      credentials: fakeCredentials(),
      model: faux.getModel(),
    });

    const program = Effect.gen(function* () {
      const agent = yield* AiAgentTag;
      return yield* agent.run({
        systemPrompt: 's',
        userPrompt: 'u',
        schema: answerSchema,
        tools: [],
        timeoutMs: 80,
      });
    });

    const start = Date.now();
    const result = await Effect.runPromise(
      program.pipe(
        Effect.provide(layer),
        Effect.catchTag('AiTimeout', (e) =>
          Effect.succeed({ caught: true, timeoutMs: e.timeoutMs }),
        ),
      ),
    );
    const elapsed = Date.now() - start;

    expect(result).toEqual({ caught: true, timeoutMs: 80 });
    // We must NOT have awaited the 5s factory to completion.
    expect(elapsed).toBeLessThan(2000);
  });
});

// ---------------------------------------------------------------------------
// AiAgent.run — provider errors
// ---------------------------------------------------------------------------

describe('AiAgent.run — provider error mapping', () => {
  it('maps 401 → AiAuthError', async () => {
    const answerSchema = z.object({ answer: z.string() });

    faux = registerFauxProvider();
    faux.setResponses([fauxErrorWithStatus(401, 'Unauthorized: invalid API key')]);

    const layer = buildAiAgentLayer({
      config: fakeConfig(),
      credentials: fakeCredentials(),
      model: faux.getModel(),
    });

    const program = Effect.gen(function* () {
      const agent = yield* AiAgentTag;
      return yield* agent.run({
        systemPrompt: 's',
        userPrompt: 'u',
        schema: answerSchema,
        tools: [],
      });
    });

    const result = await Effect.runPromise(
      program.pipe(
        Effect.provide(layer),
        Effect.catchTag('AiAuthError', (e) =>
          Effect.succeed({ caught: true, provider: e.provider }),
        ),
      ),
    );
    expect(result).toEqual({ caught: true, provider: 'deepseek' });
  });
});
