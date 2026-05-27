import { runMigrations } from '@main/db/migrate';
import type { AgentTool, AgentTrace, AiAgent } from '@main/llm/ai-agent';
import type { AiClient } from '@main/llm/ai-client';
import {
  AgentMaxTurns,
  AgentStalled,
  AiAuthError,
  AiNoData,
  AiProviderError,
  AiSchemaMismatch,
  AiTimeout,
} from '@main/llm/errors';
import * as answerSvc from '@main/services/answer-generation';
import {
  ActivityDataServiceTag,
  AiAgentTag,
  AiClientTag,
  AnswerToolsTag,
  DbTag,
  NowTag,
  OrgServiceTag,
} from '@main/services/answer-generation/tags';
import type { Answer } from '@shared/types';
import Database from 'better-sqlite3';
import { Cause, Effect, Either, Exit, Layer, Option } from 'effect';
import { describe, expect, it, vi } from 'vitest';

const FAKE_CONFIG = {
  provider: 'openai',
  model: 'gpt-4o-mini',
} as never;

function failureTag<A>(exit: Exit.Exit<A, unknown>): string | null {
  if (Exit.isSuccess(exit)) return null;
  const failure = Cause.failureOption(exit.cause);
  if (Option.isNone(failure)) return null;
  const err = failure.value as { _tag?: string };
  return err._tag ?? null;
}

/**
 * Build an `AiClient` stub for tests. Used by the single-shot fallback
 * path; `generateObject` is the only method that path calls. The other
 * two methods fail loudly if anything touches them.
 */
function makeStubAi(opts?: { generateObject?: ReturnType<typeof vi.fn> }): {
  ai: AiClient;
  generateObjectMock: ReturnType<typeof vi.fn>;
} {
  const generateObjectMock =
    opts?.generateObject ??
    vi
      .fn()
      .mockReturnValue(
        Effect.succeed({ value: '14820', unit: 'kWh', source_summary: 'sum of activities' }),
      );
  const ai: AiClient = {
    generateObject: generateObjectMock as unknown as AiClient['generateObject'],
    generateText: vi
      .fn()
      .mockReturnValue(
        Effect.die(new Error('generateText is not expected to be called by answer-generation')),
      ) as unknown as AiClient['generateText'],
    ping: vi
      .fn()
      .mockReturnValue(
        Effect.die(new Error('ping is not expected to be called by answer-generation')),
      ) as unknown as AiClient['ping'],
  };
  return { ai, generateObjectMock };
}

/**
 * Default agent stub: returns a successful answer in one turn (= happy
 * path through the new orchestrator). Tests that want to exercise the
 * fallback branch override `run` with `Effect.fail(...)`.
 */
function makeStubAgent(opts?: { run?: ReturnType<typeof vi.fn> }): {
  agent: AiAgent;
  runMock: ReturnType<typeof vi.fn>;
} {
  const defaultTrace: AgentTrace = {
    turnCount: 1,
    toolCalls: [{ tool: 'list_activities', argsHash: 'h', durationMs: 5 }],
    totalTokens: { input: 800, output: 120 },
    totalDurationMs: 250,
    stopReason: 'completed',
  };
  const runMock =
    opts?.run ??
    vi.fn().mockReturnValue(
      Effect.succeed({
        result: { value: '14820', unit: 'kWh', source_summary: 'agent cited a1, a2' },
        trace: defaultTrace,
      }),
    );
  const agent: AiAgent = {
    run: runMock as unknown as AiAgent['run'],
  };
  return { agent, runMock };
}

