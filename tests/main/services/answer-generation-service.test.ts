import { runMigrations } from '@main/db/migrate';
import { AnswerGenerationService } from '@main/services/answer-generation-service';
import type { Answer } from '@shared/types';
import Database from 'better-sqlite3';
import { Cause, Effect, Exit, Option } from 'effect';
import { describe, expect, it, vi } from 'vitest';

const FAKE_CONFIG = {
  provider: 'openai',
  model: 'gpt-4o-mini',
  apiKeyKeyref: 'fake',
} as never;

// Helper: read the typed-error _tag out of an Exit.Failure.
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
    db.prepare(`INSERT INTO customer (id, name, notes) VALUES ('cu-1', ?, NULL)`).run(opts.seedQuestionnaire.customer_name);
    db.prepare(`INSERT INTO document (id, sha256, filename, mime_type, size_bytes, storage_path, uploaded_at) VALUES ('doc-1', 'aa', 'q.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 100, '/tmp/q.xlsx', '2026-05-15T00:00:00Z')`).run();
    db.prepare(`INSERT INTO questionnaire (id, customer_id, document_id, reporting_year, status, due_date, created_at) VALUES (?, 'cu-1', 'doc-1', ?, 'mapping', NULL, '2026-05-15T00:00:00Z')`)
      .run(opts.seedQuestionnaire.id, opts.seedQuestionnaire.reporting_year);
  }
  if (opts?.seedQuestion) {
    db.prepare(`INSERT INTO question (id, questionnaire_id, question_signature, signature_version, normalized_text, raw_text, parsed_intent, question_kind, expected_unit, position, required) VALUES (?, ?, 'sig', 'v1', 'q', ?, NULL, 'numerical', 'kWh', 'Sheet1!B5', 0)`)
      .run(opts.seedQuestion.id, opts.seedQuestion.questionnaire_id, opts.seedQuestion.raw_text);
  }
  if (opts?.seedAnswer) {
    const a = opts.seedAnswer;
    db.prepare(`INSERT INTO answer (id, question_id, value, unit, source_kind, source_summary, finalized_at) VALUES (?, ?, ?, NULL, 'ai_suggested', NULL, NULL)`)
      .run(a.id, a.question_id, a.value);
  }

  const orgService = {
    getCurrentOrganization: vi.fn().mockReturnValue({ id: 'org-1', name_zh: 'Test', name_en: null, industry: null, country_code: 'CN', boundary_kind: 'operational_control', created_at: '2026-05-15T00:00:00Z', updated_at: '2026-05-15T00:00:00Z' }),
    listReportingPeriodsByOrganization: vi.fn().mockReturnValue(
      opts?.seedQuestionnaire
        ? [{ id: 'rp-1', organization_id: 'org-1', year: opts.seedQuestionnaire.reporting_year, granularity: 'annual', starts_at: '', ends_at: '', is_active: 1, created_at: '', updated_at: '' }]
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
      : vi.fn().mockResolvedValue(opts?.llmAnswer ?? { value: '14820', unit: 'kWh', source_summary: 'sum of activities' }),
  };

  return {
    db,
    svc: new AnswerGenerationService({
      db,
      llmClient: llmClient as never,
      orgService: orgService as never,
      activityDataService: activityDataService as never,
      config: FAKE_CONFIG,
      now: () => '2026-05-15T12:00:00Z',
    }),
    llmClient,
  };
}

describe('AnswerGenerationService.generate (Effect Step 1)', () => {
  it('happy path: returns answer row + inserts to DB', async () => {
    const { svc, db, llmClient } = setup({
      seedQuestionnaire: { id: 'qn-1', reporting_year: 2026, customer_name: 'Acme' },
      seedQuestion: { id: 'q-1', questionnaire_id: 'qn-1', raw_text: '2026 total kWh?' },
      activitiesForYear: 12,
      totalsForYear: { total_co2e_kg: 8456.7 },
      llmAnswer: { value: '14820', unit: 'kWh', source_summary: 'sum of activities' },
    });
    const result = await Effect.runPromise(svc.generate('q-1'));
    expect(result.value).toBe('14820');
    expect(result.source_kind).toBe('ai_suggested');
    expect(llmClient.generateAnswer).toHaveBeenCalledTimes(1);
    const row = db.prepare(`SELECT * FROM answer WHERE question_id = ?`).get('q-1');
    expect(row).toBeTruthy();
  });

  it('QuestionNotFound when id does not exist', async () => {
    const { svc } = setup({});
    const exit = await Effect.runPromiseExit(svc.generate('not-real'));
    expect(failureTag(exit)).toBe('QuestionNotFound');
  });

  it('QuestionAlreadyAnswered when answer row already exists', async () => {
    const { svc } = setup({
      seedQuestionnaire: { id: 'qn-1', reporting_year: 2026, customer_name: 'A' },
      seedQuestion: { id: 'q-1', questionnaire_id: 'qn-1', raw_text: 'Q' },
      seedAnswer: { id: 'a-1', question_id: 'q-1', value: 'existing' },
      activitiesForYear: 1,
    });
    const exit = await Effect.runPromiseExit(svc.generate('q-1'));
    expect(failureTag(exit)).toBe('QuestionAlreadyAnswered');
  });

  it('InventoryEmpty when no activities for the year', async () => {
    const { svc } = setup({
      seedQuestionnaire: { id: 'qn-1', reporting_year: 2026, customer_name: 'A' },
      seedQuestion: { id: 'q-1', questionnaire_id: 'qn-1', raw_text: 'Q' },
      activitiesForYear: 0,
    });
    const exit = await Effect.runPromiseExit(svc.generate('q-1'));
    expect(failureTag(exit)).toBe('InventoryEmpty');
  });

  it('LLMCallFailed when LLM rejects', async () => {
    const { svc } = setup({
      seedQuestionnaire: { id: 'qn-1', reporting_year: 2026, customer_name: 'A' },
      seedQuestion: { id: 'q-1', questionnaire_id: 'qn-1', raw_text: 'Q' },
      activitiesForYear: 1,
      llmThrows: new Error('network down'),
    });
    const exit = await Effect.runPromiseExit(svc.generate('q-1'));
    expect(failureTag(exit)).toBe('LLMCallFailed');
  });
});
