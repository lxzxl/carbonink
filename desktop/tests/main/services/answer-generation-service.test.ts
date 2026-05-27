import { runMigrations } from '@main/db/migrate';
import type { AiClient } from '@main/llm/ai-client';
import { AiNoData, AiProviderError, AiSchemaMismatch } from '@main/llm/errors';
import * as answerSvc from '@main/services/answer-generation';
import {
  ActivityDataServiceTag,
  AiClientTag,
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
  apiKeyKeyref: 'fake',
} as never;

function failureTag<A>(exit: Exit.Exit<A, unknown>): string | null {
  if (Exit.isSuccess(exit)) return null;
  const failure = Cause.failureOption(exit.cause);
  if (Option.isNone(failure)) return null;
  const err = failure.value as { _tag?: string };
  return err._tag ?? null;
}

/**
 * Build an `AiClient` stub for tests. `generateObject` is the only method
 * answer-generation calls — `generateText` / `ping` are stubbed to fail
 * loudly if anything touches them. The stub takes a `mock` so individual
 * tests can wire `.mockResolvedValueOnce(...)` / `.mockRejectedValueOnce(...)`
 * style sequences.
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

function setup(opts?: {
  seedQuestionnaire?: { id: string; reporting_year: number; customer_name: string };
  seedQuestion?: { id: string; questionnaire_id: string; raw_text: string };
  seedAnswer?: Partial<Answer> & { id: string; question_id: string; value: string };
  activitiesForYear?: number;
  totalsForYear?: { total_co2e_kg: number } | null;
  llmAnswer?: { value: string; unit: string | null; source_summary: string };
  /**
   * Configure the AiClient stub's `generateObject` to reject (each call) with
   * the provided error. Used to exercise error-propagation paths.
   */
  generateObject?: ReturnType<typeof vi.fn>;
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

  // Honour the caller's pre-wired generateObject mock (for fail/retry tests),
  // otherwise build a default that returns the canned `llmAnswer` shape.
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
    Layer.succeed(OrgServiceTag, orgService as never),
    Layer.succeed(ActivityDataServiceTag, activityDataService as never),
    Layer.succeed(NowTag, () => '2026-05-15T12:00:00Z'),
  );

  return { db, testLayer, ai, generateObjectMock };
}

describe('answer-generation.generate (Effect Step 2)', () => {
  it('happy path: returns answer row + inserts to DB', async () => {
    const { testLayer, db, generateObjectMock } = setup({
      seedQuestionnaire: { id: 'qn-1', reporting_year: 2026, customer_name: 'Acme' },
      seedQuestion: { id: 'q-1', questionnaire_id: 'qn-1', raw_text: '2026 total kWh?' },
      activitiesForYear: 12,
      totalsForYear: { total_co2e_kg: 8456.7 },
      llmAnswer: { value: '14820', unit: 'kWh', source_summary: 'sum of activities' },
    });
    const result = await Effect.runPromise(
      answerSvc.generate('q-1', FAKE_CONFIG).pipe(Effect.provide(testLayer)),
    );
    expect(result.value).toBe('14820');
    expect(result.source_kind).toBe('ai_suggested');
    expect(generateObjectMock).toHaveBeenCalledTimes(1);
    // The service should hand the AiClient a prompt + schema, no system prompt.
    const args = generateObjectMock.mock.calls[0]?.[0] as { prompt: string; schema: unknown };
    expect(args.prompt).toContain('2026 total kWh');
    expect(args.prompt).toContain('inventory');
    expect(args.schema).toBeTruthy();
    const row = db.prepare(`SELECT * FROM answer WHERE question_id = ?`).get('q-1');
    expect(row).toBeTruthy();
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

  it('InventoryEmpty when no activities for the year', async () => {
    const { testLayer } = setup({
      seedQuestionnaire: { id: 'qn-1', reporting_year: 2026, customer_name: 'A' },
      seedQuestion: { id: 'q-1', questionnaire_id: 'qn-1', raw_text: 'Q' },
      activitiesForYear: 0,
    });
    const exit = await Effect.runPromiseExit(
      answerSvc.generate('q-1', FAKE_CONFIG).pipe(Effect.provide(testLayer)),
    );
    expect(failureTag(exit)).toBe('InventoryEmpty');
  });

  it('AiProviderError propagates when AiClient fails (post-retry)', async () => {
    // AiClient's own retry policy is internal — by the time the error bubbles
    // up to answer-generation, retries are exhausted. The service just
    // propagates the tag.
    const generateObject = vi
      .fn()
      .mockReturnValue(Effect.fail(new AiProviderError({ cause: 'network down' })));
    const { testLayer } = setup({
      seedQuestionnaire: { id: 'qn-1', reporting_year: 2026, customer_name: 'A' },
      seedQuestion: { id: 'q-1', questionnaire_id: 'qn-1', raw_text: 'Q' },
      activitiesForYear: 1,
      generateObject,
    });
    const exit = await Effect.runPromiseExit(
      answerSvc.generate('q-1', FAKE_CONFIG).pipe(Effect.provide(testLayer)),
    );
    expect(failureTag(exit)).toBe('AiProviderError');
    // Single call: AiClient already handled retry/backoff before failing.
    expect(generateObject).toHaveBeenCalledTimes(1);
  });

  it('AiSchemaMismatch propagates without retry', async () => {
    const generateObject = vi
      .fn()
      .mockReturnValue(
        Effect.fail(new AiSchemaMismatch({ raw: '{"value":42}', cause: new Error('bad') })),
      );
    const { testLayer } = setup({
      seedQuestionnaire: { id: 'qn-1', reporting_year: 2026, customer_name: 'A' },
      seedQuestion: { id: 'q-1', questionnaire_id: 'qn-1', raw_text: 'Q' },
      activitiesForYear: 1,
      generateObject,
    });
    const exit = await Effect.runPromiseExit(
      answerSvc.generate('q-1', FAKE_CONFIG).pipe(Effect.provide(testLayer)),
    );
    expect(failureTag(exit)).toBe('AiSchemaMismatch');
    expect(generateObject).toHaveBeenCalledTimes(1);
  });

  it('AiNoData propagates when the AiClient sees no tool-call output', async () => {
    const generateObject = vi.fn().mockReturnValue(Effect.fail(new AiNoData({})));
    const { testLayer } = setup({
      seedQuestionnaire: { id: 'qn-1', reporting_year: 2026, customer_name: 'A' },
      seedQuestion: { id: 'q-1', questionnaire_id: 'qn-1', raw_text: 'Q' },
      activitiesForYear: 1,
      generateObject,
    });
    const exit = await Effect.runPromiseExit(
      answerSvc.generate('q-1', FAKE_CONFIG).pipe(Effect.provide(testLayer)),
    );
    // Note: AiNoData (transport-level no content) is distinct from LLMNoData
    // (model returned value=""). Both reach the IPC handler; the UI surfaces
    // them with different copy.
    expect(failureTag(exit)).toBe('AiNoData');
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
    // Override the AiClient stub: succeed once (q-2) then fail once (q-3).
    // Each `generate(...)` invocation pulls a fresh Effect from the mock, so
    // the order matches the unanswered-questions iteration order.
    const generateObject = vi
      .fn()
      .mockReturnValueOnce(Effect.succeed({ value: 'ok', unit: null, source_summary: 's' }))
      .mockReturnValueOnce(Effect.fail(new AiProviderError({ cause: 'persistent' })));
    const { testLayer, db } = setup({
      seedQuestionnaire: { id: 'qn-1', reporting_year: 2026, customer_name: 'A' },
      activitiesForYear: 5,
      generateObject,
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
