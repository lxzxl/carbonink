import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '@main/db/migrate';
import { ActivityDataService } from '@main/services/activity-data-service';
import { CalculationService } from '@main/services/calculation-service';
import { DocumentService } from '@main/services/document-service';
import { EfService } from '@main/services/ef-service';
import { EmissionSourceService } from '@main/services/emission-source-service';
import { EvidenceService } from '@main/services/evidence-service';
import { OrganizationService } from '@main/services/organization-service';
import { UnitConversionService } from '@main/services/unit-conversion-service';
import type { ActivityData, AuditEvent } from '@shared/types';
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

const PDF_BYTES = Buffer.from('%PDF-1.4 fake evidence bill');
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

let db: Database.Database;
let uploadsDir: string;
let documentService: DocumentService;
let evidence: EvidenceService;
let activity: ActivityData;
let answerId: string;

function auditEvents(kind: string): Array<AuditEvent & { parsed: Record<string, unknown> }> {
  const rows = db
    .prepare(`SELECT * FROM audit_event WHERE event_kind = ? ORDER BY occurred_at, id`)
    .all(kind) as AuditEvent[];
  return rows.map((r) => ({ ...r, parsed: JSON.parse(r.payload) as Record<string, unknown> }));
}

/** Minimal outbound answer chain via raw SQL (customer → questionnaire → question → answer). */
function seedAnswer(): string {
  db.prepare(`INSERT INTO customer (id, name) VALUES ('cust-1', 'Client A')`).run();
  db.prepare(
    `INSERT INTO questionnaire (id, customer_id, reporting_year, status, created_at)
     VALUES ('qn-1', 'cust-1', 2024, 'answering', ?)`,
  ).run(FIXED_NOW);
  db.prepare(
    `INSERT INTO question (id, questionnaire_id, question_signature, signature_version,
                           normalized_text, raw_text, question_kind, position)
     VALUES ('q-1', 'qn-1', 'sig-1', 'v1', 'total electricity?', 'Total electricity (kWh)?', 'numerical', '1')`,
  ).run();
  db.prepare(
    `INSERT INTO answer (id, question_id, value, source_kind) VALUES ('ans-1', 'q-1', '1000', 'manual')`,
  ).run();
  return 'ans-1';
}

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  const ctx = { db, now: () => FIXED_NOW };

  uploadsDir = mkdtempSync(join(tmpdir(), 'carbonink-evidence-test-'));
  documentService = new DocumentService({ ...ctx, uploadsDir });
  evidence = new EvidenceService({ ...ctx, documentService });

  const unitConv = new UnitConversionService({ db });
  const efService = new EfService(ctx);
  const orgService = new OrganizationService(ctx);
  const sourceService = new EmissionSourceService(ctx);
  const activityService = new ActivityDataService({
    ...ctx,
    efService,
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
  const period = orgService.createReportingPeriod({
    organization_id: org.id,
    year: 2024,
    granularity: 'annual',
  });
  const source = sourceService.create({
    site_id: site.id,
    name: 'Grid meter',
    scope: 2,
    category: 'electricity.grid',
  });
  activity = activityService.create({
    emission_source_id: source.id,
    reporting_period_id: period.id,
    occurred_at_start: '2024-01-01',
    occurred_at_end: '2024-01-31',
    amount: 1000,
    unit: 'kWh',
    ...CN_NATIONAL,
  });
  answerId = seedAnswer();
});

afterEach(() => {
  db.close();
  rmSync(uploadsDir, { recursive: true, force: true });
});