function setup(opts?: {
  seedQuestionnaire?: { id: string; reporting_year: number; customer_name: string };
  seedQuestion?: { id: string; questionnaire_id: string; raw_text: string };
  seedAnswer?: Partial<Answer> & { id: string; question_id: string; value: string };
  activitiesForYear?: number;
  totalsForYear?: { total_co2e_kg: number } | null;
  llmAnswer?: { value: string; unit: string | null; source_summary: string };
  /**
   * Configure the AiClient stub's `generateObject` (single-shot fallback
   * path) to return a custom Effect. Used to exercise fallback-then-fail
   * scenarios.
   */
  generateObject?: ReturnType<typeof vi.fn>;
  /**
   * Configure the AiAgent stub's `run`. Defaults to a one-turn success
   * returning the canned (or `llmAnswer`-shaped) answer. Override with
   * `Effect.fail(new AgentMaxTurns(...))` etc. to drive the fallback path.
   */
  agentRun?: ReturnType<typeof vi.fn>;
  tools?: AgentTool[];
}) {
  const db = new Database(':memory:');
  runMigrations(db);

  if (opts?.seedQuestionnaire) {
    db.prepare(`INSERT INTO customer (id, name, notes) VALUES ('cu-1', ?, NULL)`).run(
      opts.seedQuestionnaire.customer_name,
    );
    db.prepare(
      `INSERT INTO document (id, sha256, filename, mime_type, size_bytes, storage_path, uploaded_at) VALUES ('doc-1', 'aa', 'q.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 100, '/tmp/q.xlsx', '2026-05-15T00:00:00Z')`,
    ).run();
    db.prepare(
      `INSERT INTO questionnaire (id, customer_id, document_id, reporting_year, status, due_date, created_at) VALUES (?, 'cu-1', 'doc-1', ?, 'mapping', NULL, '2026-05-15T00:00:00Z')`,
    ).run(opts.seedQuestionnaire.id, opts.seedQuestionnaire.reporting_year);
  }
  if (opts?.seedQuestion) {
    db.prepare(
      `INSERT INTO question (id, questionnaire_id, question_signature, signature_version, normalized_text, raw_text, parsed_intent, question_kind, expected_unit, position, required) VALUES (?, ?, 'sig', 'v1', 'q', ?, NULL, 'numerical', 'kWh', 'Sheet1!B5', 0)`,
    ).run(opts.seedQuestion.id, opts.seedQuestion.questionnaire_id, opts.seedQuestion.raw_text);
  }
  if (opts?.seedAnswer) {
    const a = opts.seedAnswer;
    db.prepare(
      `INSERT INTO answer (id, question_id, value, unit, source_kind, source_summary, finalized_at) VALUES (?, ?, ?, NULL, 'ai_suggested', NULL, NULL)`,
    ).run(a.id, a.question_id, a.value);
  }

  const orgService = {
    getCurrentOrganization: vi.fn().mockReturnValue({
      id: 'org-1',
      name_zh: 'Test',
      name_en: null,
      industry: null,
      country_code: 'CN',
      boundary_kind: 'operational_control',
      created_at: '2026-05-15T00:00:00Z',
      updated_at: '2026-05-15T00:00:00Z',
    }),
    listReportingPeriodsByOrganization: vi.fn().mockReturnValue(
      opts?.seedQuestionnaire
        ? [
            {
              id: 'rp-1',
              organization_id: 'org-1',
              year: opts.seedQuestionnaire.reporting_year,
              granularity: 'annual',
              starts_at: '',
              ends_at: '',
              is_active: 1,
              created_at: '',
              updated_at: '',
            },
          ]
        : [],
    ),
  };
  const activityDataService = {
    listByPeriod: vi.fn().mockReturnValue(new Array(opts?.activitiesForYear ?? 0).fill({})),
    totalsByPeriod: vi.fn().mockReturnValue(opts?.totalsForYear ?? null),
  };

  // Default agent: succeed with the canned llmAnswer (or a fixed default).
  const agentRun =
    opts?.agentRun ??
    vi.fn().mockReturnValue(
      Effect.succeed({
        result: opts?.llmAnswer ?? {
          value: '14820',
          unit: 'kWh',
          source_summary: 'agent cited a1, a2',
        },
        trace: {
          turnCount: 1,
          toolCalls: [{ tool: 'list_activities', argsHash: 'h', durationMs: 5 }],
          totalTokens: { input: 800, output: 120 },
          totalDurationMs: 250,
          stopReason: 'completed',
        } satisfies AgentTrace,
      }),
    );
  const { agent, runMock: agentRunMock } = makeStubAgent({ run: agentRun });

  // Honour the caller's pre-wired generateObject mock (for fallback path
  // tests), otherwise build a default that returns the canned `llmAnswer`.
  const generateObject =
    opts?.generateObject ??
    vi
      .fn()
      .mockReturnValue(
        Effect.succeed(
          opts?.llmAnswer ?? { value: '14820', unit: 'kWh', source_summary: 'sum of activities' },
        ),
      );
  const { ai, generateObjectMock } = makeStubAi({ generateObject });

  const testLayer = Layer.mergeAll(
    Layer.succeed(DbTag, db),
    Layer.succeed(AiClientTag, ai),
    Layer.succeed(AiAgentTag, agent),
    Layer.succeed(AnswerToolsTag, opts?.tools ?? []),
    Layer.succeed(OrgServiceTag, orgService as never),
    Layer.succeed(ActivityDataServiceTag, activityDataService as never),
    Layer.succeed(NowTag, () => '2026-05-15T12:00:00Z'),
  );

  return { db, testLayer, ai, agent, generateObjectMock, agentRunMock };
}

