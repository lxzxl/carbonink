/**
 * Shared read-model SQL behind a minimal `DbLike` seam.
 *
 * The MCP server process (`src/mcp/`) answers read-only agent queries
 * against the workspace SQLite file directly — by design: reads stay
 * available with the app closed (see `bridge-client.ts`), while writes go
 * over the agent bridge into the app's IPC handlers. But the same row
 * shapes are also read in-process by domain services, and the two copies
 * drifted (question ordering, single-row selects).
 *
 * This module owns the verbatim-duplicated fragments only — the single-row
 * selects and the question ordering that appear in both places. Deliberately
 * NOT here: the MCP list projections with trimmed columns (`listQuestionnaires`
 * drops to id/customer/year/status/count for agent context windows) and the
 * aggregation queries (`inventoryTotals`, `sumCo2e`) — those are per-caller
 * shapes, not shared seams.
 *
 * `DbLike` is structural so both better-sqlite3 (main) and node:sqlite
 * (MCP server) satisfy it without importing either.
 */

export interface DbStatement {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

export interface DbLike {
  prepare: (sql: string) => DbStatement;
}

/** Canonical question ordering — position first, id as tiebreak. */
export const QUESTION_ORDER = 'ORDER BY position, id';

/** Single-row selects, shared verbatim across seams. */
export const SELECT_QUESTIONNAIRE_BY_ID = 'SELECT * FROM questionnaire WHERE id = ?';
export const SELECT_QUESTION_BY_ID = 'SELECT * FROM question WHERE id = ?';
export const SELECT_ANSWER_BY_QUESTION = 'SELECT * FROM answer WHERE question_id = ?';
export const SELECT_ANSWER_BY_ID = 'SELECT * FROM answer WHERE id = ?';
export const SELECT_CUSTOMER_BY_ID = 'SELECT * FROM customer WHERE id = ?';
export const SELECT_DOCUMENT_BY_ID = 'SELECT * FROM document WHERE id = ?';

export function getAnswerById<T>(db: DbLike, id: string): T | undefined {
  return db.prepare(SELECT_ANSWER_BY_ID).get(id) as T | undefined;
}

export function getQuestionnaireRow<T>(db: DbLike, id: string): T | undefined {
  return db.prepare(SELECT_QUESTIONNAIRE_BY_ID).get(id) as T | undefined;
}

export function getQuestionRow<T>(db: DbLike, id: string): T | undefined {
  return db.prepare(SELECT_QUESTION_BY_ID).get(id) as T | undefined;
}

export function getAnswerByQuestion<T>(db: DbLike, questionId: string): T | null {
  return (db.prepare(SELECT_ANSWER_BY_QUESTION).get(questionId) as T | undefined) ?? null;
}

export function getCustomerRow<T>(db: DbLike, id: string): T | undefined {
  return db.prepare(SELECT_CUSTOMER_BY_ID).get(id) as T | undefined;
}

export function getDocumentRow<T>(db: DbLike, id: string): T | undefined {
  return db.prepare(SELECT_DOCUMENT_BY_ID).get(id) as T | undefined;
}

export function listQuestionRows<T>(db: DbLike, questionnaireId: string): T[] {
  return db
    .prepare(`SELECT * FROM question WHERE questionnaire_id = ? ${QUESTION_ORDER}`)
    .all(questionnaireId) as T[];
}

/** Emission sources of one organization via the site join, canonical ordering. */
export const SELECT_SOURCES_BY_ORG = `SELECT es.*
          FROM emission_source es
          JOIN site s ON s.id = es.site_id
         WHERE s.organization_id = ?
         ORDER BY es.scope ASC, es.name ASC, es.id ASC`;

export function listSourceRows<T>(db: DbLike, organizationId: string): T[] {
  return db.prepare(SELECT_SOURCES_BY_ORG).all(organizationId) as T[];
}