describe('EvidenceService.add', () => {
  it('attaches a PDF to an activity row and audits it (ids only, no note text)', () => {
    const row = evidence.add({
      target: { activity_data_id: activity.id },
      file: { filename: '电费单.pdf', mimeType: 'application/pdf', bytes: PDF_BYTES },
      note: '2024-01 电费原件',
    });

    expect(row.activity_data_id).toBe(activity.id);
    expect(row.answer_id).toBeNull();
    expect(row.filename).toBe('电费单.pdf');
    expect(row.mime_type).toBe('application/pdf');
    expect(row.size_bytes).toBe(PDF_BYTES.length);
    expect(row.note).toBe('2024-01 电费原件');
    expect(row.created_at).toBe(FIXED_NOW);

    // Backing document is tagged 'evidence' and the file is on disk.
    const doc = documentService.getById(row.document_id);
    expect(doc?.doc_type).toBe('evidence');
    expect(doc && existsSync(doc.storage_path)).toBe(true);

    // Audit event: kind + ids/hashes, never the note's free text.
    const events = auditEvents('evidence.attached');
    expect(events).toHaveLength(1);
    expect(events[0]!.parsed).toMatchObject({
      attachment_id: row.id,
      activity_id: activity.id,
      document_id: row.document_id,
      sha256: row.sha256,
      mime_type: 'application/pdf',
    });
    expect(events[0]!.payload).not.toContain('电费原件');
  });

  it('attaches a PNG to an answer', () => {
    const row = evidence.add({
      target: { answer_id: answerId },
      file: { filename: 'meter.png', mimeType: 'image/png', bytes: PNG_BYTES },
    });
    expect(row.answer_id).toBe(answerId);
    expect(row.activity_data_id).toBeNull();
    expect(evidence.list({ answer_id: answerId })).toHaveLength(1);
    expect(auditEvents('evidence.attached')[0]!.parsed).toMatchObject({ answer_id: answerId });
  });

  it('rejects an unknown target with a friendly message', () => {
    expect(() =>
      evidence.add({
        target: { activity_data_id: 'nope' },
        file: { filename: 'x.pdf', mimeType: 'application/pdf', bytes: PDF_BYTES },
      }),
    ).toThrow(/activity_data not found: nope/);
    expect(() =>
      evidence.add({
        target: { answer_id: 'nope' },
        file: { filename: 'x.pdf', mimeType: 'application/pdf', bytes: PDF_BYTES },
      }),
    ).toThrow(/answer not found: nope/);
  });

  it('rejects mime types outside the evidence allowlist', () => {
    expect(() =>
      evidence.add({
        target: { activity_data_id: activity.id },
        file: { filename: 'x.txt', mimeType: 'text/plain', bytes: PDF_BYTES },
      }),
    ).toThrow(/Unsupported mimeType: text\/plain/);
  });

  it('rejects files over the 50MB evidence cap', () => {
    const huge = Buffer.alloc(50 * 1024 * 1024 + 1);
    expect(() =>
      evidence.add({
        target: { activity_data_id: activity.id },
        file: { filename: 'huge.pdf', mimeType: 'application/pdf', bytes: huge },
      }),
    ).toThrow(/too large/);
  });

  it('dedupes identical bytes across attachments (one document, two links)', () => {
    const a = evidence.add({
      target: { activity_data_id: activity.id },
      file: { filename: 'bill.pdf', mimeType: 'application/pdf', bytes: PDF_BYTES },
    });
    const b = evidence.add({
      target: { answer_id: answerId },
      file: { filename: 'bill-copy.pdf', mimeType: 'application/pdf', bytes: PDF_BYTES },
    });
    expect(a.document_id).toBe(b.document_id);
    expect(a.id).not.toBe(b.id);
    const docCount = db
      .prepare(`SELECT COUNT(*) AS c FROM document WHERE sha256 = ?`)
      .get(a.sha256) as { c: number };
    expect(docCount.c).toBe(1);
  });
});

describe('EvidenceService.remove', () => {
  it('removes the link, keeps the document, audits, and is idempotent', () => {
    const row = evidence.add({
      target: { activity_data_id: activity.id },
      file: { filename: 'bill.pdf', mimeType: 'application/pdf', bytes: PDF_BYTES },
    });

    evidence.remove(row.id);
    expect(evidence.list({ activity_data_id: activity.id })).toHaveLength(0);
    expect(documentService.getById(row.document_id)).not.toBeNull();

    const events = auditEvents('evidence.removed');
    expect(events).toHaveLength(1);
    expect(events[0]!.parsed).toMatchObject({
      attachment_id: row.id,
      activity_id: activity.id,
      document_id: row.document_id,
    });

    // Second remove: silent no-op, no extra audit row.
    evidence.remove(row.id);
    expect(auditEvents('evidence.removed')).toHaveLength(1);
  });
});

describe('evidence ↔ documents workspace isolation', () => {
  it('listAll hides evidence docs; extraction re-upload of the same bytes un-hides them', () => {
    const before = documentService.listAll().length;
    const row = evidence.add({
      target: { activity_data_id: activity.id },
      file: { filename: 'bill.pdf', mimeType: 'application/pdf', bytes: PDF_BYTES },
    });
    expect(documentService.listAll().length).toBe(before);

    // Same bytes uploaded through the extraction entry point: doc_type is
    // cleared so the doc re-enters the /documents workspace; the evidence
    // link keeps working (it keys on document_id, not doc_type).
    const doc = documentService.uploadFile({
      filename: 'bill.pdf',
      mimeType: 'application/pdf',
      bytes: PDF_BYTES,
    });
    expect(doc.id).toBe(row.document_id);
    expect(doc.doc_type).toBeNull();
    expect(documentService.listAll().length).toBe(before + 1);
    expect(evidence.list({ activity_data_id: activity.id })).toHaveLength(1);
  });
});