describe('answer-generation.generate (Effect Step 2)', () => {
  it('agent path: returns answer row + inserts to DB, no fallback prefix', async () => {
    const { testLayer, db, generateObjectMock, agentRunMock } = setup({
      seedQuestionnaire: { id: 'qn-1', reporting_year: 2026, customer_name: 'Acme' },
      seedQuestion: { id: 'q-1', questionnaire_id: 'qn-1', raw_text: '2026 total kWh?' },
      activitiesForYear: 12,
      totalsForYear: { total_co2e_kg: 8456.7 },
      llmAnswer: { value: '14820', unit: 'kWh', source_summary: 'agent cited a1, a2' },
    });
    const result = await Effect.runPromise(
      answerSvc.generate('q-1', FAKE_CONFIG).pipe(Effect.provide(testLayer)),
    );
    expect(result.value).toBe('14820');
    expect(result.source_kind).toBe('ai_suggested');
    // Agent was driven exactly once; fallback was NOT touched.
    expect(agentRunMock).toHaveBeenCalledTimes(1);
    expect(generateObjectMock).not.toHaveBeenCalled();
    // source_summary should not carry the fallback prefix on the happy path.
    const row = db.prepare(`SELECT source_summary FROM answer WHERE question_id = ?`).get('q-1') as
      | { source_summary: string }
      | undefined;
    expect(row).toBeTruthy();
    expect(row?.source_summary).not.toContain('单 shot fallback');
    // Audit row recorded with isFallback=false + the agent's trace counts.
    const audit = db
      .prepare(`SELECT payload FROM audit_event WHERE event_kind = 'agent_answer.generate'`)
      .get() as { payload: string };
    const payload = JSON.parse(audit.payload);
    expect(payload.isFallback).toBe(false);
    expect(payload.turnCount).toBe(1);
    expect(payload.toolCallSummary).toEqual(['list_activities']);
    expect(payload.stopReason).toBe('completed');
  });

  it('fallback on AgentMaxTurns: single-shot answers + fallback prefix on source_summary', async () => {
    const agentRun = vi
      .fn()
      .mockReturnValue(
        Effect.fail(new AgentMaxTurns({ turnCount: 6, lastTool: 'list_activities' })),
      );
    const { testLayer, db, generateObjectMock, agentRunMock } = setup({
      seedQuestionnaire: { id: 'qn-1', reporting_year: 2026, customer_name: 'Acme' },
      seedQuestion: { id: 'q-1', questionnaire_id: 'qn-1', raw_text: 'Q' },
      activitiesForYear: 5,
      agentRun,
      llmAnswer: { value: '999', unit: 'kWh', source_summary: 'fallback sum from inventory' },
    });
    const result = await Effect.runPromise(
      answerSvc.generate('q-1', FAKE_CONFIG).pipe(Effect.provide(testLayer)),
    );
    expect(result.value).toBe('999');
    expect(agentRunMock).toHaveBeenCalledTimes(1);
    expect(generateObjectMock).toHaveBeenCalledTimes(1);
    const row = db.prepare(`SELECT source_summary FROM answer WHERE question_id = ?`).get('q-1') as
      | { source_summary: string }
      | undefined;
    // source_summary is JSON-encoded; the inner string carries the prefix.
    expect(row?.source_summary).toContain('单 shot fallback');
    expect(row?.source_summary).toContain('fallback sum from inventory');
    // Audit row marks fallback=true + carries the max_turns stopReason.
    const audit = db
      .prepare(`SELECT payload FROM audit_event WHERE event_kind = 'agent_answer.generate'`)
      .get() as { payload: string };
    const payload = JSON.parse(audit.payload);
    expect(payload.isFallback).toBe(true);
    expect(payload.stopReason).toBe('max_turns');
    expect(payload.turnCount).toBe(6);
  });

  it('fallback on AgentStalled: single-shot answers + stalled stopReason on audit', async () => {
    const agentRun = vi
      .fn()
      .mockReturnValue(Effect.fail(new AgentStalled({ tool: 'sum_co2e', turnCount: 3 })));
    const { testLayer, db, generateObjectMock } = setup({
      seedQuestionnaire: { id: 'qn-1', reporting_year: 2026, customer_name: 'Acme' },
      seedQuestion: { id: 'q-1', questionnaire_id: 'qn-1', raw_text: 'Q' },
      activitiesForYear: 5,
      agentRun,
      llmAnswer: { value: '12', unit: 'kWh', source_summary: 's' },
    });
    const result = await Effect.runPromise(
      answerSvc.generate('q-1', FAKE_CONFIG).pipe(Effect.provide(testLayer)),
    );
    expect(result.value).toBe('12');
    expect(generateObjectMock).toHaveBeenCalledTimes(1);
    const audit = db
      .prepare(`SELECT payload FROM audit_event WHERE event_kind = 'agent_answer.generate'`)
      .get() as { payload: string };
    const payload = JSON.parse(audit.payload);
    expect(payload.isFallback).toBe(true);
    expect(payload.stopReason).toBe('stalled');
  });

  it('fallback on AiTimeout: single-shot answers + aborted stopReason on audit', async () => {
    const agentRun = vi.fn().mockReturnValue(Effect.fail(new AiTimeout({ timeoutMs: 90_000 })));
    const { testLayer, db, generateObjectMock } = setup({
      seedQuestionnaire: { id: 'qn-1', reporting_year: 2026, customer_name: 'Acme' },
      seedQuestion: { id: 'q-1', questionnaire_id: 'qn-1', raw_text: 'Q' },
      activitiesForYear: 5,
      agentRun,
      llmAnswer: { value: '7', unit: 'kWh', source_summary: 's' },
    });
    const result = await Effect.runPromise(
      answerSvc.generate('q-1', FAKE_CONFIG).pipe(Effect.provide(testLayer)),
    );
    expect(result.value).toBe('7');
    expect(generateObjectMock).toHaveBeenCalledTimes(1);
    const audit = db
      .prepare(`SELECT payload FROM audit_event WHERE event_kind = 'agent_answer.generate'`)
      .get() as { payload: string };
    const payload = JSON.parse(audit.payload);
    expect(payload.isFallback).toBe(true);
    expect(payload.stopReason).toBe('aborted');
  });

  it('AiAuthError from agent path propagates — does NOT trigger fallback', async () => {
    const agentRun = vi.fn().mockReturnValue(Effect.fail(new AiAuthError({ provider: 'openai' })));
    const { testLayer, generateObjectMock } = setup({
      seedQuestionnaire: { id: 'qn-1', reporting_year: 2026, customer_name: 'Acme' },
      seedQuestion: { id: 'q-1', questionnaire_id: 'qn-1', raw_text: 'Q' },
      activitiesForYear: 5,
      agentRun,
    });
    const exit = await Effect.runPromiseExit(
      answerSvc.generate('q-1', FAKE_CONFIG).pipe(Effect.provide(testLayer)),
    );
    expect(failureTag(exit)).toBe('AiAuthError');
    // Critical: the fallback path must NOT swallow the auth error — the
    // user needs to fix the key, not silently get a degraded answer.
    expect(generateObjectMock).not.toHaveBeenCalled();
  });

  it('LLMNoData when LLM returns an empty value (no inventory data)', async () => {
    const { testLayer, db } = setup({
      seedQuestionnaire: { id: 'qn-1', reporting_year: 2026, customer_name: 'Acme' },
      seedQuestion: { id: 'q-1', questionnaire_id: 'qn-1', raw_text: '2026 total kWh?' },
      activitiesForYear: 12,
      totalsForYear: { total_co2e_kg: 8456.7 },
      llmAnswer: { value: '', unit: null, source_summary: 'inventory missing' },
    });
    const exit = await Effect.runPromiseExit(
      answerSvc.generate('q-1', FAKE_CONFIG).pipe(Effect.provide(testLayer)),
    );
    expect(failureTag(exit)).toBe('LLMNoData');
    // Critically: nothing inserted to the DB. The bug we're guarding against
    // is persisting a fake answer that downstream reads can't distinguish.
    const row = db.prepare(`SELECT * FROM answer WHERE question_id = ?`).get('q-1');
    expect(row).toBeUndefined();
  });

  it('narrative kind: unit stored as null even if LLM returned one', async () => {
    const { testLayer, db } = setup({
      seedQuestionnaire: { id: 'qn-1', reporting_year: 2026, customer_name: 'A' },
      seedQuestion: {
        id: 'q-n1',
        questionnaire_id: 'qn-1',
        raw_text: '请描述贵公司气候转型计划',
      },
      activitiesForYear: 5,
      totalsForYear: { total_co2e_kg: 1000 },
      llmAnswer: {
        value: '我司已制定 2030 净零路径',
        unit: '句',
        source_summary: '基于 inventory',
      },
    });

    // Override the seeded question's kind to 'narrative'. The setup helper
    // currently seeds kind='numerical' by default; bypass via direct UPDATE.
    db.prepare("UPDATE question SET question_kind = 'narrative' WHERE id = 'q-n1'").run();

    const result = await Effect.runPromise(
      answerSvc.generate('q-n1', FAKE_CONFIG).pipe(Effect.provide(testLayer)),
    );
    expect(result.value).toBe('我司已制定 2030 净零路径');
    expect(result.unit).toBeNull();
  });

  it('QuestionNotFound when id does not exist', async () => {
    const { testLayer } = setup({});
    const exit = await Effect.runPromiseExit(
      answerSvc.generate('not-real', FAKE_CONFIG).pipe(Effect.provide(testLayer)),
    );
    expect(failureTag(exit)).toBe('QuestionNotFound');
  });

  it('QuestionAlreadyAnswered when answer row already exists', async () => {
    const { testLayer } = setup({
      seedQuestionnaire: { id: 'qn-1', reporting_year: 2026, customer_name: 'A' },
      seedQuestion: { id: 'q-1', questionnaire_id: 'qn-1', raw_text: 'Q' },
      seedAnswer: { id: 'a-1', question_id: 'q-1', value: 'existing' },
      activitiesForYear: 1,
    });
    const exit = await Effect.runPromiseExit(
      answerSvc.generate('q-1', FAKE_CONFIG).pipe(Effect.provide(testLayer)),
    );
    expect(failureTag(exit)).toBe('QuestionAlreadyAnswered');
  });

  it('InventoryEmpty when no activities for the year (no agent + no fallback)', async () => {
    const { testLayer, agentRunMock, generateObjectMock } = setup({
      seedQuestionnaire: { id: 'qn-1', reporting_year: 2026, customer_name: 'A' },
      seedQuestion: { id: 'q-1', questionnaire_id: 'qn-1', raw_text: 'Q' },
      activitiesForYear: 0,
    });
    const exit = await Effect.runPromiseExit(
      answerSvc.generate('q-1', FAKE_CONFIG).pipe(Effect.provide(testLayer)),
    );
    expect(failureTag(exit)).toBe('InventoryEmpty');
    // Both paths short-circuited identically — neither LLM service touched.
    expect(agentRunMock).not.toHaveBeenCalled();
    expect(generateObjectMock).not.toHaveBeenCalled();
  });

  it('AiProviderError from agent propagates (post-retry, not caught by fallback)', async () => {
    // AiProviderError is NOT in the fallback catchTags list — it bubbles up
    // unchanged so the IPC handler can show "check network + API key".
    const agentRun = vi
      .fn()
      .mockReturnValue(Effect.fail(new AiProviderError({ cause: 'network down' })));
    const { testLayer, generateObjectMock } = setup({
      seedQuestionnaire: { id: 'qn-1', reporting_year: 2026, customer_name: 'A' },
      seedQuestion: { id: 'q-1', questionnaire_id: 'qn-1', raw_text: 'Q' },
      activitiesForYear: 1,
      agentRun,
    });
    const exit = await Effect.runPromiseExit(
      answerSvc.generate('q-1', FAKE_CONFIG).pipe(Effect.provide(testLayer)),
    );
    expect(failureTag(exit)).toBe('AiProviderError');
    expect(generateObjectMock).not.toHaveBeenCalled();
  });

  it('AiSchemaMismatch from agent propagates without retry', async () => {
    const agentRun = vi
      .fn()
      .mockReturnValue(
        Effect.fail(new AiSchemaMismatch({ raw: '{"value":42}', cause: new Error('bad') })),
      );
    const { testLayer, generateObjectMock } = setup({
      seedQuestionnaire: { id: 'qn-1', reporting_year: 2026, customer_name: 'A' },
      seedQuestion: { id: 'q-1', questionnaire_id: 'qn-1', raw_text: 'Q' },
      activitiesForYear: 1,
      agentRun,
    });
    const exit = await Effect.runPromiseExit(
      answerSvc.generate('q-1', FAKE_CONFIG).pipe(Effect.provide(testLayer)),
    );
    expect(failureTag(exit)).toBe('AiSchemaMismatch');
    expect(generateObjectMock).not.toHaveBeenCalled();
  });

  it('AiNoData from agent propagates (no fallback)', async () => {
    const agentRun = vi.fn().mockReturnValue(Effect.fail(new AiNoData({})));
    const { testLayer, generateObjectMock } = setup({
      seedQuestionnaire: { id: 'qn-1', reporting_year: 2026, customer_name: 'A' },
      seedQuestion: { id: 'q-1', questionnaire_id: 'qn-1', raw_text: 'Q' },
      activitiesForYear: 1,
      agentRun,
    });
    const exit = await Effect.runPromiseExit(
      answerSvc.generate('q-1', FAKE_CONFIG).pipe(Effect.provide(testLayer)),
    );
    // Note: AiNoData (transport-level no content) is distinct from LLMNoData
    // (model returned value=""). Both reach the IPC handler; the UI surfaces
    // them with different copy.
    expect(failureTag(exit)).toBe('AiNoData');
    expect(generateObjectMock).not.toHaveBeenCalled();
  });
});

