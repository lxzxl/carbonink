/**
 * MCP read query functions — plain TS, no Effect.
 *
 * Process split: this module runs in the standalone MCP server and reads
 * the workspace SQLite file directly (reads stay available with the app
 * closed; writes go over the agent bridge). The verbatim-shared fragments
 * (single-row selects, question ordering, org source join) live in
 * `@shared/read-models` alongside their in-process twins — change one
 * seam, change both. The trimmed list projections stay here: they are
 * agent-context-window shapes, not shared seams.
 *
 * Uses a minimal DbLike interface so the same functions can run under:
 *   - `node:sqlite` DatabaseSync  (production MCP binary)
 *   - `better-sqlite3` Database   (vitest tests)
 *
 * Both expose: `.prepare(sql)` → Statement with `.get(...args)` / `.all(...args)` / `.run(...args)`.
 */
import {
  getAnswerByQuestion,
  getCustomerRow,
  getDocumentRow,
  getQuestionnaireRow,
  listQuestionRows,
  listSourceRows,
} from '@shared/read-models.js';

type Statement = {
  get: (...args: unknown[]) => unknown;
  all: (...args: unknown[]) => unknown[];
  run: (...args: unknown[]) => { changes: number; lastInsertRowid: number | bigint };
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
  const questionnaire = getQuestionnaireRow<Record<string, unknown>>(db, id);
  if (!questionnaire) return null;
  const customer = getCustomerRow(db, String(questionnaire.customer_id));
  const document = getDocumentRow(db, String(questionnaire.document_id));
  const questions = listQuestionRows(db, id);
  return { questionnaire, customer, document, questions };
}

// ---------------------------------------------------------------------------
// 3. list_questions
// ---------------------------------------------------------------------------

export function listQuestions(db: DbLike, questionnaireId: string): unknown[] {
  return listQuestionRows(db, questionnaireId);
}

// ---------------------------------------------------------------------------
// 4. get_answer
// ---------------------------------------------------------------------------

export function getAnswer(db: DbLike, questionId: string): unknown | null {
  return getAnswerByQuestion(db, questionId);
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
    return listSourceRows(db, opts.organization_id);
  }
  return db.prepare('SELECT * FROM emission_source').all();
}

// ---------------------------------------------------------------------------
// Writes deliberately absent.
//
// set_answer / create_activity / create_emission_source used to write SQLite
// directly from here, which bypassed the service layer and so skipped EF unit
// conversion, the CH4/N2O AR6 terms, ULID ids and every audit_event. They now
// go over the agent bridge into the app's own IPC handlers instead
// (spec 2026-08-13-mcp-write-path-integrity). Keep this module read-only: a
// second write path is what caused those divergences in the first place.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 10. inventoryTotals (QUERY for resources)
// ---------------------------------------------------------------------------

export interface InventoryTotals {
  total_co2e_kg: number;
  scope1_kg: number;
  scope2_kg: number;
  scope3_kg: number;
  activity_count: number;
}

export function inventoryTotals(db: DbLike, year: number): InventoryTotals {
  const row = db
    .prepare(
      `
      SELECT
        COALESCE(SUM(a.computed_co2e_kg), 0) AS total_co2e_kg,
        COALESCE(SUM(CASE WHEN es.scope = 1 THEN a.computed_co2e_kg ELSE 0 END), 0) AS scope1_kg,
        COALESCE(SUM(CASE WHEN es.scope = 2 THEN a.computed_co2e_kg ELSE 0 END), 0) AS scope2_kg,
        COALESCE(SUM(CASE WHEN es.scope = 3 THEN a.computed_co2e_kg ELSE 0 END), 0) AS scope3_kg,
        COUNT(a.id) AS activity_count
        FROM activity_data a
        JOIN emission_source es ON es.id = a.emission_source_id
        JOIN reporting_period rp ON rp.id = a.reporting_period_id
       WHERE rp.year = ?
    `,
    )
    .get(year);
  return row as never;
}
