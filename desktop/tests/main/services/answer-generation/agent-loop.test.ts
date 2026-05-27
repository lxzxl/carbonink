/**
 * Tests for the answer-generation agent-loop orchestrator. Mocks
 * `AiAgentTag` directly via `Layer.succeed` — the heavier pi-agent-core
 * faux-provider plumbing lives in `ai-agent.test.ts`.
 *
 * What we verify here:
 * - Happy path: agent.run() result + trace are forwarded as `{answer, trace}`.
 * - Failure paths (`AgentMaxTurns`, `AgentStalled`, `AiSchemaMismatch`) propagate.
 * - The orchestrator wires the right config onto `agent.run`: schema kind,
 *   trimmed user prompt, system prompt, tools, maxTurns=6, timeoutMs=90_000.
 */
import { type AgentTool, type AgentTrace, type AiAgent, AiAgentTag } from '@main/llm/ai-agent';
import { AgentMaxTurns, AgentStalled, AiSchemaMismatch } from '@main/llm/errors';
import { runAgent } from '@main/services/answer-generation/agent-loop';
import type { InventoryContext, QuestionContext } from '@main/services/answer-generation/prompt';
import { Effect, Layer } from 'effect';
import { describe, expect, it, vi } from 'vitest';

const NUMERICAL_QUESTION: QuestionContext = {
  raw_text: '请问 2025 年总排放是多少？',
  expected_unit: 'kg co2e',
  question_kind: 'numerical',
};

const NARRATIVE_QUESTION: QuestionContext = {
  raw_text: '请描述贵公司的减排策略。',
  question_kind: 'narrative',
};

const CATEGORICAL_QUESTION: QuestionContext = {
  raw_text: '是否已设定减排目标？',
  question_kind: 'categorical',
};

const INVENTORY: InventoryContext = {
  year: 2025,
  activity_count: 3,
  activities_summary: '3 条活动数据',
  totals: { total_co2e_kg: 12000 },
};

const COMPLETED_TRACE: AgentTrace = {
  turnCount: 2,
  toolCalls: [{ tool: 'list_activities', argsHash: 'h1', durationMs: 10 }],
  totalTokens: { input: 100, output: 50 },
  totalDurationMs: 1234,
  stopReason: 'completed',
};

/**
 * Build a `Layer<AiAgentTag>` that returns a controlled `run()` so each
 * test can drive happy or failure paths without instantiating
 * pi-agent-core. `AiAgent.run` is generic on the schema result type, so
 * we type the impl with `unknown` and let each test return its own
 * shape — the orchestrator under test forwards whatever the agent gave
 * back without inspecting it.
 */
function makeAgentLayer(
  impl: (args: Parameters<AiAgent['run']>[0]) => Effect.Effect<unknown, unknown, never>,
): {
  layer: Layer.Layer<AiAgentTag>;
  runMock: ReturnType<typeof vi.fn>;
} {
  const runMock = vi.fn(impl);
  const agent: AiAgent = { run: runMock as unknown as AiAgent['run'] };
  return { layer: Layer.succeed(AiAgentTag, agent), runMock };
}

