import { randomUUID } from 'node:crypto';
import type { LLMClient } from '@main/llm/llm-client';
import { ProviderNotConfiguredError, SchemaMismatchError } from '@main/llm/llm-client';
import type { Answer, ProviderConfig, Question, Questionnaire } from '@shared/types';
import type { Database } from 'better-sqlite3';
import { Data, Effect } from 'effect';
import type { ActivityDataService } from './activity-data-service';
import type { OrganizationService } from './organization-service';

export class QuestionNotFound extends Data.TaggedError('QuestionNotFound')<{
  id: string;
}> {}

export class QuestionAlreadyAnswered extends Data.TaggedError('QuestionAlreadyAnswered')<{
  id: string;
}> {}

export class QuestionnaireNotFound extends Data.TaggedError('QuestionnaireNotFound')<{
  id: string;
}> {}

export class InventoryEmpty extends Data.TaggedError('InventoryEmpty')<{
  year: number;
}> {}

export class LLMSchemaMismatch extends Data.TaggedError('LLMSchemaMismatch')<{
  raw: string;
}> {}

export class LLMCallFailed extends Data.TaggedError('LLMCallFailed')<{
  cause: unknown;
}> {}

export class ProviderNotConfigured extends Data.TaggedError('ProviderNotConfigured')<{}> {}

export class AnswerNotFound extends Data.TaggedError('AnswerNotFound')<{
  question_id: string;
}> {}

export type GenErr =
  | QuestionNotFound
  | QuestionAlreadyAnswered
  | QuestionnaireNotFound
  | InventoryEmpty
  | LLMSchemaMismatch
  | LLMCallFailed
  | ProviderNotConfigured;

export type SaveErr = AnswerNotFound;

export interface SaveInput {
  question_id: string;
  value: string;
  unit: string | null;
  finalize: boolean;
}

export class AnswerGenerationService {
  constructor(
    private readonly deps: {
      db: Database;
      llmClient: LLMClient;
      orgService: OrganizationService;
      activityDataService: ActivityDataService;
      config: ProviderConfig;
      now?: () => string;
    },
  ) {}

  generate(questionId: string): Effect.Effect<Answer, GenErr, never> {
    // Capture deps before the generator — `this` is unreliable inside function*
    const { db, llmClient, orgService, activityDataService, config } = this.deps;
    const nowFn = this.deps.now ?? (() => new Date().toISOString());

    return Effect.gen(function* () {
      const question = yield* readQuestion(db, questionId);

      const existing = yield* readAnswerByQuestion(db, questionId);
      if (existing) {
        return yield* Effect.fail(new QuestionAlreadyAnswered({ id: questionId }));
      }

      const questionnaire = yield* readQuestionnaire(db, question.questionnaire_id);

      const inventory = yield* loadInventoryContext(
        orgService,
        activityDataService,
        questionnaire.reporting_year,
      );
      if (inventory.activity_count === 0) {
        return yield* Effect.fail(new InventoryEmpty({ year: questionnaire.reporting_year }));
      }

      const llmResult = yield* Effect.tryPromise({
        try: () =>
          llmClient.generateAnswer(
            config,
            {
              raw_text: question.raw_text,
              expected_unit: question.expected_unit,
              question_kind: question.question_kind,
            },
            inventory,
          ),
        catch: (cause): GenErr =>
          cause instanceof ProviderNotConfiguredError
            ? new ProviderNotConfigured()
            : cause instanceof SchemaMismatchError
              ? new LLMSchemaMismatch({ raw: cause.rawText ?? '' })
              : new LLMCallFailed({ cause }),
      });

      const answer = yield* insertAnswer(db, {
        id: randomUUID(),
        question_id: questionId,
        value: llmResult.value,
        unit: llmResult.unit,
        source_summary: llmResult.source_summary,
        created_at: nowFn(),
      });

      return answer;
    });
  }

