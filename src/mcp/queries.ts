/**
 * MCP read query functions — plain TS, no Effect.
 *
 * Uses a minimal DbLike interface so the same functions can run under:
 *   - `node:sqlite` DatabaseSync  (production MCP binary)
 *   - `better-sqlite3` Database   (vitest tests)
 *
 * Both expose: `.prepare(sql)` → Statement with `.get(...args)` / `.all(...args)`.
 */

type Statement = {
  get: (...args: unknown[]) => unknown;
  all: (...args: unknown[]) => unknown[];
};

export type DbLike = {
  prepare: (sql: string) => Statement;
};

// ---------------------------------------------------------------------------
// Return-type shapes (for callers that want typed results)
// ---------------------------------------------------------------------------

export interface QuestionnaireSummary {
  id: string;
  customer_name: string;
  reporting_year: number;
  status: string;
  question_count: number;
}

export interface QuestionnaireDetail {
  questionnaire: unknown;
  customer: unknown;
  document: unknown;
  questions: unknown[];
}

// ---------------------------------------------------------------------------
// 1. list_questionnaires
// ---------------------------------------------------------------------------

export function listQuestionnaires(db: DbLike): QuestionnaireSummary[] {
  return db
    .prepare(
      `
      SELECT q.id,
             c.name AS customer_name,
             q.reporting_year,
             q.status,
             (SELECT COUNT(*) FROM question WHERE questionnaire_id = q.id) AS question_count
        FROM questionnaire q
        JOIN customer c ON c.id = q.customer_id
       ORDER BY q.created_at DESC
    `,
    )
    .all() as QuestionnaireSummary[];
}

// ---------------------------------------------------------------------------
// 2. get_questionnaire
// ---------------------------------------------------------------------------

export function getQuestionnaire(db: DbLike, id: string): QuestionnaireDetail | null {
  const questionnaire = db.prepare('SELECT * FROM questionnaire WHERE id = ?').get(id);
  if (!questionnaire) return null;
  const row = questionnaire as Record<string, unknown>;
  const customer = db.prepare('SELECT * FROM customer WHERE id = ?').get(row['customer_id']);
  const document = db.prepare('SELECT * FROM document WHERE id = ?').get(row['document_id']);
  const questions = db
    .prepare('SELECT * FROM question WHERE questionnaire_id = ? ORDER BY position')
    .all(id);
  return { questionnaire, customer, document, questions };
}

// ---------------------------------------------------------------------------
// 3. list_questions
// ---------------------------------------------------------------------------

export function listQuestions(db: DbLike, questionnaireId: string): unknown[] {
  return db
    .prepare('SELECT * FROM question WHERE questionnaire_id = ? ORDER BY position')
    .all(questionnaireId);
}

// ---------------------------------------------------------------------------
// 4. get_answer
// ---------------------------------------------------------------------------

export function getAnswer(db: DbLike, questionId: string): unknown | null {
  return db.prepare('SELECT * FROM answer WHERE question_id = ?').get(questionId) ?? null;
}

// ---------------------------------------------------------------------------
// 5. list_activities
// ---------------------------------------------------------------------------

export interface ListActivitiesOpts {
  reporting_period_id?: string;
  year?: number;
}

export function listActivities(db: DbLike, opts: ListActivitiesOpts = {}): unknown[] {
  if (opts.reporting_period_id) {
    return db
      .prepare('SELECT * FROM activity_data WHERE reporting_period_id = ?')
      .all(opts.reporting_period_id);
  }
  if (opts.year !== undefined) {
    return db
      .prepare(
        `
        SELECT a.*
          FROM activity_data a
          JOIN reporting_period rp ON rp.id = a.reporting_period_id
         WHERE rp.year = ?
      `,
      )
      .all(opts.year);
  }
  return db.prepare('SELECT * FROM activity_data').all();
}

// ---------------------------------------------------------------------------
// 6. list_emission_sources
// ---------------------------------------------------------------------------

export interface ListEmissionSourcesOpts {
  organization_id?: string;
}

export function listEmissionSources(db: DbLike, opts: ListEmissionSourcesOpts = {}): unknown[] {
  if (opts.organization_id) {
    return db
      .prepare(
        `
        SELECT es.*
          FROM emission_source es
          JOIN site s ON s.id = es.site_id
         WHERE s.organization_id = ?
      `,
      )
      .all(opts.organization_id);
  }
  return db.prepare('SELECT * FROM emission_source').all();
}
