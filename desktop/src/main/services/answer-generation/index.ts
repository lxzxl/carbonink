import { randomUUID } from 'node:crypto';
import type { AgentTool, AgentTrace, AiAgentTag } from '@main/llm/ai-agent.js';
import type { AiClientTag } from '@main/llm/ai-client.js';
import type { AiErr } from '@main/llm/errors.js';
import type { ActivityDataService } from '@main/services/activity-data-service';
import type { OrganizationService } from '@main/services/organization-service';
import type { Answer, ProviderConfigV2, Question, Questionnaire } from '@shared/types';
import type { Database } from 'better-sqlite3';
import { Effect, type Either } from 'effect';
import { runAgent } from './agent-loop.js';
import { recordAgentAudit } from './audit.js';
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
import { singleShotFallback } from './fallback';
import type { AnswerOutput, InventoryContext, QuestionContext } from './prompt';
import {
  ActivityDataServiceTag,
  type AnswerR,
  AnswerToolsTag,
  DbTag,
  NowTag,
  OrgServiceTag,
} from './tags';

export * from './errors';
export * from './tags';

export type GenerateResult = Either.Either<Answer, GenErr>;

/**
 * Prefix attached to `source_summary` when generation went through the
 * single-shot fallback path. Lets reviewers see at a glance which
 * generations were "agent-driven" vs "prompt-dump" without having to
 * cross-reference the audit log.
 */
const FALLBACK_PREFIX = '【单 shot fallback】';

export function generate(
  questionId: string,
  // `config` is kept on the signature for API compatibility (callers pass the
  // active ProviderConfigV2 per request) but the LLM is no longer dispatched
  // from inside this function — the AiClient + AiAgent layers carry the
  // provider binding. Once the renderer-side cutover (Task 10b) lands, this
  // parameter can be dropped entirely.
  _config: ProviderConfigV2,
): Effect.Effect<Answer, GenErr, AnswerR> {
  return Effect.gen(function* () {
    const db = yield* DbTag;
    const orgService = yield* OrgServiceTag;
    const activityDataService = yield* ActivityDataServiceTag;
    const tools = yield* AnswerToolsTag;
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

    const questionCtx: QuestionContext = {
      raw_text: question.raw_text,
      expected_unit: question.expected_unit,
      question_kind: question.question_kind,
    };

    // Try the agent path; fall back to single-shot only on the three
    // recoverable "the agent didn't get there" modes. Auth / schema /
    // provider errors still propagate to the caller — they're user-fixable
    // and falling back would mask them.
    const { output, isFallback, trace } = yield* runAgentWithFallback(
      questionCtx,
      inventory,
      tools,
    );

    // Audit one row per generate() call, regardless of which path won.
    yield* recordAgentAudit({ db, questionId, isFallback, trace, now });

    // The prompt instructs the LLM to return `value=""` when inventory data
    // doesn't cover the question. Don't persist that — surface it as a
    // distinct typed error so the UI can keep the card in "not generated"
    // state and toast the reason.
    if (output.value.trim() === '') {
      return yield* Effect.fail(new LLMNoData({ reason: output.source_summary }));
    }

    // Force unit to null for non-numerical questions, regardless of what LLM
    // returned. Only numerical questions should have a unit persisted.
    const unit = question.question_kind === 'numerical' ? output.unit : null;

    const sourceSummary = isFallback
      ? `${FALLBACK_PREFIX} ${output.source_summary}`
      : output.source_summary;

    return yield* insertAnswer(db, {
      id: randomUUID(),
      question_id: questionId,
      value: output.value,
      unit,
      source_summary: sourceSummary,
      created_at: now(),
    });
  });
}

/**
 * Drive the agent loop; on `AgentMaxTurns` / `AgentStalled` / `AiTimeout`
 * swap to `singleShotFallback`. Returns the merged shape `(output,
 * isFallback, trace)` so the caller can emit one audit row + prefix the
 * source_summary in one place.
 *
 * Other `AiErr` members (AiAuthError, AiProviderError, AiSchemaMismatch,
 * AiNoData, AiRateLimited) are deliberately NOT caught — those mean the
 * provider rejected our request shape or the user's credentials. Falling
 * back to a second identical request would just fail the same way; the
 * IPC handler is better equipped to translate them into actionable copy.
 */
function runAgentWithFallback(
  question: QuestionContext,
  inventory: InventoryContext,
  tools: AgentTool[],
): Effect.Effect<
  { output: AnswerOutput; isFallback: boolean; trace: AgentTrace },
  AiErr,
  AiAgentTag | AiClientTag
> {
  return runAgent(question, inventory, tools).pipe(
    Effect.map((r) => ({ output: r.answer, isFallback: false, trace: r.trace })),
    Effect.catchTags({
      AgentMaxTurns: (e) =>
        singleShotFallback(question, inventory).pipe(
          Effect.map((output) => ({
            output,
            isFallback: true,
            trace: makeEmptyTrace('max_turns', e.turnCount),
          })),
        ),
      AgentStalled: (e) =>
        singleShotFallback(question, inventory).pipe(
          Effect.map((output) => ({
            output,
            isFallback: true,
            trace: makeEmptyTrace('stalled', e.turnCount),
          })),
        ),
      AiTimeout: () =>
        singleShotFallback(question, inventory).pipe(
          Effect.map((output) => ({
            output,
            isFallback: true,
            trace: makeEmptyTrace('aborted', 0),
          })),
        ),
    }),
  );
}

/**
 * Trace placeholder for the fallback path. The single-shot route doesn't
 * produce its own trace (it's one round-trip, no tool calls), so we emit
 * a zeroed shape carrying just the stopReason — that's enough for the
 * audit log to distinguish "agent gave up at max turns" from "agent
 * stalled" from "agent timed out".
 */
function makeEmptyTrace(stopReason: AgentTrace['stopReason'], turnCount: number): AgentTrace {
  return {
    turnCount,
    toolCalls: [],
    totalTokens: { input: 0, output: 0 },
    totalDurationMs: 0,
    stopReason,
  };
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
