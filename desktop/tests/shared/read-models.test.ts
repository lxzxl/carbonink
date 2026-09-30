import { runMigrations } from '@main/db/migrate';
import {
  getAnswerById,
  getAnswerByQuestion,
  getCustomerRow,
  getDocumentRow,
  getQuestionnaireRow,
  getQuestionRow,
  listQuestionRows,
  listSourceRows,
} from '@shared/read-models';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

function seedQuestionnaireTree(db: Database.Database) {
  db.prepare(`INSERT INTO customer (id, name, notes) VALUES ('cu-1', 'Acme', NULL)`).run();
  db.prepare(
    `INSERT INTO document (id, sha256, filename, mime_type, size_bytes, storage_path, uploaded_at)
     VALUES ('doc-1', 'a1b2c3', 'q.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 1024, '/tmp/q.xlsx', '2026-01-01T00:00:00Z')`,
  ).run();
  db.prepare(
    `INSERT INTO questionnaire (id, customer_id, document_id, reporting_year, status, due_date, created_at)
     VALUES ('qn-1', 'cu-1', 'doc-1', 2025, 'mapping', NULL, '2026-01-01T00:00:00Z')`,
  ).run();
  for (const [id, position] of [
    ['q-2', 'A2'],
    ['q-1', 'A1'],
  ] as const) {
    db.prepare(
      `INSERT INTO question (id, questionnaire_id, question_signature, signature_version, normalized_text, raw_text, parsed_intent, question_kind, expected_unit, position, required)
       VALUES (?, 'qn-1', 'sig', 'v1', 'normalized', 'raw text', NULL, 'numerical', 'kWh', ?, 0)`,
    ).run(id, position);
  }
}

describe('shared read-models — the seam both processes read through', () => {
  it('single-row selects hit the same rows from either side', () => {
    const db = setupDb();
    seedQuestionnaireTree(db);
    expect(getQuestionnaireRow(db, 'qn-1')).toMatchObject({ id: 'qn-1' });
    expect(getQuestionnaireRow(db, 'missing')).toBeUndefined();
    expect(getQuestionRow(db, 'q-1')).toMatchObject({ id: 'q-1' });
    expect(getCustomerRow(db, 'cu-1')).toMatchObject({ name: 'Acme' });
    expect(getDocumentRow(db, 'doc-1')).toMatchObject({ filename: 'q.xlsx' });
    expect(getAnswerByQuestion(db, 'q-1')).toBeNull();
    db.prepare(
      `INSERT INTO answer (id, question_id, value, unit, source_kind, finalized_at)
       VALUES ('ans-1', 'q-1', '14820', 'kWh', 'manual', NULL)`,
    ).run();
    expect(getAnswerByQuestion(db, 'q-1')).toMatchObject({ value: '14820' });
    expect(getAnswerById(db, 'ans-1')).toMatchObject({ question_id: 'q-1' });
    expect(getAnswerById(db, 'missing')).toBeUndefined();
  });

  it('question ordering is position, id — one spelling, both seams', () => {
    const db = setupDb();
    seedQuestionnaireTree(db);
    // Inserted A2 before A1; the shared ORDER BY recovers canonical order.
    const rows = listQuestionRows(db, 'qn-1') as Array<{ id: string }>;
    expect(rows.map((r) => r.id)).toEqual(['q-1', 'q-2']);
  });

  it('org sources come through the site join in canonical order', () => {
    const db = setupDb();
    db.prepare(
      `INSERT INTO organization (id, name_en, country_code, boundary_kind, created_at, updated_at)
       VALUES ('org-1', 'Test Org', 'CN', 'operational_control', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
    ).run();
    db.prepare(
      `INSERT INTO site (id, organization_id, name_en, country_code, created_at, updated_at)
       VALUES ('site-1', 'org-1', 'HQ', 'CN', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
    ).run();
    db.prepare(
      `INSERT INTO emission_source (id, site_id, name, scope) VALUES ('es-b', 'site-1', 'b', 2)`,
    ).run();
    db.prepare(
      `INSERT INTO emission_source (id, site_id, name, scope) VALUES ('es-a', 'site-1', 'a', 1)`,
    ).run();
    const rows = listSourceRows(db, 'org-1') as Array<{ id: string }>;
    // scope ASC, name ASC: scope-1 'a' before scope-2 'b'.
    expect(rows.map((r) => r.id)).toEqual(['es-a', 'es-b']);
    expect(listSourceRows(db, 'org-missing')).toEqual([]);
  });
});
