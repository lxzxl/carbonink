import { runMigrations } from '@main/db/migrate';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import * as q from '../../src/mcp/queries';

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

function seedCustomer(db: Database.Database, id = 'cu-1', name = 'Acme') {
  db.prepare(`INSERT INTO customer (id, name, notes) VALUES (?, ?, NULL)`).run(id, name);
}

function seedDocument(db: Database.Database, id = 'doc-1') {
  db.prepare(
    `INSERT INTO document (id, sha256, filename, mime_type, size_bytes, storage_path, uploaded_at)
     VALUES (?, 'a1b2c3', 'q.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 1024, '/tmp/q.xlsx', '2026-01-01T00:00:00Z')`,
  ).run(id);
}

function seedQuestionnaire(
  db: Database.Database,
  opts: { id?: string; customerId?: string; documentId?: string; year?: number } = {},
) {
  const { id = 'qn-1', customerId = 'cu-1', documentId = 'doc-1', year = 2025 } = opts;
  db.prepare(
    `INSERT INTO questionnaire (id, customer_id, document_id, reporting_year, status, due_date, created_at)
     VALUES (?, ?, ?, ?, 'mapping', NULL, '2026-01-01T00:00:00Z')`,
  ).run(id, customerId, documentId, year);
  return id;
}

function seedQuestion(
  db: Database.Database,
  opts: { id?: string; questionnaireId?: string; position?: string } = {},
) {
  const { id = 'q-1', questionnaireId = 'qn-1', position = 'A1' } = opts;
  db.prepare(
    `INSERT INTO question (id, questionnaire_id, question_signature, signature_version, normalized_text, raw_text, parsed_intent, question_kind, expected_unit, position, required)
     VALUES (?, ?, 'sig', 'v1', 'normalized', 'raw text', NULL, 'numerical', 'kWh', ?, 0)`,
  ).run(id, questionnaireId, position);
  return id;
}