  save(input: SaveInput): Effect.Effect<Answer, SaveErr, never> {
    const { db } = this.deps;
    const nowFn = this.deps.now ?? (() => new Date().toISOString());
    return Effect.gen(function* () {
      const existing = yield* readAnswerByQuestion(db, input.question_id);
      if (!existing)
        return yield* Effect.fail(new AnswerNotFound({ question_id: input.question_id }));
      const finalizedAt = input.finalize ? nowFn() : existing.finalized_at;
      yield* Effect.sync(() => {
        db.prepare(
          `UPDATE answer SET value = ?, unit = ?, source_kind = 'manual', finalized_at = ? WHERE question_id = ?`,
        ).run(input.value, input.unit, finalizedAt, input.question_id);
      });
      return yield* Effect.sync(
        () =>
          db.prepare(`SELECT * FROM answer WHERE question_id = ?`).get(input.question_id) as Answer,
      );
    });
  }

  listByQuestionnaire(questionnaireId: string): Effect.Effect<Answer[], never, never> {
    const { db } = this.deps;
    return Effect.sync(
      () =>
        db
          .prepare(`
        SELECT a.*
        FROM answer a
        JOIN question q ON q.id = a.question_id
        WHERE q.questionnaire_id = ?
        ORDER BY q.position
      `)
          .all(questionnaireId) as Answer[],
    );
  }
}

function readQuestion(db: Database, id: string): Effect.Effect<Question, QuestionNotFound, never> {
  return Effect.sync(
    () => db.prepare('SELECT * FROM question WHERE id = ?').get(id) as Question | undefined,
  ).pipe(
    Effect.flatMap((q) => (q ? Effect.succeed(q) : Effect.fail(new QuestionNotFound({ id })))),
  );
}

function readAnswerByQuestion(
  db: Database,
  qid: string,
): Effect.Effect<Answer | null, never, never> {
  return Effect.sync(
    () =>
      (db.prepare('SELECT * FROM answer WHERE question_id = ?').get(qid) as Answer | undefined) ??
      null,
  );
}

function readQuestionnaire(
  db: Database,
  id: string,
): Effect.Effect<Questionnaire, QuestionnaireNotFound, never> {
  return Effect.sync(
    () =>
      db.prepare('SELECT * FROM questionnaire WHERE id = ?').get(id) as Questionnaire | undefined,
  ).pipe(
    Effect.flatMap((q) => (q ? Effect.succeed(q) : Effect.fail(new QuestionnaireNotFound({ id })))),
  );
}

function loadInventoryContext(
  orgService: OrganizationService,
  activityDataService: ActivityDataService,
  year: number,
): Effect.Effect<
  {
    year: number;
    activity_count: number;
    activities_summary: string;
    totals: {
      total_co2e_kg: number;
      scope1_kg?: number;
      scope2_kg?: number;
      scope3_kg?: number;
    } | null;
  },
  never,
  never
> {
  return Effect.sync(() => {
    const org = orgService.getCurrentOrganization();
    if (!org) return { year, activity_count: 0, activities_summary: '无组织', totals: null };
    const periods = orgService
      .listReportingPeriodsByOrganization(org.id)
      .filter((p) => p.year === year);
    const period = periods[0];
    if (!period)
      return { year, activity_count: 0, activities_summary: '无该年度报告期', totals: null };
    const activities = activityDataService.listByPeriod(period.id);
    const totals = activityDataService.totalsByPeriod(period.id);
    return {
      year,
      activity_count: activities.length,
      activities_summary: `${activities.length} 条活动数据`,
      totals,
    };
  });
}

function insertAnswer(
  db: Database,
  input: {
    id: string;
    question_id: string;
    value: string;
    unit: string | null;
    source_summary: string;
    created_at: string;
  },
): Effect.Effect<Answer, never, never> {
  return Effect.sync(() => {
    // source_summary has a json_valid CHECK constraint — must be JSON or NULL
    const sourceSummaryJson = input.source_summary ? JSON.stringify(input.source_summary) : null;
    db.prepare(`
      INSERT INTO answer (id, question_id, value, unit, source_kind, source_summary, finalized_at)
      VALUES (?, ?, ?, ?, 'ai_suggested', ?, NULL)
    `).run(input.id, input.question_id, input.value, input.unit, sourceSummaryJson);
    return db.prepare(`SELECT * FROM answer WHERE id = ?`).get(input.id) as Answer;
  });
}