describe('runAgent', () => {
  it('returns the parsed answer + trace on agent success', async () => {
    const { layer } = makeAgentLayer(() =>
      Effect.succeed({
        result: { value: '12000', unit: 'kg co2e', source_summary: 'cited a1 + a2' },
        trace: COMPLETED_TRACE,
      }),
    );

    const out = await Effect.runPromise(
      runAgent(NUMERICAL_QUESTION, INVENTORY, []).pipe(Effect.provide(layer)),
    );

    expect(out.answer.value).toBe('12000');
    expect(out.answer.unit).toBe('kg co2e');
    expect(out.answer.source_summary).toBe('cited a1 + a2');
    expect(out.trace).toEqual(COMPLETED_TRACE);
    expect(out.trace.turnCount).toBe(2);
  });

  it('propagates AgentMaxTurns from underlying agent', async () => {
    const { layer } = makeAgentLayer(() =>
      Effect.fail(new AgentMaxTurns({ turnCount: 6, lastTool: 'list_activities' })),
    );

    const result = await Effect.runPromise(
      runAgent(NARRATIVE_QUESTION, INVENTORY, []).pipe(
        Effect.provide(layer),
        Effect.catchTag('AgentMaxTurns', (err) =>
          Effect.succeed({ caught: 'max_turns' as const, turnCount: err.turnCount }),
        ),
      ),
    );

    expect(result).toEqual({ caught: 'max_turns', turnCount: 6 });
  });

  it('propagates AgentStalled from underlying agent', async () => {
    const { layer } = makeAgentLayer(() =>
      Effect.fail(new AgentStalled({ tool: 'list_activities', turnCount: 3 })),
    );

    const result = await Effect.runPromise(
      runAgent(CATEGORICAL_QUESTION, INVENTORY, []).pipe(
        Effect.provide(layer),
        Effect.catchTag('AgentStalled', (err) =>
          Effect.succeed({ caught: 'stalled' as const, tool: err.tool }),
        ),
      ),
    );

    expect(result).toEqual({ caught: 'stalled', tool: 'list_activities' });
  });

  it('propagates AiSchemaMismatch (AiErr union member) unchanged', async () => {
    const { layer } = makeAgentLayer(() =>
      Effect.fail(new AiSchemaMismatch({ raw: '{}', cause: 'value missing' })),
    );

    const result = await Effect.runPromise(
      runAgent(NUMERICAL_QUESTION, INVENTORY, []).pipe(
        Effect.provide(layer),
        Effect.catchTag('AiSchemaMismatch', () => Effect.succeed({ caught: 'schema' as const })),
      ),
    );

    expect(result).toEqual({ caught: 'schema' });
  });

  it('passes maxTurns=6, timeoutMs=90_000, the system prompt, and tools through to agent.run', async () => {
    const { layer, runMock } = makeAgentLayer(() =>
      Effect.succeed({
        result: { value: '', unit: null, source_summary: '' },
        trace: { ...COMPLETED_TRACE, stopReason: 'completed' as const },
      }),
    );

    const fakeTool: AgentTool = {
      name: 'list_activities',
      description: 'stub',
      parameters: {},
      execute: async () => ({}),
    };

    await Effect.runPromise(
      runAgent(NUMERICAL_QUESTION, INVENTORY, [fakeTool]).pipe(Effect.provide(layer)),
    );

    expect(runMock).toHaveBeenCalledTimes(1);
    const firstCall = runMock.mock.calls[0];
    if (!firstCall) throw new Error('runMock was not called');
    const args = firstCall[0] as {
      systemPrompt: string;
      userPrompt: string;
      schema: unknown;
      tools: AgentTool[];
      maxTurns?: number;
      timeoutMs?: number;
    };
    expect(args.maxTurns).toBe(6);
    expect(args.timeoutMs).toBe(90_000);
    expect(args.systemPrompt).toContain('carbon-accounting analyst');
    expect(args.systemPrompt).toContain('submit_response');
    expect(args.tools).toHaveLength(1);
    expect(args.tools[0]?.name).toBe('list_activities');
  });

  it('uses the trimmed agent user prompt (no activity dump)', async () => {
    const { layer, runMock } = makeAgentLayer(() =>
      Effect.succeed({
        result: { value: '0', unit: 'kg', source_summary: '' },
        trace: COMPLETED_TRACE,
      }),
    );

    await Effect.runPromise(
      runAgent(NUMERICAL_QUESTION, INVENTORY, []).pipe(Effect.provide(layer)),
    );

    const firstCall = runMock.mock.calls[0];
    if (!firstCall) throw new Error('runMock was not called');
    const args = firstCall[0] as { userPrompt: string };
    // The legacy single-shot prompt opens with "你是一名碳核算助理" — the
    // agent variant must NOT include that (the system prompt owns persona).
    expect(args.userPrompt).not.toContain('你是一名碳核算助理');
    // Activity dump from the single-shot path is removed; the agent fetches
    // via tools instead.
    expect(args.userPrompt).not.toContain('活动数据摘要');
    // But the inventory headline (year + count) is preserved so the agent
    // knows whether the inventory is empty before calling a tool.
    expect(args.userPrompt).toContain('inventory_headline');
    expect(args.userPrompt).toContain('年度：2025');
    expect(args.userPrompt).toContain('使用工具');
    expect(args.userPrompt).toContain('submit_response');
  });

  it('builds the schema from question_kind (narrative gets 2000 valueMax, others 50)', async () => {
    const { layer, runMock } = makeAgentLayer(() =>
      Effect.succeed({
        result: { value: '', unit: null, source_summary: '' },
        trace: COMPLETED_TRACE,
      }),
    );

    await Effect.runPromise(
      runAgent(NARRATIVE_QUESTION, INVENTORY, []).pipe(Effect.provide(layer)),
    );

    const firstCall = runMock.mock.calls[0];
    if (!firstCall) throw new Error('runMock was not called');
    const args = firstCall[0] as {
      schema: { safeParse: (x: unknown) => { success: boolean } };
    };
    // narrative kind → valueMax = 2000; a 100-char value validates.
    const ok = args.schema.safeParse({
      value: 'a'.repeat(100),
      unit: null,
      source_summary: 'ok',
    });
    expect(ok.success).toBe(true);
    // ≤2000 boundary holds.
    const tooBig = args.schema.safeParse({
      value: 'a'.repeat(2001),
      unit: null,
      source_summary: 'ok',
    });
    expect(tooBig.success).toBe(false);
  });
});