function seedOrganization(db: Database.Database, id = 'org-1') {
  db.prepare(
    `INSERT INTO organization (id, name_en, country_code, boundary_kind, created_at, updated_at)
     VALUES (?, 'Test Org', 'CN', 'operational_control', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
  ).run(id);
  return id;
}

function seedSite(db: Database.Database, opts: { id?: string; organizationId?: string } = {}) {
  const { id = 'site-1', organizationId = 'org-1' } = opts;
  db.prepare(
    `INSERT INTO site (id, organization_id, name_en, country_code, created_at, updated_at)
     VALUES (?, ?, 'HQ', 'CN', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
  ).run(id, organizationId);
  return id;
}

function seedEmissionSource(
  db: Database.Database,
  opts: { id?: string; siteId?: string; scope?: number } = {},
) {
  const { id = 'es-1', siteId = 'site-1', scope = 2 } = opts;
  db.prepare(
    `INSERT INTO emission_source (id, site_id, name, scope)
     VALUES (?, ?, 'Grid electricity', ?)`,
  ).run(id, siteId, scope);
  return id;
}

function seedReportingPeriod(
  db: Database.Database,
  opts: { id?: string; organizationId?: string; year?: number } = {},
) {
  const { id = 'rp-1', organizationId = 'org-1', year = 2024 } = opts;
  db.prepare(
    `INSERT INTO reporting_period (id, organization_id, year, granularity, starts_at, ends_at, created_at)
     VALUES (?, ?, ?, 'annual', '2024-01-01', '2024-12-31', '2026-01-01T00:00:00Z')`,
  ).run(id, organizationId, year);
  return id;
}

function seedPinnedEf(db: Database.Database) {
  db.prepare(
    `INSERT INTO pinned_emission_factor
       (factor_code, year, source, geography, dataset_version,
        scope, input_unit, co2e_kg_per_unit, gwp_basis, pinned_at, pinned_from)
     VALUES
       ('electricity.grid.cn.national.2024', 2024, 'MEE_China', 'CN', '2024.q4',
        2, 'kWh', 0.5839, 'AR6', '2026-01-01T00:00:00Z', 'emission_factor')`,
  ).run();
}

function seedActivityData(db: Database.Database) {
  db.prepare(
    `INSERT INTO activity_data
       (id, site_id, emission_source_id, reporting_period_id,
        occurred_at_start, occurred_at_end, amount, unit,
        ef_factor_code, ef_year, ef_source, ef_geography, ef_dataset_version,
        computed_co2e_kg, computed_at, created_at, updated_at)
     VALUES
       ('act-1', 'site-1', 'es-1', 'rp-1',
        '2024-01-01', '2024-12-31', 1000.0, 'kWh',
        'electricity.grid.cn.national.2024', 2024, 'MEE_China', 'CN', '2024.q4',
        583.9, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
  ).run();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('mcp queries — read', () => {
  it('listQuestionnaires returns each questionnaire with question count', () => {
    const db = setupDb();
    seedCustomer(db);
    seedDocument(db);
    seedQuestionnaire(db);
    seedQuestion(db, { id: 'q-1', position: 'A1' });
    seedQuestion(db, { id: 'q-2', position: 'A2' });

    const result = q.listQuestionnaires(db as never);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'qn-1',
      customer_name: 'Acme',
      reporting_year: 2025,
      status: 'mapping',
      question_count: 2,
    });
  });

  it('getQuestionnaire returns full detail including customer, document, and questions', () => {
    const db = setupDb();
    seedCustomer(db);
    seedDocument(db);
    seedQuestionnaire(db);
    seedQuestion(db);

    const result = q.getQuestionnaire(db as never, 'qn-1');

    expect(result).not.toBeNull();
    expect((result as q.QuestionnaireDetail).questionnaire).toMatchObject({ id: 'qn-1' });
    expect((result as q.QuestionnaireDetail).customer).toMatchObject({ name: 'Acme' });
    expect((result as q.QuestionnaireDetail).document).toMatchObject({ filename: 'q.xlsx' });
    expect((result as q.QuestionnaireDetail).questions).toHaveLength(1);
  });

  it('getQuestionnaire returns null for unknown id', () => {
    const db = setupDb();

    const result = q.getQuestionnaire(db as never, 'nonexistent');

    expect(result).toBeNull();
  });

  it('listQuestions returns questions for a questionnaire in position order', () => {
    const db = setupDb();
    seedCustomer(db);
    seedDocument(db);
    seedQuestionnaire(db);
    // Insert out of order — alphabetical sort: A1 < A2 < B1
    seedQuestion(db, { id: 'q-2', position: 'A2' });
    seedQuestion(db, { id: 'q-1', position: 'A1' });
    seedQuestion(db, { id: 'q-3', position: 'B1' });

    const result = q.listQuestions(db as never, 'qn-1') as Array<{ id: string }>;

    expect(result).toHaveLength(3);
    expect(result.map((r) => r.id)).toEqual(['q-1', 'q-2', 'q-3']);
  });

  it('getAnswer returns the answer row for a given question_id', () => {
    const db = setupDb();
    seedCustomer(db);
    seedDocument(db);
    seedQuestionnaire(db);
    seedQuestion(db);
    db.prepare(
      `INSERT INTO answer (id, question_id, value, unit, source_kind, finalized_at)
       VALUES ('ans-1', 'q-1', '14820', 'kWh', 'manual', NULL)`,
    ).run();

    const result = q.getAnswer(db as never, 'q-1') as Record<string, unknown>;

    expect(result).not.toBeNull();
    expect(result['value']).toBe('14820');
    expect(result['unit']).toBe('kWh');
    expect(result['source_kind']).toBe('manual');
  });

  it('getAnswer returns null when no answer exists', () => {
    const db = setupDb();
    seedCustomer(db);
    seedDocument(db);
    seedQuestionnaire(db);
    seedQuestion(db);

    const result = q.getAnswer(db as never, 'q-1');

    expect(result).toBeNull();
  });

  it('listActivities returns all activities when no filter is given', () => {
    const db = setupDb();
    seedOrganization(db);
    seedSite(db);
    seedEmissionSource(db);
    seedReportingPeriod(db);
    seedPinnedEf(db);
    seedActivityData(db);

    const result = q.listActivities(db as never) as Array<{ id: string }>;

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('act-1');
  });

  it('listEmissionSources returns sources filtered by organization_id', () => {
    const db = setupDb();
    seedOrganization(db);
    seedSite(db);
    seedEmissionSource(db, { id: 'es-1', siteId: 'site-1', scope: 2 });

    const result = q.listEmissionSources(db as never, {
      organization_id: 'org-1',
    }) as Array<{ id: string }>;

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('es-1');
  });
});
