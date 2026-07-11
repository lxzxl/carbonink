import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '@main/db/migrate';
import { ActivityDataService } from '@main/services/activity-data-service';
import { CalculationService } from '@main/services/calculation-service';
import { DocumentService } from '@main/services/document-service';
import { EfService } from '@main/services/ef-service';
import { EmissionSourceService } from '@main/services/emission-source-service';
import { EvidenceService } from '@main/services/evidence-service';
import { LineageService } from '@main/services/lineage-service';
import { OrganizationService } from '@main/services/organization-service';
import { UnitConversionService } from '@main/services/unit-conversion-service';
import type { ActivityData, ActivityLineage, AnswerLineage, ReportingPeriod } from '@shared/types';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const FIXED_NOW = '2026-07-11T00:00:00.000Z';

const CN_NATIONAL = {
  ef_factor_code: 'electricity.grid.cn.national.2024',
  ef_year: 2024,
  ef_source: 'MEE_China',
  ef_geography: 'CN',
  ef_dataset_version: '2024.q4',
} as const;

const PDF_BYTES = Buffer.from('%PDF-1.4 lineage test doc');

let db: Database.Database;
let uploadsDir: string;
let evidence: EvidenceService;
let lineage: LineageService;
let activityService: ActivityDataService;
let documentService: DocumentService;
let period: ReportingPeriod;
let sourceId: string;
let activity: ActivityData;

function createActivity(extra: { extraction_id?: string } = {}): ActivityData {
  return activityService.create({
    emission_source_id: sourceId,
    reporting_period_id: period.id,
    occurred_at_start: '2024-01-01',
    occurred_at_end: '2024-01-31',
    amount: 1000,
    unit: 'kWh',
    ...CN_NATIONAL,
    ...extra,
  });
}

/** Outbound questionnaire chain + a mapped_inventory answer pointing at `activityId`. */
function seedDownstreamAnswer(activityId: string): string {
  db.prepare(`INSERT INTO customer (id, name) VALUES ('cust-1', 'Client A')`).run();
  db.prepare(
    `INSERT INTO questionnaire (id, customer_id, reporting_year, status, created_at)
     VALUES ('qn-out', 'cust-1', 2024, 'answering', ?)`,
  ).run(FIXED_NOW);
  db.prepare(
    `INSERT INTO question (id, questionnaire_id, question_signature, signature_version,
                           normalized_text, raw_text, question_kind, position)
     VALUES ('q-out', 'qn-out', 'sig-1', 'v1', 'total electricity', 'Total electricity (kWh)?', 'numerical', '1')`,
  ).run();
  db.prepare(
    `INSERT INTO answer (id, question_id, value, source_kind, source_activity_data_id, finalized_at)
     VALUES ('ans-out', 'q-out', '1000', 'mapped_inventory', ?, NULL)`,
  ).run(activityId);
  return 'ans-out';
}

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  const ctx = { db, now: () => FIXED_NOW };

  uploadsDir = mkdtempSync(join(tmpdir(), 'carbonink-lineage-test-'));
  documentService = new DocumentService({ ...ctx, uploadsDir });
  evidence = new EvidenceService({ ...ctx, documentService });
  lineage = new LineageService({ db, evidenceService: evidence });

  const unitConv = new UnitConversionService({ db });
  const orgService = new OrganizationService(ctx);
  const sourceService = new EmissionSourceService(ctx);
  activityService = new ActivityDataService({
    ...ctx,
    efService: new EfService(ctx),
    calculationService: new CalculationService({ unitConversion: unitConv }),
    unitConversionService: unitConv,
  });

  const org = orgService.createOrganization({
    name_en: 'Acme Co',
    country_code: 'CN',
    boundary_kind: 'operational_control',
  });
  const site = orgService.createSite({
    organization_id: org.id,
    name_en: 'HQ',
    country_code: 'CN',
  });
  period = orgService.createReportingPeriod({
    organization_id: org.id,
    year: 2024,
    granularity: 'annual',
  });
  sourceId = sourceService.create({
    site_id: site.id,
    name: 'Grid meter',
    scope: 2,
    category: 'electricity.grid',
  }).id;
  activity = createActivity();
});

