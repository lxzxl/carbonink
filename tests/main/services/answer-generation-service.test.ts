import { runMigrations } from '@main/db/migrate';
import * as answerSvc from '@main/services/answer-generation';
import {
  ActivityDataServiceTag,
  DbTag,
  LLMClientTag,
  NowTag,
  OrgServiceTag,
} from '@main/services/answer-generation/tags';
import type { Answer } from '@shared/types';
import Database from 'better-sqlite3';
import { Cause, Effect, Exit, Layer, Option } from 'effect';
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

function setup(opts?: {
  seedQuestionnaire?: { id: string; reporting_year: number; customer_name: string };
  seedQuestion?: { id: string; questionnaire_id: string; raw_text: string };
  seedAnswer?: Partial<Answer> & { id: string; question_id: string; value: string };
  activitiesForYear?: number;
  totalsForYear?: { total_co2e_kg: number } | null;
  llmAnswer?: { value: string; unit: string | null; source_summary: string };
  llmThrows?: Error;
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
  const llmClient = {
    generateAnswer: opts?.llmThrows
      ? vi.fn().mockRejectedValue(opts.llmThrows)
      : vi
          .fn()
          .mockResolvedValue(
            opts?.llmAnswer ?? { value: '14820', unit: 'kWh', source_summary: 'sum of activities' },
          ),
  };

  const testLayer = Layer.mergeAll(
    Layer.succeed(DbTag, db),
    Layer.succeed(LLMClientTag, llmClient as never),
    Layer.succeed(OrgServiceTag, orgService as never),
    Layer.succeed(ActivityDataServiceTag, activityDataService as never),
    Layer.succeed(NowTag, () => '2026-05-15T12:00:00Z'),
  );

  return { db, testLayer, llmClient };
}

describe('answer-generation.generate (Effect Step 2)', () => {
  it('happy path: returns answer row + inserts to DB', async () => {
    const { testLayer, db, llmClient } = setup({
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
    expect(llmClient.generateAnswer).toHaveBeenCalledTimes(1);
    const row = db.prepare(`SELECT * FROM answer WHERE question_id = ?`).get('q-1');
    expect(row).toBeTruthy();
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

  it('LLMCallFailed when LLM rejects', async () => {
    const { testLayer } = setup({
      seedQuestionnaire: { id: 'qn-1', reporting_year: 2026, customer_name: 'A' },
      seedQuestion: { id: 'q-1', questionnaire_id: 'qn-1', raw_text: 'Q' },
      activitiesForYear: 1,
      llmThrows: new Error('network down'),
    });
    const exit = await Effect.runPromiseExit(
      answerSvc.generate('q-1', FAKE_CONFIG).pipe(Effect.provide(testLayer)),
    );
    expect(failureTag(exit)).toBe('LLMCallFailed');
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
    const row = db
      .prepare(`SELECT * FROM answer WHERE question_id = ?`)
      .get('q-1') as { value: string; source_kind: string; finalized_at: string | null };
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
    const row = db
      .prepare(`SELECT finalized_at FROM answer WHERE question_id = ?`)
      .get('q-1') as { finalized_at: string };
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
