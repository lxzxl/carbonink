import { runMigrations } from '@main/db/migrate';
import { CustomerService } from '@main/services/customer-service';
import {
  InboundNoQuestionsIncluded,
  InboundOrgMissing,
  InboundPeriodNotFound,
  InboundQuantityRequired,
  InboundQuestionnaireNotFound,
  InboundQuestionnaireService,
  InboundSupplierNotFound,
  InboundUnknownTemplate,
  InboundWrongDirection,
  InboundWrongStatus,
} from '@main/services/inbound-questionnaire-service';
import { CAT1_SUPPLIER_DISCLOSURE } from '@main/services/inbound-templates/index.js';
import type { InboundTemplateKind, Question, Questionnaire, Supplier } from '@shared/types';
import Database from 'better-sqlite3';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

/**
 * Seed enough rows for FK constraints: an organization, a single 2025 reporting
 * period under it, and a supplier-role counterparty. The service depends on
 * these existing in the DB at validation time.
 */
function setup() {
  const db = new Database(':memory:');
  runMigrations(db);

  const orgId = 'org-test-1';
  db.prepare(
    `INSERT INTO organization
       (id, name_zh, name_en, country_code, boundary_kind, created_at, updated_at)
     VALUES (?, '碳墨测试', 'Carbonink Test', 'CN', 'operational_control', ?, ?)`,
  ).run(orgId, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');

  const siteId = 'site-test-1';
  db.prepare(
    `INSERT INTO site
       (id, organization_id, name_zh, name_en, country_code, is_active, created_at, updated_at)
     VALUES (?, ?, '总部', 'HQ', 'CN', 1, ?, ?)`,
  ).run(siteId, orgId, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');

  const periodId = 'period-2025-1';
  db.prepare(
    `INSERT INTO reporting_period
       (id, organization_id, year, granularity, starts_at, ends_at, is_active, created_at)
     VALUES (?, ?, 2025, 'annual', '2025-01-01T00:00:00Z', '2025-12-31T23:59:59Z', 1, ?)`,
  ).run(periodId, orgId, '2026-01-01T00:00:00Z');

  const customerService = new CustomerService({ db });
  const supplier = customerService.createSupplier({ name: 'Acme Steel Co.' });

  const svc = new InboundQuestionnaireService({
    db,
    customerService,
    now: () => '2026-05-27T12:00:00.000Z',
  });

  return { db, svc, customerService, supplier, periodId, orgId, siteId };
}

const ALL_POSITIONS = CAT1_SUPPLIER_DISCLOSURE.questions.map((q) => q.position);

describe('InboundQuestionnaireService.createDraft — happy path', () => {
  it('creates the questionnaire + N question rows in one transaction', () => {
    const { db, svc, supplier, periodId } = setup();

    const { questionnaire_id, question_count } = svc.createDraft({
      supplier_id: supplier.id,
      reporting_period_id: periodId,
      template_kind: 'cat1_supplier_disclosure',
      included_question_positions: ALL_POSITIONS,
    });

    expect(questionnaire_id).toBeTruthy();
    expect(question_count).toBe(7);

    const q = db
      .prepare('SELECT * FROM questionnaire WHERE id = ?')
      .get(questionnaire_id) as Questionnaire;
    expect(q.direction).toBe('inbound');
    expect(q.status).toBe('draft');
    expect(q.document_id).toBeNull();
    expect(q.customer_id).toBe(supplier.id);
    expect(q.reporting_year).toBe(2025);
    expect(q.template_kind).toBe('cat1_supplier_disclosure');
    expect(q.due_date).toBeNull();
    expect(q.created_at).toBe('2026-05-27T12:00:00.000Z');

    const questions = db
      .prepare('SELECT * FROM question WHERE questionnaire_id = ? ORDER BY position')
      .all(questionnaire_id) as Question[];
    expect(questions).toHaveLength(7);

    // Spot-check the tier 1 numerical row carries the right shape.
    const tier1 = questions.find((qq) => qq.position === 'tier1.1');
    expect(tier1).toBeDefined();
    expect(tier1?.tier).toBe(1);
    expect(tier1?.question_kind).toBe('numerical');
    expect(tier1?.expected_unit).toBe('kgCO2e/kg');
    expect(tier1?.signature_version).toBe('v1');
    expect(tier1?.question_signature).toBe('inbound:cat1_supplier_disclosure:1.0:tier1.1');
    expect(tier1?.required).toBe(0); // tier questions are optional

    // Metadata questions are required.
    const meta1 = questions.find((qq) => qq.position === 'meta.1');
    expect(meta1?.required).toBe(1);
    expect(meta1?.tier).toBeNull();
  });

  it('respects the included_question_positions subset', () => {
    const { db, svc, supplier, periodId } = setup();

    const { question_count, questionnaire_id } = svc.createDraft({
      supplier_id: supplier.id,
      reporting_period_id: periodId,
      template_kind: 'cat1_supplier_disclosure',
      included_question_positions: ['meta.1', 'tier1.1'],
    });

    expect(question_count).toBe(2);
    const positions = (
      db
        .prepare('SELECT position FROM question WHERE questionnaire_id = ?')
        .all(questionnaire_id) as { position: string }[]
    )
      .map((r) => r.position)
      .sort();
    expect(positions).toEqual(['meta.1', 'tier1.1']);
  });

  it('ignores unknown positions in the included set (no-op rather than throw)', () => {
    const { svc, supplier, periodId } = setup();

    const { question_count } = svc.createDraft({
      supplier_id: supplier.id,
      reporting_period_id: periodId,
      template_kind: 'cat1_supplier_disclosure',
      included_question_positions: ['meta.1', 'doesnt-exist'],
    });
    expect(question_count).toBe(1);
  });

  it('two distinct drafts get distinct ids and do not cross-link questions', () => {
    const { db, svc, supplier, periodId } = setup();

    const a = svc.createDraft({
      supplier_id: supplier.id,
      reporting_period_id: periodId,
      template_kind: 'cat1_supplier_disclosure',
      included_question_positions: ['meta.1'],
    });
    const b = svc.createDraft({
      supplier_id: supplier.id,
      reporting_period_id: periodId,
      template_kind: 'cat1_supplier_disclosure',
      included_question_positions: ['meta.1', 'meta.2'],
    });
    expect(a.questionnaire_id).not.toBe(b.questionnaire_id);
    const total = db.prepare('SELECT COUNT(*) AS n FROM questionnaire').get() as { n: number };
    expect(total.n).toBe(2);
    const qbCount = db
      .prepare('SELECT COUNT(*) AS n FROM question WHERE questionnaire_id = ?')
      .get(b.questionnaire_id) as { n: number };
    expect(qbCount.n).toBe(2);
  });
});

describe('InboundQuestionnaireService.createDraft — validation errors', () => {
  it('throws InboundSupplierNotFound for an unknown supplier id', () => {
    const { svc, periodId } = setup();
    expect(() =>
      svc.createDraft({
        supplier_id: 'nonexistent-supplier',
        reporting_period_id: periodId,
        template_kind: 'cat1_supplier_disclosure',
        included_question_positions: ALL_POSITIONS,
      }),
    ).toThrow(InboundSupplierNotFound);
  });

  it('throws InboundSupplierNotFound for a customer-role row (role isolation)', () => {
    const { svc, customerService, periodId } = setup();
    // Create a customer (role='customer') and try to use its id as a supplier.
    const customer = customerService.createOrGetByName('Outbound Customer Co.');
    expect(() =>
      svc.createDraft({
        supplier_id: customer.id,
        reporting_period_id: periodId,
        template_kind: 'cat1_supplier_disclosure',
        included_question_positions: ALL_POSITIONS,
      }),
    ).toThrow(InboundSupplierNotFound);
  });

  it('throws InboundPeriodNotFound for an unknown period id', () => {
    const { svc, supplier } = setup();
    expect(() =>
      svc.createDraft({
        supplier_id: supplier.id,
        reporting_period_id: 'no-such-period',
        template_kind: 'cat1_supplier_disclosure',
        included_question_positions: ALL_POSITIONS,
      }),
    ).toThrow(InboundPeriodNotFound);
  });

  it('throws InboundUnknownTemplate for an unregistered template kind', () => {
    const { svc, supplier, periodId } = setup();
    expect(() =>
      svc.createDraft({
        supplier_id: supplier.id,
        reporting_period_id: periodId,
        // Cast simulates a future renderer passing a kind we haven't wired yet.
        template_kind: 'cat99_not_a_template' as unknown as InboundTemplateKind,
        included_question_positions: ['meta.1'],
      }),
    ).toThrow(InboundUnknownTemplate);
  });

  it('throws InboundNoQuestionsIncluded when the included set is empty', () => {
    const { svc, supplier, periodId } = setup();
    expect(() =>
      svc.createDraft({
        supplier_id: supplier.id,
        reporting_period_id: periodId,
        template_kind: 'cat1_supplier_disclosure',
        included_question_positions: [],
      }),
    ).toThrow(InboundNoQuestionsIncluded);
  });

  it('throws InboundNoQuestionsIncluded when no included position matches the template', () => {
    const { svc, supplier, periodId } = setup();
    expect(() =>
      svc.createDraft({
        supplier_id: supplier.id,
        reporting_period_id: periodId,
        template_kind: 'cat1_supplier_disclosure',
        included_question_positions: ['ghost.1', 'phantom.2'],
      }),
    ).toThrow(InboundNoQuestionsIncluded);
  });

  it('does not write any rows on a validation failure (atomic)', () => {
    const { db, svc, periodId } = setup();
    try {
      svc.createDraft({
        supplier_id: 'nonexistent-supplier',
        reporting_period_id: periodId,
        template_kind: 'cat1_supplier_disclosure',
        included_question_positions: ALL_POSITIONS,
      });
    } catch {
      /* expected */
    }
    const qCount = db.prepare('SELECT COUNT(*) AS n FROM questionnaire').get() as { n: number };
    expect(qCount.n).toBe(0);
    const questionCount = db.prepare('SELECT COUNT(*) AS n FROM question').get() as { n: number };
    expect(questionCount.n).toBe(0);
  });
});

describe('InboundQuestionnaireService.exportBlankXlsx', () => {
  it('returns a Buffer, flips status to sent, and audits the export', async () => {
    const { db, svc, supplier, periodId } = setup();
    const { questionnaire_id } = svc.createDraft({
      supplier_id: supplier.id,
      reporting_period_id: periodId,
      template_kind: 'cat1_supplier_disclosure',
      included_question_positions: CAT1_SUPPLIER_DISCLOSURE.questions.map((q) => q.position),
    });

    const buf = await svc.exportBlankXlsx(questionnaire_id);
    // The return type is `Buffer` but at runtime ExcelJS sometimes hands
    // back a `Buffer<ArrayBufferLike>` whose narrowing isn't useful for
    // tests — assert the byte-shape property we actually care about.
    expect(buf.length).toBeGreaterThan(1000);

    const qRow = db
      .prepare('SELECT status FROM questionnaire WHERE id = ?')
      .get(questionnaire_id) as { status: string };
    expect(qRow.status).toBe('sent');

    const audit = db
      .prepare(
        "SELECT payload FROM audit_event WHERE event_kind = 'inbound_questionnaire.exported'",
      )
      .all() as Array<{ payload: string }>;
    expect(audit).toHaveLength(1);
    const payload = JSON.parse(audit[0]?.payload ?? '{}');
    expect(payload.questionnaire_id).toBe(questionnaire_id);
    expect(payload.supplier_id).toBe(supplier.id);
    expect(payload.template_kind).toBe('cat1_supplier_disclosure');
    expect(payload.question_count).toBe(7);
    expect(payload.period_year).toBe(2025);
  });

  it('re-export from status=sent returns a fresh Buffer but does NOT re-audit', async () => {
    const { db, svc, supplier, periodId } = setup();
    const { questionnaire_id } = svc.createDraft({
      supplier_id: supplier.id,
      reporting_period_id: periodId,
      template_kind: 'cat1_supplier_disclosure',
      included_question_positions: ['meta.1', 'tier2.1'],
    });

    await svc.exportBlankXlsx(questionnaire_id);
    await svc.exportBlankXlsx(questionnaire_id); // second export

    const audit = db
      .prepare(
        "SELECT COUNT(*) AS n FROM audit_event WHERE event_kind = 'inbound_questionnaire.exported'",
      )
      .get() as { n: number };
    expect(audit.n).toBe(1);

    const qRow = db
      .prepare('SELECT status FROM questionnaire WHERE id = ?')
      .get(questionnaire_id) as { status: string };
    expect(qRow.status).toBe('sent');
  });

  it('honors includedPositions — partial-subset draft yields a workbook without the unselected sheets', async () => {
    const { svc, supplier, periodId } = setup();
    const { questionnaire_id } = svc.createDraft({
      supplier_id: supplier.id,
      reporting_period_id: periodId,
      template_kind: 'cat1_supplier_disclosure',
      included_question_positions: ['meta.1', 'tier1.1'], // no tier2
    });
    const buf = await svc.exportBlankXlsx(questionnaire_id);
    // We don't crack the workbook open here — the renderer's own tests
    // cover that. Just confirm the buffer materializes without errors.
    expect(buf.length).toBeGreaterThan(1000);
  });

  it('throws InboundQuestionnaireNotFound for an unknown id', async () => {
    const { svc } = setup();
    await expect(svc.exportBlankXlsx('no-such-questionnaire')).rejects.toThrow(
      InboundQuestionnaireNotFound,
    );
  });

  it('throws InboundWrongDirection when called on an outbound questionnaire', async () => {
    const { db, svc, customerService } = setup();
    // Manually create an outbound row.
    const customer = customerService.createOrGetByName('Outbound Customer');
    const qid = 'outbound-qn-1';
    db.prepare(
      `INSERT INTO questionnaire
         (id, customer_id, document_id, template_kind, reporting_year, status, direction, due_date, created_at)
       VALUES (?, ?, NULL, NULL, 2025, 'parsing', 'outbound', NULL, '2026-05-27T00:00:00.000Z')`,
    ).run(qid, customer.id);

    await expect(svc.exportBlankXlsx(qid)).rejects.toThrow(InboundWrongDirection);
  });

  it('throws InboundWrongStatus when the questionnaire is already ingested', async () => {
    const { db, svc, supplier, periodId } = setup();
    const { questionnaire_id } = svc.createDraft({
      supplier_id: supplier.id,
      reporting_period_id: periodId,
      template_kind: 'cat1_supplier_disclosure',
      included_question_positions: ['meta.1'],
    });
    // Fast-forward past the legal states.
    db.prepare(`UPDATE questionnaire SET status = 'ingested' WHERE id = ?`).run(questionnaire_id);
    await expect(svc.exportBlankXlsx(questionnaire_id)).rejects.toThrow(InboundWrongStatus);
  });

  it('throws InboundOrgMissing when no organization row exists', async () => {
    // Bespoke setup without the org row — bypass shared setup().
    const db = new Database(':memory:');
    runMigrations(db);

    const periodOrgId = 'org-orphan';
    // Inserting period requires a non-deleted org FK, but we want a state
    // where the period exists yet org is later deleted. Simulating:
    // create both, then delete org. Easier: just skip org creation here
    // and create supplier/period with FK off temporarily.
    db.pragma('foreign_keys = OFF');
    db.prepare(
      `INSERT INTO reporting_period (id, organization_id, year, granularity, starts_at, ends_at, is_active, created_at)
       VALUES ('orphan-period', ?, 2025, 'annual', '2025-01-01T00:00:00Z', '2025-12-31T23:59:59Z', 1, '2026-01-01T00:00:00Z')`,
    ).run(periodOrgId);
    db.pragma('foreign_keys = ON');
    const customerService = new CustomerService({ db });
    const supplier = customerService.createSupplier({ name: 'X' });

    const svc = new InboundQuestionnaireService({ db, customerService });
    const { questionnaire_id } = svc.createDraft({
      supplier_id: supplier.id,
      reporting_period_id: 'orphan-period',
      template_kind: 'cat1_supplier_disclosure',
      included_question_positions: ['meta.1'],
    });

    await expect(svc.exportBlankXlsx(questionnaire_id)).rejects.toThrow(InboundOrgMissing);
  });
});

/**
 * Render → simulate supplier fills → return Buffer ready for import.
 */
async function fillBlankXlsx(
  blank: Buffer,
  fills: Record<string, string | number>,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  // biome-ignore lint/suspicious/noExplicitAny: Buffer boundary cast.
  await wb.xlsx.load(blank as any);
  for (const [cellRef, value] of Object.entries(fills)) {
    const [sheetName, address] = cellRef.split('!');
    if (!sheetName || !address) continue;
    const sheet = wb.getWorksheet(sheetName);
    if (!sheet) continue;
    sheet.getCell(address).value = value;
  }
  const out = await wb.xlsx.writeBuffer();
  // biome-ignore lint/suspicious/noExplicitAny: Buffer boundary cast.
  return out as any as Buffer;
}

/** Create draft + export blank in one go — common preamble for import tests. */
async function createDraftAndExport(
  svc: InboundQuestionnaireService,
  supplier: Supplier,
  periodId: string,
  positions: readonly string[] = CAT1_SUPPLIER_DISCLOSURE.questions.map((q) => q.position),
): Promise<{ questionnaireId: string; blank: Buffer }> {
  const { questionnaire_id } = svc.createDraft({
    supplier_id: supplier.id,
    reporting_period_id: periodId,
    template_kind: 'cat1_supplier_disclosure',
    included_question_positions: positions,
  });
  const blank = await svc.exportBlankXlsx(questionnaire_id);
  return { questionnaireId: questionnaire_id, blank };
}

describe('InboundQuestionnaireService.importFilledXlsx — happy paths', () => {
  it('Tier 2 path: all three trio cells filled → tier_selected=2, proposed_activity on tier2.3', async () => {
    const { svc, supplier, periodId } = setup();
    const { questionnaireId, blank } = await createDraftAndExport(svc, supplier, periodId);
    const filled = await fillBlankXlsx(blank, {
      'metadata!B5': 'Acme Steel Co.',
      'metadata!B7': '2025 calendar year',
      'metadata!B9': 'self-reported',
      'tier2!B5': 850000,
      'tier2!B7': 'mass-based',
      'tier2!B9': 12000,
    });
    const preview = await svc.importFilledXlsx(questionnaireId, filled);

    expect(preview.questionnaire_id).toBe(questionnaireId);
    expect(preview.supplier_name).toBe('Acme Steel Co.');
    expect(preview.ingestion_plan.tier_selected).toBe(2);
    expect(preview.ingestion_plan.emission_source_name).toBe(
      'Acme Steel Co. — purchased goods (2025)',
    );
    expect(preview.ingestion_plan.activity_row_count).toBe(1);
    expect(preview.ingestion_plan.total_co2e_kg).toBe(12000);

    // The tier2.3 row carries the proposed activity; others do not.
    const tier2_3 = preview.answers.find((a) => a.position === 'tier2.3');
    expect(tier2_3?.proposed_activity).toEqual({
      amount: 12000,
      unit: 'kgCO2e',
      co2e_kg: 12000,
    });
    const tier2_1 = preview.answers.find((a) => a.position === 'tier2.1');
    expect(tier2_1?.proposed_activity).toBeNull();
  });

  it('Tier 1 path: only PCF filled → tier_selected=1, no proposed_activity yet', async () => {
    const { svc, supplier, periodId } = setup();
    const { questionnaireId, blank } = await createDraftAndExport(svc, supplier, periodId);
    const filled = await fillBlankXlsx(blank, {
      'metadata!B5': 'Acme Steel Co.',
      'tier1!B5': 2.5,
    });
    const preview = await svc.importFilledXlsx(questionnaireId, filled);

    expect(preview.ingestion_plan.tier_selected).toBe(1);
    expect(preview.ingestion_plan.activity_row_count).toBe(0);
    expect(preview.ingestion_plan.total_co2e_kg).toBe(0);

    const tier1_1 = preview.answers.find((a) => a.position === 'tier1.1');
    expect(tier1_1?.parsed_value).toBe(2.5);
    expect(tier1_1?.is_blank).toBe(false);
    // PCF without quantity → no proposed activity until ingest prompts user.
    expect(tier1_1?.proposed_activity).toBeNull();
  });

  it('Tier 1 wins when both tiers are filled', async () => {
    const { svc, supplier, periodId } = setup();
    const { questionnaireId, blank } = await createDraftAndExport(svc, supplier, periodId);
    const filled = await fillBlankXlsx(blank, {
      'tier1!B5': 2.5,
      'tier2!B5': 850000,
      'tier2!B7': 'mass-based',
      'tier2!B9': 12000,
    });
    const preview = await svc.importFilledXlsx(questionnaireId, filled);
    expect(preview.ingestion_plan.tier_selected).toBe(1);
    expect(preview.ingestion_plan.total_co2e_kg).toBe(0); // tier 1 needs quantity
    // Both tiers are available → the review UI will offer a choice.
    expect(preview.ingestion_plan.available_tiers).toEqual([1, 2]);
  });

  it('blank workbook: no tier numerical filled → tier_selected=null + blank_template warning', async () => {
    const { svc, supplier, periodId } = setup();
    const { questionnaireId, blank } = await createDraftAndExport(svc, supplier, periodId);
    const filled = await fillBlankXlsx(blank, {
      'metadata!B5': 'Some Supplier',
    });
    const preview = await svc.importFilledXlsx(questionnaireId, filled);
    expect(preview.ingestion_plan.tier_selected).toBeNull();
    expect(preview.ingestion_plan.activity_row_count).toBe(0);
    expect(preview.warnings.some((w) => w.kind === 'blank_template')).toBe(true);
  });
});

describe('InboundQuestionnaireService.importFilledXlsx — DB side effects', () => {
  it('writes tentative answer rows (source_kind=manual, finalized_at=NULL)', async () => {
    const { db, svc, supplier, periodId } = setup();
    const { questionnaireId, blank } = await createDraftAndExport(svc, supplier, periodId);
    const filled = await fillBlankXlsx(blank, {
      'metadata!B5': 'Acme Steel Co.',
      'tier2!B5': 850000,
      'tier2!B7': 'mass-based',
      'tier2!B9': 12000,
    });
    await svc.importFilledXlsx(questionnaireId, filled);

    const rows = db
      .prepare(
        `SELECT q.position, a.value, a.source_kind, a.finalized_at
           FROM answer a JOIN question q ON q.id = a.question_id
          WHERE q.questionnaire_id = ?`,
      )
      .all(questionnaireId) as Array<{
      position: string;
      value: string;
      source_kind: string;
      finalized_at: string | null;
    }>;
    // 4 non-blank answers — meta.1 + tier2.1 + tier2.2 + tier2.3
    expect(rows).toHaveLength(4);
    for (const r of rows) {
      expect(r.source_kind).toBe('manual');
      expect(r.finalized_at).toBeNull();
    }
    const meta1 = rows.find((r) => r.position === 'meta.1');
    expect(meta1?.value).toBe('Acme Steel Co.');
    const tier2_3 = rows.find((r) => r.position === 'tier2.3');
    expect(tier2_3?.value).toBe('12000');
  });

  it('flips status to received and audits the import', async () => {
    const { db, svc, supplier, periodId } = setup();
    const { questionnaireId, blank } = await createDraftAndExport(svc, supplier, periodId);
    const filled = await fillBlankXlsx(blank, { 'metadata!B5': 'X' });
    await svc.importFilledXlsx(questionnaireId, filled);

    const q = db.prepare('SELECT status FROM questionnaire WHERE id = ?').get(questionnaireId) as {
      status: string;
    };
    expect(q.status).toBe('received');

    const audit = db
      .prepare(
        "SELECT payload FROM audit_event WHERE event_kind = 'inbound_questionnaire.imported'",
      )
      .all() as Array<{ payload: string }>;
    expect(audit).toHaveLength(1);
    const payload = JSON.parse(audit[0]?.payload ?? '{}');
    expect(payload.questionnaire_id).toBe(questionnaireId);
    expect(payload.is_first_import).toBe(true);
  });

  it('re-import wipes prior tentative answers + audits each event', async () => {
    const { db, svc, supplier, periodId } = setup();
    const { questionnaireId, blank } = await createDraftAndExport(svc, supplier, periodId);
    const firstFill = await fillBlankXlsx(blank, {
      'metadata!B5': 'First Name',
      'tier2!B5': 500000,
      'tier2!B7': 'mass-based',
      'tier2!B9': 8000,
    });
    await svc.importFilledXlsx(questionnaireId, firstFill);

    // Supplier sends a corrected file.
    const secondFill = await fillBlankXlsx(blank, {
      'metadata!B5': 'Corrected Name',
      'tier2!B5': 850000,
      'tier2!B7': 'economic',
      'tier2!B9': 12000,
    });
    await svc.importFilledXlsx(questionnaireId, secondFill);

    const rows = db
      .prepare(
        `SELECT q.position, a.value FROM answer a JOIN question q ON q.id = a.question_id
          WHERE q.questionnaire_id = ?`,
      )
      .all(questionnaireId) as Array<{ position: string; value: string }>;
    expect(rows).toHaveLength(4);
    const meta1 = rows.find((r) => r.position === 'meta.1');
    expect(meta1?.value).toBe('Corrected Name');
    const tier2_3 = rows.find((r) => r.position === 'tier2.3');
    expect(tier2_3?.value).toBe('12000');

    const audits = db
      .prepare(
        "SELECT payload FROM audit_event WHERE event_kind = 'inbound_questionnaire.imported' ORDER BY occurred_at ASC",
      )
      .all() as Array<{ payload: string }>;
    expect(audits).toHaveLength(2);
    expect(JSON.parse(audits[0]?.payload ?? '{}').is_first_import).toBe(true);
    expect(JSON.parse(audits[1]?.payload ?? '{}').is_first_import).toBe(false);
  });
});

describe('InboundQuestionnaireService.importFilledXlsx — validation', () => {
  it('throws InboundWrongStatus when status is draft (must export first)', async () => {
    const { svc, supplier, periodId } = setup();
    const { questionnaire_id } = svc.createDraft({
      supplier_id: supplier.id,
      reporting_period_id: periodId,
      template_kind: 'cat1_supplier_disclosure',
      included_question_positions: ['meta.1'],
    });
    // Status is still 'draft' — try to import without exporting.
    const dummy = Buffer.from('not a real xlsx');
    await expect(svc.importFilledXlsx(questionnaire_id, dummy)).rejects.toThrow(InboundWrongStatus);
  });

  it('throws InboundQuestionnaireNotFound for an unknown id', async () => {
    const { svc } = setup();
    await expect(svc.importFilledXlsx('no-such-id', Buffer.alloc(0))).rejects.toThrow(
      InboundQuestionnaireNotFound,
    );
  });
});

describe('InboundQuestionnaireService.getIngestPreview', () => {
  it('idempotently rebuilds the preview from persisted tentative answers', async () => {
    const { svc, supplier, periodId } = setup();
    const { questionnaireId, blank } = await createDraftAndExport(svc, supplier, periodId);
    const filled = await fillBlankXlsx(blank, {
      'metadata!B5': 'Acme Steel Co.',
      'tier2!B5': 850000,
      'tier2!B7': 'mass-based',
      'tier2!B9': 12000,
    });
    const importPreview = await svc.importFilledXlsx(questionnaireId, filled);
    const reopenPreview = svc.getIngestPreview(questionnaireId);

    // Tier selection + total agree across both paths.
    expect(reopenPreview.ingestion_plan.tier_selected).toBe(2);
    expect(reopenPreview.ingestion_plan.total_co2e_kg).toBe(
      importPreview.ingestion_plan.total_co2e_kg,
    );
    expect(reopenPreview.ingestion_plan.activity_row_count).toBe(1);

    // Parsed numerical values survive the DB round-trip.
    const tier2_3 = reopenPreview.answers.find((a) => a.position === 'tier2.3');
    expect(tier2_3?.parsed_value).toBe(12000);
    expect(tier2_3?.proposed_activity?.co2e_kg).toBe(12000);

    // Blank positions remain blank.
    const tier1 = reopenPreview.answers.find((a) => a.position === 'tier1.1');
    expect(tier1?.is_blank).toBe(true);
  });

  it('throws InboundWrongStatus when called on a sent (not yet imported) questionnaire', async () => {
    const { svc, supplier, periodId } = setup();
    const { questionnaireId } = await createDraftAndExport(svc, supplier, periodId);
    // Status is 'sent' — getIngestPreview requires 'received'.
    expect(() => svc.getIngestPreview(questionnaireId)).toThrow(InboundWrongStatus);
  });
});

/** Reach status='received' with a Tier 2 fill so ingest tests can run from a known state. */
async function reachReceivedTier2(
  svc: InboundQuestionnaireService,
  supplier: Supplier,
  periodId: string,
): Promise<{ questionnaireId: string; questionIds: Map<string, string> }> {
  const { questionnaireId, blank } = await createDraftAndExport(svc, supplier, periodId);
  const filled = await fillBlankXlsx(blank, {
    'metadata!B5': 'Acme Steel Co.',
    'tier2!B5': 850000,
    'tier2!B7': 'mass-based',
    'tier2!B9': 12000,
  });
  await svc.importFilledXlsx(questionnaireId, filled);
  const preview = svc.getIngestPreview(questionnaireId);
  const questionIds = new Map(preview.answers.map((a) => [a.position, a.question_id]));
  return { questionnaireId, questionIds };
}

/** Reach 'received' with BOTH tiers filled (Tier 1 PCF + the Tier 2 trio). */
async function reachReceivedBothTiers(
  svc: InboundQuestionnaireService,
  supplier: Supplier,
  periodId: string,
): Promise<{ questionnaireId: string; questionIds: Map<string, string> }> {
  const { questionnaireId, blank } = await createDraftAndExport(svc, supplier, periodId);
  const filled = await fillBlankXlsx(blank, {
    'metadata!B5': 'Acme Steel Co.',
    'tier1!B5': 2.5, // per-unit PCF
    'tier2!B5': 850000,
    'tier2!B7': 'mass-based',
    'tier2!B9': 12000,
  });
  await svc.importFilledXlsx(questionnaireId, filled);
  const preview = svc.getIngestPreview(questionnaireId);
  const questionIds = new Map(preview.answers.map((a) => [a.position, a.question_id]));
  return { questionnaireId, questionIds };
}

describe('InboundQuestionnaireService.ingest — Tier 2 happy path', () => {
  it('writes one activity_data row, finalizes accepted answers, audits, and flips status', async () => {
    const { db, svc, supplier, periodId, siteId } = setup();
    const { questionnaireId, questionIds } = await reachReceivedTier2(svc, supplier, periodId);

    const result = svc.ingest({
      questionnaire_id: questionnaireId,
      accepted_question_ids: [
        questionIds.get('meta.1') ?? '',
        questionIds.get('tier2.1') ?? '',
        questionIds.get('tier2.2') ?? '',
        questionIds.get('tier2.3') ?? '',
      ],
    });
    expect(result.activity_data_ids).toHaveLength(1);
    expect(result.emission_source_id).toBeTruthy();
    expect(result.ingested_at).toBe('2026-05-27T12:00:00.000Z');

    const ad = db
      .prepare('SELECT * FROM activity_data WHERE id = ?')
      .get(result.activity_data_ids[0]) as {
      site_id: string;
      emission_source_id: string;
      reporting_period_id: string;
      amount: number;
      unit: string;
      computed_co2e_kg: number;
      inbound_question_id: string | null;
      inbound_tier: number | null;
      ef_factor_code: string;
      ef_source: string;
    };
    expect(ad.site_id).toBe(siteId);
    expect(ad.amount).toBe(12000);
    expect(ad.unit).toBe('kgCO2e');
    expect(ad.computed_co2e_kg).toBe(12000);
    expect(ad.inbound_tier).toBe(2);
    expect(ad.inbound_question_id).toBe(questionIds.get('tier2.3'));
    expect(ad.ef_source).toBe('inbound_questionnaire');

    // Status moved to ingested.
    const q = db.prepare('SELECT status FROM questionnaire WHERE id = ?').get(questionnaireId) as {
      status: string;
    };
    expect(q.status).toBe('ingested');

    // Audit row present with the right payload shape.
    const audit = db
      .prepare(
        "SELECT payload FROM audit_event WHERE event_kind = 'inbound_questionnaire.ingested'",
      )
      .all() as Array<{ payload: string }>;
    expect(audit).toHaveLength(1);
    const payload = JSON.parse(audit[0]?.payload ?? '{}');
    expect(payload.tier_selected).toBe(2);
    expect(payload.total_co2e_kg).toBe(12000);

    // Accepted answers finalized; non-accepted (none here) would stay tentative.
    const finalized = db
      .prepare(
        `SELECT COUNT(*) AS n FROM answer a JOIN question q ON q.id = a.question_id
          WHERE q.questionnaire_id = ? AND a.finalized_at IS NOT NULL`,
      )
      .get(questionnaireId) as { n: number };
    expect(finalized.n).toBe(4);
  });

  it('creates exactly one sentinel pinned EF per (supplier × year) and reuses it', async () => {
    const { db, svc, supplier, periodId } = setup();

    // First ingest writes the sentinel.
    const r1 = await reachReceivedTier2(svc, supplier, periodId);
    svc.ingest({
      questionnaire_id: r1.questionnaireId,
      accepted_question_ids: Array.from(r1.questionIds.values()),
    });

    // Second questionnaire to the same supplier + same year — must reuse.
    const r2 = await reachReceivedTier2(svc, supplier, periodId);
    svc.ingest({
      questionnaire_id: r2.questionnaireId,
      accepted_question_ids: Array.from(r2.questionIds.values()),
    });

    const sentinels = db
      .prepare(
        `SELECT factor_code FROM pinned_emission_factor WHERE source = 'inbound_questionnaire'`,
      )
      .all() as Array<{ factor_code: string }>;
    expect(sentinels).toHaveLength(1);

    // emission_source also reused on the second ingest (same supplier × year
    // → same canonical name → find-or-create branch hits).
    const sources = db
      .prepare(`SELECT id FROM emission_source WHERE template_origin = 'inbound_questionnaire'`)
      .all() as Array<{ id: string }>;
    expect(sources).toHaveLength(1);
  });
});

describe('InboundQuestionnaireService.ingest — Tier 1 happy path', () => {
  it('multiplies PCF by purchased quantity and writes the activity row', async () => {
    const { db, svc, supplier, periodId } = setup();
    const { questionnaireId, blank } = await createDraftAndExport(svc, supplier, periodId);
    await svc.importFilledXlsx(
      questionnaireId,
      await fillBlankXlsx(blank, {
        'metadata!B5': 'Beta Chem',
        'tier1!B5': 2.5,
      }),
    );
    const preview = svc.getIngestPreview(questionnaireId);
    const tier1Qid = preview.answers.find((a) => a.position === 'tier1.1')?.question_id ?? '';

    const result = svc.ingest({
      questionnaire_id: questionnaireId,
      accepted_question_ids: [tier1Qid],
      tier1_purchased_quantity: 10000, // 10000 kg
    });
    expect(result.activity_data_ids).toHaveLength(1);

    const ad = db
      .prepare('SELECT amount, computed_co2e_kg, inbound_tier FROM activity_data WHERE id = ?')
      .get(result.activity_data_ids[0]) as {
      amount: number;
      computed_co2e_kg: number;
      inbound_tier: number;
    };
    expect(ad.amount).toBe(25000); // 2.5 kgCO2e/kg × 10000 kg
    expect(ad.computed_co2e_kg).toBe(25000);
    expect(ad.inbound_tier).toBe(1);
  });

  it('throws InboundQuantityRequired when Tier 1 is selected but quantity is missing', async () => {
    const { svc, supplier, periodId } = setup();
    const { questionnaireId, blank } = await createDraftAndExport(svc, supplier, periodId);
    await svc.importFilledXlsx(questionnaireId, await fillBlankXlsx(blank, { 'tier1!B5': 2.5 }));
    const preview = svc.getIngestPreview(questionnaireId);
    const tier1Qid = preview.answers.find((a) => a.position === 'tier1.1')?.question_id ?? '';

    expect(() =>
      svc.ingest({
        questionnaire_id: questionnaireId,
        accepted_question_ids: [tier1Qid],
        // no tier1_purchased_quantity
      }),
    ).toThrow(InboundQuantityRequired);
  });
});

describe('InboundQuestionnaireService.ingest — tier override (both tiers filled)', () => {
  it('defaults to Tier 1 when no override is given (needs quantity)', async () => {
    const { svc, supplier, periodId } = setup();
    const { questionnaireId, questionIds } = await reachReceivedBothTiers(svc, supplier, periodId);
    // No override + no quantity → Tier 1 is auto-picked and demands quantity.
    expect(() =>
      svc.ingest({
        questionnaire_id: questionnaireId,
        accepted_question_ids: Array.from(questionIds.values()),
      }),
    ).toThrow(InboundQuantityRequired);
  });

  it('honors tier_override=2 → ingests the supplier-reported total, no quantity needed', async () => {
    const { db, svc, supplier, periodId } = setup();
    const { questionnaireId, questionIds } = await reachReceivedBothTiers(svc, supplier, periodId);

    const result = svc.ingest({
      questionnaire_id: questionnaireId,
      accepted_question_ids: Array.from(questionIds.values()),
      tier_override: 2,
    });
    expect(result.activity_data_ids).toHaveLength(1);

    const ad = db
      .prepare(
        'SELECT amount, computed_co2e_kg, inbound_tier, inbound_question_id FROM activity_data WHERE id = ?',
      )
      .get(result.activity_data_ids[0]) as {
      amount: number;
      computed_co2e_kg: number;
      inbound_tier: number;
      inbound_question_id: string;
    };
    expect(ad.inbound_tier).toBe(2);
    expect(ad.amount).toBe(12000); // tier2.3 value, NOT 2.5×anything
    expect(ad.computed_co2e_kg).toBe(12000);
    expect(ad.inbound_question_id).toBe(questionIds.get('tier2.3'));
  });

  it('honors tier_override=1 with quantity → PCF × quantity even though Tier 2 was also filled', async () => {
    const { db, svc, supplier, periodId } = setup();
    const { questionnaireId, questionIds } = await reachReceivedBothTiers(svc, supplier, periodId);

    const result = svc.ingest({
      questionnaire_id: questionnaireId,
      accepted_question_ids: Array.from(questionIds.values()),
      tier_override: 1,
      tier1_purchased_quantity: 1000,
    });
    const ad = db
      .prepare('SELECT amount, inbound_tier FROM activity_data WHERE id = ?')
      .get(result.activity_data_ids[0]) as { amount: number; inbound_tier: number };
    expect(ad.inbound_tier).toBe(1);
    expect(ad.amount).toBe(2500); // 2.5 PCF × 1000 kg
  });
});

describe('InboundQuestionnaireService.ingest — idempotency + soft no-op', () => {
  it('replaying ingest on a status=ingested questionnaire returns the existing rows', async () => {
    const { db, svc, supplier, periodId } = setup();
    const { questionnaireId, questionIds } = await reachReceivedTier2(svc, supplier, periodId);
    const accepted = Array.from(questionIds.values());

    const r1 = svc.ingest({
      questionnaire_id: questionnaireId,
      accepted_question_ids: accepted,
    });
    const r2 = svc.ingest({
      questionnaire_id: questionnaireId,
      accepted_question_ids: accepted,
    });

    expect(r2.activity_data_ids).toEqual(r1.activity_data_ids);
    expect(r2.emission_source_id).toBe(r1.emission_source_id);

    // Still exactly one activity_data row for this questionnaire.
    const adCount = db
      .prepare(
        `SELECT COUNT(*) AS n FROM activity_data
          WHERE inbound_question_id IN (
            SELECT id FROM question WHERE questionnaire_id = ?
          )`,
      )
      .get(questionnaireId) as { n: number };
    expect(adCount.n).toBe(1);

    // Audit row count stays at 1 (idempotent replay doesn't re-audit).
    const auditCount = db
      .prepare(
        "SELECT COUNT(*) AS n FROM audit_event WHERE event_kind = 'inbound_questionnaire.ingested'",
      )
      .get() as { n: number };
    expect(auditCount.n).toBe(1);
  });

  it('soft no-op: accepting only metadata answers → no activity row, no status flip', async () => {
    const { db, svc, supplier, periodId } = setup();
    const { questionnaireId, questionIds } = await reachReceivedTier2(svc, supplier, periodId);

    const result = svc.ingest({
      questionnaire_id: questionnaireId,
      accepted_question_ids: [questionIds.get('meta.1') ?? ''],
    });
    expect(result.activity_data_ids).toHaveLength(0);
    expect(result.emission_source_id).toBe('');

    const q = db.prepare('SELECT status FROM questionnaire WHERE id = ?').get(questionnaireId) as {
      status: string;
    };
    expect(q.status).toBe('received'); // unchanged
  });
});

describe('InboundQuestionnaireService.ingest — validation', () => {
  it('throws InboundWrongStatus when status is draft', () => {
    const { svc, supplier, periodId } = setup();
    const { questionnaire_id } = svc.createDraft({
      supplier_id: supplier.id,
      reporting_period_id: periodId,
      template_kind: 'cat1_supplier_disclosure',
      included_question_positions: ['meta.1'],
    });
    expect(() => svc.ingest({ questionnaire_id, accepted_question_ids: [] })).toThrow(
      InboundWrongStatus,
    );
  });

  it('throws InboundQuestionnaireNotFound for unknown id', () => {
    const { svc } = setup();
    expect(() => svc.ingest({ questionnaire_id: 'nope', accepted_question_ids: [] })).toThrow(
      InboundQuestionnaireNotFound,
    );
  });
});

describe('InboundQuestionnaireService.createDraft — type narrowing', () => {
  it('returned customer_id resolves to a supplier-role row (not a customer)', () => {
    const { db, svc, customerService, supplier, periodId } = setup();
    const { questionnaire_id } = svc.createDraft({
      supplier_id: supplier.id,
      reporting_period_id: periodId,
      template_kind: 'cat1_supplier_disclosure',
      included_question_positions: ['meta.1'],
    });
    const q = db
      .prepare('SELECT customer_id FROM questionnaire WHERE id = ?')
      .get(questionnaire_id) as { customer_id: string };
    // The shared `customer` table holds the row; its role is 'supplier'.
    const row = db.prepare('SELECT * FROM customer WHERE id = ?').get(q.customer_id) as Supplier;
    expect(row.role).toBe('supplier');
    // And listSuppliers picks it up (so the wizard sees it on subsequent loads).
    const suppliers = customerService.listSuppliers();
    expect(suppliers.some((s) => s.id === supplier.id)).toBe(true);
  });
});