afterEach(() => {
  db.close();
  rmSync(uploadsDir, { recursive: true, force: true });
});

describe('LineageService.get — activity_data', () => {
  it('hand-typed row: manual source + pinned EF + source name, empty downstream', () => {
    const result = lineage.get({ entity: 'activity_data', id: activity.id }) as ActivityLineage;

    expect(result.entity).toBe('activity_data');
    expect(result.source).toEqual({ kind: 'manual' });
    expect(result.emission_source_name).toBe('Grid meter');
    expect(result.pinned_ef?.factor_code).toBe(CN_NATIONAL.ef_factor_code);
    expect(result.pinned_ef?.dataset_version).toBe(CN_NATIONAL.ef_dataset_version);
    expect(result.answers).toEqual([]);
    expect(result.snapshots).toEqual([]);
    expect(result.evidence).toEqual([]);
  });

  it('includes evidence attachments', () => {
    evidence.add({
      target: { activity_data_id: activity.id },
      file: { filename: 'bill.pdf', mimeType: 'application/pdf', bytes: PDF_BYTES },
    });
    const result = lineage.get({ entity: 'activity_data', id: activity.id }) as ActivityLineage;
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]!.filename).toBe('bill.pdf');
  });

  it('extraction-derived row: source is the uploaded document', () => {
    const doc = documentService.uploadFile({
      filename: 'fuel-invoice.pdf',
      mimeType: 'application/pdf',
      bytes: Buffer.from('%PDF-1.4 invoice'),
    });
    db.prepare(
      `INSERT INTO extraction (id, document_id, llm_provider, llm_model, prompt_version,
                               raw_response, parsed_json, status, created_at)
       VALUES ('ext-1', ?, 'openai', 'gpt-test', 'v1', '{}', '{}', 'parsed', ?)`,
    ).run(doc.id, FIXED_NOW);
    const row = createActivity({ extraction_id: 'ext-1' });

    const result = lineage.get({ entity: 'activity_data', id: row.id }) as ActivityLineage;
    expect(result.source).toEqual({
      kind: 'document',
      extraction_id: 'ext-1',
      document_id: doc.id,
      filename: 'fuel-invoice.pdf',
    });
  });

  it('inbound-ingested row: source is the supplier disclosure', () => {
    db.prepare(
      `INSERT INTO customer (id, name, role) VALUES ('sup-1', 'Steel Co', 'supplier')`,
    ).run();
    db.prepare(
      `INSERT INTO questionnaire (id, customer_id, reporting_year, status, direction, created_at)
       VALUES ('qn-in', 'sup-1', 2024, 'ingested', 'inbound', ?)`,
    ).run(FIXED_NOW);
    db.prepare(
      `INSERT INTO question (id, questionnaire_id, question_signature, signature_version,
                             normalized_text, raw_text, question_kind, position, tier)
       VALUES ('q-in', 'qn-in', 'sig-in', 'v1', 'allocated emissions', '分配排放量', 'numerical', 'B1', 2)`,
    ).run();
    db.prepare(
      `UPDATE activity_data SET inbound_question_id = 'q-in', inbound_tier = 2 WHERE id = ?`,
    ).run(activity.id);

    const result = lineage.get({ entity: 'activity_data', id: activity.id }) as ActivityLineage;
    expect(result.source).toEqual({
      kind: 'inbound',
      questionnaire_id: 'qn-in',
      supplier_name: 'Steel Co',
      question_id: 'q-in',
      tier: 2,
    });
  });

  it('surfaces downstream answers and frozen snapshot lines', () => {
    seedDownstreamAnswer(activity.id);
    db.prepare(
      `INSERT INTO calculation_snapshot
         (id, reporting_period_id, frozen_at, ef_dataset_versions, total_co2e_kg,
          scope1_kg, scope2_kg_location, scope3_kg_by_cat, revision)
       VALUES ('snap-1', ?, '2026-06-30T00:00:00Z', '{}', 570.3, 0, 570.3, '{}', 1)`,
    ).run(period.id);
    db.prepare(
      `INSERT INTO calculation_snapshot_line
         (id, calculation_snapshot_id, original_activity_data_id,
          site_id_at_freeze, site_name_at_freeze,
          emission_source_id_at_freeze, emission_source_name_at_freeze,
          reporting_period_id_at_freeze, occurred_at_start, occurred_at_end,
          amount, unit, ef_input_unit, converted_amount,
          ef_factor_code, ef_year, ef_source, ef_geography, ef_dataset_version,
          ef_co2e_kg_per_unit, ef_gwp_basis, computed_co2e_kg, scope)
       VALUES ('line-1', 'snap-1', ?, 'site-x', 'HQ', 'src-x', 'Grid meter', ?,
               '2024-01-01', '2024-01-31', 1000, 'kWh', 'kWh', 1000,
               ?, ?, ?, ?, ?, 0.5703, 'AR6', 570.3, 2)`,
    ).run(
      activity.id,
      period.id,
      CN_NATIONAL.ef_factor_code,
      CN_NATIONAL.ef_year,
      CN_NATIONAL.ef_source,
      CN_NATIONAL.ef_geography,
      CN_NATIONAL.ef_dataset_version,
    );

    const result = lineage.get({ entity: 'activity_data', id: activity.id }) as ActivityLineage;
    expect(result.answers).toEqual([
      {
        answer_id: 'ans-out',
        question_id: 'q-out',
        questionnaire_id: 'qn-out',
        question_text: 'Total electricity (kWh)?',
        value: '1000',
        finalized_at: null,
      },
    ]);
    expect(result.snapshots).toEqual([
      { snapshot_id: 'snap-1', frozen_at: '2026-06-30T00:00:00Z', revision: 1 },
    ]);
  });

  it('throws a friendly error for an unknown id', () => {
    expect(() => lineage.get({ entity: 'activity_data', id: 'nope' })).toThrow(
      /activity_data not found: nope/,
    );
  });
});