describe('answer-generation.save', () => {
  it('updates value/unit + flips source_kind to manual on user edit', async () => {
    const { testLayer, db } = setup({
      seedQuestionnaire: { id: 'qn-1', reporting_year: 2026, customer_name: 'A' },
      seedQuestion: { id: 'q-1', questionnaire_id: 'qn-1', raw_text: 'Q' },
      seedAnswer: { id: 'a-1', question_id: 'q-1', value: '14820' },
    });
    const result = await Effect.runPromise(
      answerSvc
        .save({ question_id: 'q-1', value: '15000', unit: 'kWh', finalize: false })
        .pipe(Effect.provide(testLayer)),
    );
    expect(result.value).toBe('15000');
    expect(result.source_kind).toBe('manual');
    const row = db.prepare(`SELECT * FROM answer WHERE question_id = ?`).get('q-1') as {
      value: string;
      source_kind: string;
      finalized_at: string | null;
    };
    expect(row.value).toBe('15000');
    expect(row.finalized_at).toBeNull();
  });

  it('sets finalized_at when finalize=true', async () => {
    const { testLayer, db } = setup({
      seedQuestionnaire: { id: 'qn-1', reporting_year: 2026, customer_name: 'A' },
      seedQuestion: { id: 'q-1', questionnaire_id: 'qn-1', raw_text: 'Q' },
      seedAnswer: { id: 'a-1', question_id: 'q-1', value: '14820' },
    });
    await Effect.runPromise(
      answerSvc
        .save({ question_id: 'q-1', value: '15000', unit: 'kWh', finalize: true })
        .pipe(Effect.provide(testLayer)),
    );
    const row = db.prepare(`SELECT finalized_at FROM answer WHERE question_id = ?`).get('q-1') as {
      finalized_at: string;
    };
    expect(row.finalized_at).toBe('2026-05-15T12:00:00Z');
  });

  it('AnswerNotFound for unknown question_id', async () => {
    const { testLayer } = setup({});
    const exit = await Effect.runPromiseExit(
      answerSvc
        .save({ question_id: 'not-real', value: 'v', unit: null, finalize: false })
        .pipe(Effect.provide(testLayer)),
    );
    expect(failureTag(exit)).toBe('AnswerNotFound');
  });
});

