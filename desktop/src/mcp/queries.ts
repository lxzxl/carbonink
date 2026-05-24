/**
 * MCP read/write query functions — plain TS, no Effect.
 *
 * Uses a minimal DbLike interface so the same functions can run under:
 *   - `node:sqlite` DatabaseSync  (production MCP binary)
 *   - `better-sqlite3` Database   (vitest tests)
 *
 * Both expose: `.prepare(sql)` → Statement with `.get(...args)` / `.all(...args)` / `.run(...args)`.
 */

import { randomUUID } from 'node:crypto';

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

// ---------------------------------------------------------------------------
// 7. set_answer  (UPSERT)
// ---------------------------------------------------------------------------

export function setAnswer(
  db: DbLike,
  input: { question_id: string; value: string; unit?: string | null; finalize?: boolean },
): unknown {
  const now = new Date().toISOString();
  const finalizedAt = input.finalize ? now : null;
  const existing = db.prepare('SELECT id FROM answer WHERE question_id = ?').get(input.question_id);
  if (existing) {
    db.prepare(
      `UPDATE answer SET value = ?, unit = ?, source_kind = 'manual', finalized_at = ?
       WHERE question_id = ?`,
    ).run(input.value, input.unit ?? null, finalizedAt, input.question_id);
  } else {
    db.prepare(
      `INSERT INTO answer (id, question_id, value, unit, source_kind, source_summary, finalized_at)
       VALUES (?, ?, ?, ?, 'manual', NULL, ?)`,
    ).run(randomUUID(), input.question_id, input.value, input.unit ?? null, finalizedAt);
  }
  return db.prepare('SELECT * FROM answer WHERE question_id = ?').get(input.question_id);
}

// ---------------------------------------------------------------------------
// 8. create_activity
// ---------------------------------------------------------------------------

export function createActivity(
  db: DbLike,
  input: {
    site_id: string;
    emission_source_id: string;
    reporting_period_id: string;
    occurred_at_start: string;
    occurred_at_end: string;
    amount: number;
    unit: string;
    ef_factor_code: string;
    ef_year: number;
    ef_source: string;
    ef_geography: string;
    ef_dataset_version: string;
    notes?: string | null;
  },
): unknown {
  const pinned = db
    .prepare(
      `SELECT co2e_kg_per_unit FROM pinned_emission_factor
        WHERE factor_code = ? AND year = ? AND source = ? AND geography = ? AND dataset_version = ?`,
    )
    .get(
      input.ef_factor_code,
      input.ef_year,
      input.ef_source,
      input.ef_geography,
      input.ef_dataset_version,
    ) as { co2e_kg_per_unit: number } | undefined;

  if (!pinned) {
    throw new Error(
      `EF not pinned: ${input.ef_factor_code} @ ${input.ef_year} ` +
        `(${input.ef_source}/${input.ef_geography}/${input.ef_dataset_version}). ` +
        `Use it once in CarbonInk GUI to auto-pin.`,
    );
  }

  const co2eKg = Math.round(input.amount * pinned.co2e_kg_per_unit * 100) / 100;
  const id = randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO activity_data
       (id, site_id, emission_source_id, reporting_period_id,
        occurred_at_start, occurred_at_end, amount, unit,
        ef_factor_code, ef_year, ef_source, ef_geography, ef_dataset_version,
        computed_co2e_kg, computed_at, extraction_id, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
  ).run(
    id,
    input.site_id,
    input.emission_source_id,
    input.reporting_period_id,
    input.occurred_at_start,
    input.occurred_at_end,
    input.amount,
    input.unit,
    input.ef_factor_code,
    input.ef_year,
    input.ef_source,
    input.ef_geography,
    input.ef_dataset_version,
    co2eKg,
    now,
    input.notes ?? null,
    now,
    now,
  );

  return db.prepare('SELECT * FROM activity_data WHERE id = ?').get(id);
}

// ---------------------------------------------------------------------------
// 9. create_emission_source
// ---------------------------------------------------------------------------

export function createEmissionSource(
  db: DbLike,
  input: {
    site_id: string;
    name: string;
    scope: 1 | 2 | 3;
    category?: string | null;
    ghg_protocol_path?: string | null;
  },
): unknown {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO emission_source
       (id, site_id, name, scope, category, ghg_protocol_path, default_ef_query, template_origin, is_active)
     VALUES (?, ?, ?, ?, ?, ?, NULL, 'mcp', 1)`,
  ).run(
    id,
    input.site_id,
    input.name,
    input.scope,
    input.category ?? null,
    input.ghg_protocol_path ?? null,
  );
  return db.prepare('SELECT * FROM emission_source WHERE id = ?').get(id);
}

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