describe('LineageService.get — answer', () => {
  it('mapped_inventory answer embeds one upstream hop of activity lineage', () => {
    const answerId = seedDownstreamAnswer(activity.id);
    evidence.add({
      target: { answer_id: answerId },
      file: { filename: 'evidence.pdf', mimeType: 'application/pdf', bytes: PDF_BYTES },
    });

    const result = lineage.get({ entity: 'answer', id: answerId }) as AnswerLineage;
    expect(result.entity).toBe('answer');
    expect(result.question_text).toBe('Total electricity (kWh)?');
    expect(result.questionnaire).toEqual({
      id: 'qn-out',
      direction: 'outbound',
      reporting_year: 2024,
      customer_name: 'Client A',
    });
    expect(result.source_activity?.entity).toBe('activity_data');
    expect(result.source_activity?.activity.id).toBe(activity.id);
    expect(result.source_activity?.source).toEqual({ kind: 'manual' });
    expect(result.evidence).toHaveLength(1);
  });

  it('manual answer has no upstream activity', () => {
    db.prepare(`INSERT INTO customer (id, name) VALUES ('cust-2', 'Client B')`).run();
    db.prepare(
      `INSERT INTO questionnaire (id, customer_id, reporting_year, status, created_at)
       VALUES ('qn-2', 'cust-2', 2024, 'answering', ?)`,
    ).run(FIXED_NOW);
    db.prepare(
      `INSERT INTO question (id, questionnaire_id, question_signature, signature_version,
                             normalized_text, raw_text, question_kind, position)
       VALUES ('q-2', 'qn-2', 'sig-2', 'v1', 'company name', 'Company name?', 'narrative', '1')`,
    ).run();
    db.prepare(
      `INSERT INTO answer (id, question_id, value, source_kind) VALUES ('ans-2', 'q-2', 'Acme', 'manual')`,
    ).run();

    const result = lineage.get({ entity: 'answer', id: 'ans-2' }) as AnswerLineage;
    expect(result.source_activity).toBeNull();
    expect(result.evidence).toEqual([]);
  });

  it('throws a friendly error for an unknown id', () => {
    expect(() => lineage.get({ entity: 'answer', id: 'nope' })).toThrow(/answer not found: nope/);
  });
});