describe('answer-generation.listByQuestionnaire', () => {
  it('returns answers for the questionnaire ordered by question position', async () => {
    const { testLayer, db } = setup({
      seedQuestionnaire: { id: 'qn-1', reporting_year: 2026, customer_name: 'A' },
    });
    db.prepare(
      `INSERT INTO question (id, questionnaire_id, question_signature, signature_version, normalized_text, raw_text, parsed_intent, question_kind, expected_unit, position, required) VALUES ('q-1', 'qn-1', 's1', 'v1', 'q1', 'q1', NULL, 'numerical', NULL, 'Sheet1!B2', 0)`,
    ).run();
    db.prepare(
      `INSERT INTO question (id, questionnaire_id, question_signature, signature_version, normalized_text, raw_text, parsed_intent, question_kind, expected_unit, position, required) VALUES ('q-2', 'qn-1', 's2', 'v1', 'q2', 'q2', NULL, 'numerical', NULL, 'Sheet1!B5', 0)`,
    ).run();
    db.prepare(
      `INSERT INTO answer (id, question_id, value, unit, source_kind, source_summary, finalized_at) VALUES ('a-1', 'q-1', 'v1', NULL, 'ai_suggested', NULL, NULL)`,
    ).run();
    db.prepare(
      `INSERT INTO answer (id, question_id, value, unit, source_kind, source_summary, finalized_at) VALUES ('a-2', 'q-2', 'v2', NULL, 'ai_suggested', NULL, NULL)`,
    ).run();
    const result = await Effect.runPromise(
      answerSvc.listByQuestionnaire('qn-1').pipe(Effect.provide(testLayer)),
    );
    expect(result.length).toBe(2);
    expect(result[0]?.question_id).toBe('q-1');
    expect(result[1]?.question_id).toBe('q-2');
  });
});

