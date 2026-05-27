import { randomUUID } from 'node:crypto';
import type { ActivityDataService } from '@main/services/activity-data-service';
import type { OrganizationService } from '@main/services/organization-service';
import type { Answer, ProviderConfigV2, Question, Questionnaire } from '@shared/types';
import type { Database } from 'better-sqlite3';
import { Effect, type Either } from 'effect';
import {
  AnswerNotFound,
  type GenErr,
  InventoryEmpty,
  LLMNoData,
  QuestionAlreadyAnswered,
  QuestionNotFound,
  QuestionnaireNotFound,
  type SaveErr,
  type SaveInput,
} from './errors';
import { buildAnswerPrompt, buildAnswerSchema, type InventoryContext } from './prompt';
import {
  ActivityDataServiceTag,
  AiClientTag,
  type AnswerR,
  DbTag,
  NowTag,
  OrgServiceTag,
} from './tags';

export * from './errors';
export * from './tags';

export type GenerateResult = Either.Either<Answer, GenErr>;

export function generate(
  questionId: string,
  // `config` is kept on the signature for API compatibility (callers pass the
  // active ProviderConfigV2 per request) but the LLM is no longer dispatched
  // from inside this function — the AiClient layer carries the provider
  // binding. Once the renderer-side cutover (Task 10b) lands, this parameter
  // can be dropped entirely.
  _config: ProviderConfigV2,
): Effect.Effect<Answer, GenErr, AnswerR> {
  return Effect.gen(function* () {
    const db = yield* DbTag;
    const ai = yield* AiClientTag;
    const orgService = yield* OrgServiceTag;
    const activityDataService = yield* ActivityDataServiceTag;
    const now = yield* NowTag;

    const question = yield* readQuestion(db, questionId);
    const existing = yield* readAnswerByQuestion(db, questionId);
    if (existing) return yield* Effect.fail(new QuestionAlreadyAnswered({ id: questionId }));

    const questionnaire = yield* readQuestionnaire(db, question.questionnaire_id);
    const inventory = loadInventoryContext(
      orgService,
      activityDataService,
      questionnaire.reporting_year,
    );
    if (inventory.activity_count === 0) {
      return yield* Effect.fail(new InventoryEmpty({ year: questionnaire.reporting_year }));
    }

    const schema = buildAnswerSchema(question.question_kind);
    const prompt = buildAnswerPrompt(
      {
        raw_text: question.raw_text,
        expected_unit: question.expected_unit,
        question_kind: question.question_kind,
      },
      inventory,
    );

    // AiClient is responsible for retry / timeout / typed-error mapping —
    // the service just consumes the parsed object or propagates the AiErr.
    const llmResult = yield* ai.generateObject({ schema, prompt });

    // The prompt instructs the LLM to return `value=""` when inventory data
    // doesn't cover the question. Don't persist that — surface it as a
    // distinct typed error so the UI can keep the card in "not generated"
    // state and toast the reason.
    if (llmResult.value.trim() === '') {
      return yield* Effect.fail(new LLMNoData({ reason: llmResult.source_summary }));
    }

    // Force unit to null for non-numerical questions, regardless of what LLM returned.
    // Only numerical questions should have a unit persisted.
    const unit = question.question_kind === 'numerical' ? llmResult.unit : null;

    return yield* insertAnswer(db, {
      id: randomUUID(),
      question_id: questionId,
      value: llmResult.value,
      unit,
      source_summary: llmResult.source_summary,
      created_at: now(),
    });
  });
}

export function generateAllUnanswered(
  questionnaireId: string,
  config: ProviderConfigV2,
): Effect.Effect<readonly GenerateResult[], never, AnswerR> {
  return Effect.gen(function* () {
    const db = yield* DbTag;
    const unanswered = readUnansweredQuestions(db, questionnaireId);
    return yield* Effect.forEach(unanswered, (q) => Effect.either(generate(q.id, config)), {
      concurrency: 3,
    });
  });
}

export function save(input: SaveInput): Effect.Effect<Answer, SaveErr, DbTag | NowTag> {
  return Effect.gen(function* () {
    const db = yield* DbTag;
    const nowFn = yield* NowTag;
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

export function unfinalize(questionId: string): Effect.Effect<Answer, SaveErr, DbTag> {
  return Effect.gen(function* () {
    const db = yield* DbTag;
    const existing = yield* readAnswerByQuestion(db, questionId);
    if (!existing) return yield* Effect.fail(new AnswerNotFound({ question_id: questionId }));
    yield* Effect.sync(() => {
      db.prepare(`UPDATE answer SET finalized_at = NULL WHERE question_id = ?`).run(questionId);
    });
    return yield* Effect.sync(
      () => db.prepare(`SELECT * FROM answer WHERE question_id = ?`).get(questionId) as Answer,
    );
  });
}

export function listByQuestionnaire(
  questionnaireId: string,
): Effect.Effect<Answer[], never, DbTag> {
  return Effect.gen(function* () {
    const db = yield* DbTag;
    return db
      .prepare(`
        SELECT a.* FROM answer a
        JOIN question q ON q.id = a.question_id
        WHERE q.questionnaire_id = ?
        ORDER BY q.position
      `)
      .all(questionnaireId) as Answer[];
  });
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
): InventoryContext {
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
}

function readUnansweredQuestions(db: Database, questionnaireId: string): readonly Question[] {
  return db
    .prepare(`
    SELECT q.* FROM question q
    LEFT JOIN answer a ON a.question_id = q.id
    WHERE q.questionnaire_id = ? AND a.id IS NULL
    ORDER BY q.position
  `)
    .all(questionnaireId) as Question[];
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
