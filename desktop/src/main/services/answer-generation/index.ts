import { randomUUID } from 'node:crypto';
import type { ActivityDataService } from '@main/services/activity-data-service';
import type { OrganizationService } from '@main/services/organization-service';
import type { Answer, ProviderConfigV2, Question, Questionnaire } from '@shared/types';
import type { Database } from 'better-sqlite3';
import { Effect, type Either } from 'effect';
import { z } from 'zod';
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

/**
 * Per-question-kind tail of the system prompt. Kept inline (rather than in a
 * data file) because the wording is tightly coupled to the schema validators
 * below — e.g. the narrative `valueMax = 2000` mirrors the "≤300 字" guidance.
 */
const KIND_INSTRUCTIONS: Record<'numerical' | 'categorical' | 'narrative', string> = {
  numerical: '请返回数字字符串 + 单位。优先从 inventory 总排放 / 活动数据中推算。',
  categorical: '请返回一个短词答案（≤10 字），如"是"/"否"/"部分"/"不适用"或行业代码/类型名。',
  narrative: '请返回 1-3 句中文叙述（≤300 字），结合 inventory 给出可审计的回答。',
};

interface InventoryContext {
  year: number;
  activity_count: number;
  activities_summary: string;
  totals: {
    total_co2e_kg: number;
    scope1_kg?: number;
    scope2_kg?: number;
    scope3_kg?: number;
  } | null;
}

interface QuestionContext {
  raw_text: string;
  expected_unit?: string | null;
  question_kind: 'numerical' | 'categorical' | 'narrative';
}

/**
 * Build the schema for the LLM's structured response. `valueMax` depends on
 * the question kind so narrative answers get headroom while numerical/
 * categorical answers are kept terse.
 */
function buildAnswerSchema(question_kind: 'numerical' | 'categorical' | 'narrative') {
  const valueMax = question_kind === 'narrative' ? 2000 : 50;
  return z.object({
    value: z.string().max(valueMax),
    unit: z.string().nullable(),
    source_summary: z.string().max(500),
  });
}

/**
 * Render the answer-generation prompt. Lives in the service (not the
 * AiClient) so the AiClient stays a dumb conduit — services own their
 * prompts, the client only sends bytes. Matches the broader pi-ai
 * migration pattern.
 */
function buildAnswerPrompt(question: QuestionContext, inventory: InventoryContext): string {
  return `你是一名碳核算助理。下面是一道供应商问卷的题目，以及当前组织 ${inventory.year} 年度的 inventory 数据。请基于 inventory 给出答案。

题目类型：${question.question_kind}
${KIND_INSTRUCTIONS[question.question_kind]}

<question>
${question.raw_text}
${question.expected_unit ? `期望单位：${question.expected_unit}` : ''}
</question>

<inventory>
活动数据行数：${inventory.activity_count}
活动数据摘要：${inventory.activities_summary}
${inventory.totals ? `总排放：${JSON.stringify(inventory.totals)}` : '无总排放快照。'}
</inventory>

返回 JSON: { value: <答案字符串，可以是数字字符串或文本>, unit: <单位字符串，若题面有要求；否则 null>, source_summary: <1-2 句中文，说明答案是从 inventory 哪部分推出来的> }

如果 inventory 里没有相关数据，value 用空字符串 ""，source_summary 解释为何无法回答。`;
}

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
