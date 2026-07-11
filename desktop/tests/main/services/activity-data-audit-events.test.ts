import { runMigrations } from '@main/db/migrate';
import { ActivityDataService } from '@main/services/activity-data-service';
import { CalculationService } from '@main/services/calculation-service';
import { EfService } from '@main/services/ef-service';
import { EmissionSourceService } from '@main/services/emission-source-service';
import { OrganizationService } from '@main/services/organization-service';
import { UnitConversionService } from '@main/services/unit-conversion-service';
import type { AuditEvent, EmissionSource, ReportingPeriod } from '@shared/types';
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

/**
 * Audit-trail coverage for ActivityDataService.create/delete (audit-readiness
 * spec 2026-07-11): every create/delete leaves an `activity_data.created` /
 * `.deleted` event whose payload carries ids + numbers but never the row's
 * free-text `notes`; delete also sweeps evidence_attachment links.
 */
describe('ActivityDataService audit events', () => {
  let db: Database.Database;
  let svc: ActivityDataService;
  let period: ReportingPeriod;
  let source: EmissionSource;

  function events(kind: string): Array<{ parsed: Record<string, unknown>; raw: string }> {
    return (
      db
        .prepare(`SELECT * FROM audit_event WHERE event_kind = ? ORDER BY occurred_at, id`)
        .all(kind) as AuditEvent[]
    ).map((r) => ({ parsed: JSON.parse(r.payload) as Record<string, unknown>, raw: r.payload }));
  }

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    const ctx = { db, now: () => FIXED_NOW };
    const unitConv = new UnitConversionService({ db });
    const orgService = new OrganizationService(ctx);
    const sourceService = new EmissionSourceService(ctx);
    svc = new ActivityDataService({
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
    source = sourceService.create({
      site_id: site.id,
      name: 'Grid meter',
      scope: 2,
      category: 'electricity.grid',
    });
  });

  afterEach(() => db.close());

  it('create writes activity_data.created with manual provenance and no notes text', () => {
    const row = svc.create({
      emission_source_id: source.id,
      reporting_period_id: period.id,
      occurred_at_start: '2024-01-01',
      occurred_at_end: '2024-01-31',
      amount: 1000,
      unit: 'kWh',
      notes: '内部台账第 3 页',
      ...CN_NATIONAL,
    });

    const created = events('activity_data.created');
    expect(created).toHaveLength(1);
    expect(created[0]!.parsed).toMatchObject({
      activity_id: row.id,
      emission_source_id: source.id,
      reporting_period_id: period.id,
      amount: 1000,
      unit: 'kWh',
      computed_co2e_kg: row.computed_co2e_kg,
      provenance: 'manual',
      extraction_id: null,
      ef: { factor_code: CN_NATIONAL.ef_factor_code },
    });
    expect(created[0]!.raw).not.toContain('内部台账');
  });

  it('a failed create leaves no audit event behind (single-tx rollback)', () => {
    expect(() =>
      svc.create({
        emission_source_id: 'missing-source',
        reporting_period_id: period.id,
        occurred_at_start: '2024-01-01',
        occurred_at_end: '2024-01-31',
        amount: 1,
        unit: 'kWh',
        ...CN_NATIONAL,
      }),
    ).toThrow(/emission_source not found/);
    expect(events('activity_data.created')).toHaveLength(0);
  });

  it('delete writes activity_data.deleted and sweeps evidence links (documents stay)', () => {
    const row = svc.create({
      emission_source_id: source.id,
      reporting_period_id: period.id,
      occurred_at_start: '2024-01-01',
      occurred_at_end: '2024-01-31',
      amount: 1000,
      unit: 'kWh',
      ...CN_NATIONAL,
    });
    // Evidence link via raw rows (the full upload path is covered in
    // evidence-service.test.ts; here only the FK sweep matters).
    db.prepare(
      `INSERT INTO document (id, sha256, filename, mime_type, size_bytes, storage_path, uploaded_at, doc_type)
       VALUES ('doc-1', 'sha-1', 'bill.pdf', 'application/pdf', 10, '/tmp/x', ?, 'evidence')`,
    ).run(FIXED_NOW);
    db.prepare(
      `INSERT INTO evidence_attachment (id, activity_data_id, document_id, created_at)
       VALUES ('ev-1', ?, 'doc-1', ?)`,
    ).run(row.id, FIXED_NOW);

    svc.delete(row.id);

    expect(svc.getById(row.id)).toBeNull();
    const links = db.prepare(`SELECT COUNT(*) AS c FROM evidence_attachment`).get() as {
      c: number;
    };
    expect(links.c).toBe(0);
    const docs = db.prepare(`SELECT COUNT(*) AS c FROM document`).get() as { c: number };
    expect(docs.c).toBe(1);

    const deleted = events('activity_data.deleted');
    expect(deleted).toHaveLength(1);
    expect(deleted[0]!.parsed).toMatchObject({
      activity_id: row.id,
      amount: 1000,
      unit: 'kWh',
      evidence_removed_count: 1,
    });
  });

  it('deleting an unknown id stays a silent no-op with no audit event', () => {
    svc.delete('nope');
    expect(events('activity_data.deleted')).toHaveLength(0);
  });
});