describe('answer-generation.generateAllUnanswered', () => {
  it('generates for unanswered questions only; returns Right per success', async () => {
    const { testLayer, db } = setup({
      seedQuestionnaire: { id: 'qn-1', reporting_year: 2026, customer_name: 'A' },
      activitiesForYear: 5,
    });
    // 3 questions; 1 already answered.
    db.prepare(
      `INSERT INTO question (id, questionnaire_id, question_signature, signature_version, normalized_text, raw_text, parsed_intent, question_kind, expected_unit, position, required) VALUES ('q-1', 'qn-1', 's1', 'v1', 'q1', 'q1', NULL, 'numerical', NULL, 'Sheet1!B2', 0)`,
    ).run();
    db.prepare(
      `INSERT INTO question (id, questionnaire_id, question_signature, signature_version, normalized_text, raw_text, parsed_intent, question_kind, expected_unit, position, required) VALUES ('q-2', 'qn-1', 's2', 'v1', 'q2', 'q2', NULL, 'numerical', NULL, 'Sheet1!B3', 0)`,
    ).run();
    db.prepare(
      `INSERT INTO question (id, questionnaire_id, question_signature, signature_version, normalized_text, raw_text, parsed_intent, question_kind, expected_unit, position, required) VALUES ('q-3', 'qn-1', 's3', 'v1', 'q3', 'q3', NULL, 'numerical', NULL, 'Sheet1!B4', 0)`,
    ).run();
    db.prepare(
      `INSERT INTO answer (id, question_id, value, unit, source_kind, source_summary, finalized_at) VALUES ('a-1', 'q-1', 'existing', NULL, 'ai_suggested', NULL, NULL)`,
    ).run();
    const results = await Effect.runPromise(
      answerSvc.generateAllUnanswered('qn-1', FAKE_CONFIG).pipe(Effect.provide(testLayer)),
    );
    expect(results.length).toBe(2); // q-2 and q-3
    expect(results.every((r) => Either.isRight(r))).toBe(true);
  });

  it('isolates per-item failures: returns Left for failing items, Right for others', async () => {
    // Drive the agent stub: succeed once (q-2) then fail with a non-fallback
    // error (q-3). AiProviderError is NOT caught by the fallback shim — it
    // bubbles up so the IPC layer can surface "check API key".
    const agentRun = vi
      .fn()
      .mockReturnValueOnce(
        Effect.succeed({
          result: { value: 'ok', unit: null, source_summary: 's' },
          trace: {
            turnCount: 1,
            toolCalls: [],
            totalTokens: { input: 0, output: 0 },
            totalDurationMs: 1,
            stopReason: 'completed',
          } satisfies AgentTrace,
        }),
      )
      .mockReturnValueOnce(Effect.fail(new AiProviderError({ cause: 'persistent' })));
    const { testLayer, db } = setup({
      seedQuestionnaire: { id: 'qn-1', reporting_year: 2026, customer_name: 'A' },
      activitiesForYear: 5,
      agentRun,
    });
    db.prepare(
      `INSERT INTO question (id, questionnaire_id, question_signature, signature_version, normalized_text, raw_text, parsed_intent, question_kind, expected_unit, position, required) VALUES ('q-1', 'qn-1', 's1', 'v1', 'q1', 'q1', NULL, 'numerical', NULL, 'Sheet1!B2', 0)`,
    ).run();
    db.prepare(
      `INSERT INTO question (id, questionnaire_id, question_signature, signature_version, normalized_text, raw_text, parsed_intent, question_kind, expected_unit, position, required) VALUES ('q-2', 'qn-1', 's2', 'v1', 'q2', 'q2', NULL, 'numerical', NULL, 'Sheet1!B3', 0)`,
    ).run();
    const results = await Effect.runPromise(
      answerSvc.generateAllUnanswered('qn-1', FAKE_CONFIG).pipe(Effect.provide(testLayer)),
    );
    expect(results.length).toBe(2);
    const oks = results.filter(Either.isRight);
    const fails = results.filter(Either.isLeft);
    expect(oks.length).toBe(1);
    expect(fails.length).toBe(1);
    expect((fails[0]?.left as { _tag: string })._tag).toBe('AiProviderError');
  });
});
