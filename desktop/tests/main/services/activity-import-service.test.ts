import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '@main/db/migrate';
import { ActivityDataService } from '@main/services/activity-data-service';
import { ActivityImportService } from '@main/services/activity-import-service';
import { CalculationService } from '@main/services/calculation-service';
import { DocumentService } from '@main/services/document-service';
import { EfService } from '@main/services/ef-service';
import { EmissionSourceService } from '@main/services/emission-source-service';
import { OrganizationService } from '@main/services/organization-service';
import { UnitConversionService } from '@main/services/unit-conversion-service';
import type {
  ActivityImportEfChoice,
  AuditEvent,
  EmissionSource,
  Organization,
  ReportingPeriod,
  Site,
} from '@shared/types';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const FIXED_NOW = '2026-07-21T00:00:00.000Z';

const GRID_EF: ActivityImportEfChoice = {
  factor_code: 'electricity.grid.cn.national.2024',
  year: 2024,
  source: 'MEE_China',
  geography: 'CN',
  dataset_version: '2024.q4',
};

const GASOLINE_EF: ActivityImportEfChoice = {
  factor_code: 'fuel.gasoline.combustion.global.2024',
  year: 2024,
  source: 'IPCC_AR6',
  geography: 'GLOBAL',
  dataset_version: '2024.v1',
};

const CSV = [
  '排放源,描述,数量,单位,开始日期,结束日期,备注',
  'Grid meter,电网电力,1000,kWh,2024-01-01,2024-01-31,一月',
  'Grid meter,电网电力,1200,kWh,2024-02-01,2024-02-29,二月',
  '新锅炉,汽油 叉车,50,L,2024-03-01,2024-03-31,',
  'Grid meter,电网电力,,kWh,,,', // amount_missing → error row
].join('\n');

let db: Database.Database;
let uploadsDir: string;
let svc: ActivityImportService;
/** Injected per-workspace outlier multiplier; tests may reassign before import. */
let importOutlierRatio = 10;
let sourceService: EmissionSourceService;
let org: Organization;
let site: Site;
let period: ReportingPeriod;
let gridSource: EmissionSource;

function auditEvents(kind: string): Array<Record<string, unknown>> {
  const rows = db
    .prepare('SELECT * FROM audit_event WHERE event_kind = ? ORDER BY occurred_at, id')
    .all(kind) as AuditEvent[];
  return rows.map((r) => JSON.parse(r.payload) as Record<string, unknown>);
}

beforeEach(() => {
  importOutlierRatio = 10;
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  const ctx = { db, now: () => FIXED_NOW };
  uploadsDir = mkdtempSync(join(tmpdir(), 'carbonink-activity-import-test-'));

  const unitConv = new UnitConversionService({ db });
  const efService = new EfService(ctx);
  const calcService = new CalculationService({ unitConversion: unitConv });
  const orgService = new OrganizationService(ctx);
  sourceService = new EmissionSourceService(ctx);
  const documentService = new DocumentService({ ...ctx, uploadsDir });
  const activityDataService = new ActivityDataService({
    ...ctx,
    efService,
    calculationService: calcService,
    unitConversionService: unitConv,
  });
  svc = new ActivityImportService({
    ...ctx,
    documentService,
    activityDataService,
    efService,
    unitConversionService: unitConv,
    emissionSourceService: sourceService,
    settingsService: { getImportOutlierRatio: () => importOutlierRatio },
  });

  org = orgService.createOrganization({
    name_en: 'Acme Co',
    country_code: 'CN',
    boundary_kind: 'operational_control',
  });
  site = orgService.createSite({ organization_id: org.id, name_en: 'HQ', country_code: 'CN' });
  period = orgService.createReportingPeriod({
    organization_id: org.id,
    year: 2024,
    granularity: 'annual',
  });
  gridSource = sourceService.create({
    site_id: site.id,
    name: 'Grid meter',
    scope: 2,
    category: 'electricity.grid',
  });
});

afterEach(() => {
  db.close();
  rmSync(uploadsDir, { recursive: true, force: true });
});

/** stage → revalidate → resolve 新锅炉 → return {token, groups}. */
async function stageAndResolve(csv = CSV) {
  const preview = await svc.stageImport(Buffer.from(csv, 'utf-8'), 'ledger.csv');
  svc.revalidate(preview.token, preview.mapping, period.id);
  const sources = svc.listSources(preview.token, org.id);
  const boiler = sourceService.create({
    site_id: site.id,
    name: '新锅炉',
    scope: 1,
    category: 'fuel.stationary',
  });
  svc.resolveSource(preview.token, '新锅炉', boiler.id);
  const groups = svc.listGroups(preview.token);
  return { token: preview.token, preview, sources, groups: groups ?? [], boiler };
}

describe('stage + revalidate + sources', () => {
  it('auto-detects zh headers and separates error rows', async () => {
    const preview = await svc.stageImport(Buffer.from(CSV, 'utf-8'), 'ledger.csv');
    expect(preview.mapping).toMatchObject({
      source_name: 0,
      description: 1,
      amount: 2,
      unit: 3,
      occurred_at_start: 4,
      occurred_at_end: 5,
      notes: 6,
    });
    expect(preview.validation.valid_count).toBe(3);
    expect(preview.validation.errors).toEqual([{ row: 5, code: 'amount_missing' }]);
  });

  it('auto-matches existing source names and leaves unknown ones unresolved', async () => {
    const preview = await svc.stageImport(Buffer.from(CSV, 'utf-8'), 'ledger.csv');
    svc.revalidate(preview.token, preview.mapping, period.id);
    const sources = svc.listSources(preview.token, org.id) ?? [];
    expect(sources).toHaveLength(2);
    expect(sources[0]).toMatchObject({
      name: 'Grid meter',
      row_count: 2,
      matched_source_id: gridSource.id,
      resolved_source_id: gridSource.id,
    });
    expect(sources[1]).toMatchObject({
      name: '新锅炉',
      matched_source_id: null,
      resolved_source_id: null,
    });
  });
});

describe('groups + confirm', () => {
  it('builds one group per (description, unit, source) with totals', async () => {
    const { groups } = await stageAndResolve();
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({
      description: '电网电力',
      unit: 'kWh',
      source_name: 'Grid meter',
      row_count: 2,
      amount_total: 2200,
      status: 'pending',
    });
    expect(groups[1]).toMatchObject({ description: '汽油 叉车', unit: 'L', row_count: 1 });
  });

  it('refuses a cross-family EF without fuel binding', async () => {
    const { token, groups } = await stageAndResolve();
    const grid = groups[0] as { key: string };
    const refused = svc.confirmGroup(token, grid.key, GASOLINE_EF, null);
    expect(refused).toEqual({ ok: false, error: 'DimensionMismatch' });
    const accepted = svc.confirmGroup(token, grid.key, GRID_EF, null);
    expect(accepted).toEqual({ ok: true });
  });

  it('rejects unknown EF PKs and unknown groups', async () => {
    const { token, groups } = await stageAndResolve();
    const grid = groups[0] as { key: string };
    expect(svc.confirmGroup(token, grid.key, { ...GRID_EF, factor_code: 'nope' }, null)).toEqual({
      ok: false,
      error: 'EfNotFound',
    });
    expect(svc.confirmGroup(token, 'missing-key', GRID_EF, null)).toEqual({
      ok: false,
      error: 'GroupNotFound',
    });
  });
});

describe('import', () => {
  it('blocks while any group is still pending', async () => {
    const { token, groups } = await stageAndResolve();
    svc.confirmGroup(token, (groups[0] as { key: string }).key, GRID_EF, null);
    expect(svc.import(token)).toEqual({ ok: false, error: { _tag: 'UnconfirmedGroups' } });
  });

  it('creates rows, archives the ledger, links evidence, writes the bulk audit event', async () => {
    const { token, groups } = await stageAndResolve();
    svc.confirmGroup(token, (groups[0] as { key: string }).key, GRID_EF, null);
    svc.confirmGroup(token, (groups[1] as { key: string }).key, GASOLINE_EF, null);

    const result = svc.import(token);
    expect(result).toMatchObject({
      ok: true,
      imported_count: 3,
      skipped: { validation_errors: 1, unresolved_sources: 0, skipped_groups: 0 },
    });
    if (!result.ok) throw new Error('unreachable');

    const rows = db
      .prepare('SELECT * FROM activity_data ORDER BY occurred_at_start')
      .all() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      emission_source_id: gridSource.id,
      reporting_period_id: period.id,
      occurred_at_start: '2024-01-01',
      amount: 1000,
      unit: 'kWh',
      ef_factor_code: GRID_EF.factor_code,
      notes: '一月',
    });
    expect(rows[0]?.computed_co2e_kg).toBeCloseTo(570.3, 4);

    const doc = db.prepare('SELECT * FROM document WHERE id = ?').get(result.document_id) as Record<
      string,
      unknown
    >;
    expect(doc.doc_type).toBe('activity_import');
    expect(doc.filename).toBe('ledger.csv');

    const evidence = db
      .prepare('SELECT * FROM evidence_attachment WHERE document_id = ?')
      .all(result.document_id) as Array<Record<string, unknown>>;
    expect(evidence).toHaveLength(3);
    expect(new Set(evidence.map((e) => e.activity_data_id))).toEqual(
      new Set(rows.map((r) => r.id)),
    );

    const [bulk] = auditEvents('activity_data.bulk_imported');
    expect(bulk).toMatchObject({
      document_id: result.document_id,
      reporting_period_id: period.id,
      imported_count: 3,
      validation_error_count: 1,
      source_count: 2,
      group_count: 2,
    });
    // Per-row creation events still fire (lineage timeline needs them).
    expect(auditEvents('activity_data.created')).toHaveLength(3);
  });

  it('skipping a group excludes its rows and counts them', async () => {
    const { token, groups } = await stageAndResolve();
    svc.confirmGroup(token, (groups[0] as { key: string }).key, GRID_EF, null);
    svc.skipGroup(token, (groups[1] as { key: string }).key);
    const result = svc.import(token);
    expect(result).toMatchObject({
      ok: true,
      imported_count: 2,
      skipped: { validation_errors: 1, unresolved_sources: 0, skipped_groups: 1 },
    });
  });

  it('leaves unresolved-source rows out and counts them', async () => {
    const preview = await svc.stageImport(Buffer.from(CSV, 'utf-8'), 'ledger.csv');
    svc.revalidate(preview.token, preview.mapping, period.id);
    svc.listSources(preview.token, org.id);
    const groups = svc.listGroups(preview.token) ?? [];
    expect(groups).toHaveLength(1); // only the auto-matched Grid meter group
    svc.confirmGroup(preview.token, (groups[0] as { key: string }).key, GRID_EF, null);
    const result = svc.import(preview.token);
    expect(result).toMatchObject({
      ok: true,
      imported_count: 2,
      skipped: { validation_errors: 1, unresolved_sources: 1, skipped_groups: 0 },
    });
  });

  it('warns duplicate_in_db on a re-import of the same ledger', async () => {
    const first = await stageAndResolve();
    svc.confirmGroup(first.token, (first.groups[0] as { key: string }).key, GRID_EF, null);
    svc.confirmGroup(first.token, (first.groups[1] as { key: string }).key, GASOLINE_EF, null);
    expect(svc.import(first.token)).toMatchObject({ ok: true });

    const second = await svc.stageImport(Buffer.from(CSV, 'utf-8'), 'ledger.csv');
    svc.revalidate(second.token, second.mapping, period.id);
    svc.listSources(second.token, org.id);
    svc.resolveSource(
      second.token,
      '新锅炉',
      (sourceService.listByOrganization(org.id).find((s) => s.name === '新锅炉') as EmissionSource)
        .id,
    );
    const groups = svc.listGroups(second.token) ?? [];
    for (const g of groups) {
      svc.confirmGroup(
        second.token,
        (g as { key: string }).key,
        (g as { unit: string }).unit === 'kWh' ? GRID_EF : GASOLINE_EF,
        null,
      );
    }
    const result = svc.import(second.token);
    expect(result).toMatchObject({ ok: true, imported_count: 3 });
    if (!result.ok) throw new Error('unreachable');
    const dupWarnings = result.warnings.filter((w) => w.code === 'duplicate_in_db');
    expect(dupWarnings).toHaveLength(3);
  });

  it('reports amount outliers in the result warnings', async () => {
    const csv = [
      '排放源,描述,数量,单位',
      ...[100, 110, 90, 105, 95].map((n) => `Grid meter,电网电力,${n},kWh`),
      'Grid meter,电网电力,99999,kWh',
    ].join('\n');
    const preview = await svc.stageImport(Buffer.from(csv, 'utf-8'), 'ledger.csv');
    svc.revalidate(preview.token, preview.mapping, period.id);
    svc.listSources(preview.token, org.id);
    const groups = svc.listGroups(preview.token) ?? [];
    svc.confirmGroup(preview.token, (groups[0] as { key: string }).key, GRID_EF, null);
    const result = svc.import(preview.token);
    expect(result).toMatchObject({ ok: true, imported_count: 6 });
    if (!result.ok) throw new Error('unreachable');
    expect(result.warnings.filter((w) => w.code === 'amount_outlier')).toEqual([
      { row: 7, code: 'amount_outlier', detail: expect.stringContaining('99999') },
    ]);
  });

  it('honors the per-workspace outlier multiplier from settings (spec 2026-07-23)', async () => {
    // 400 is 4× the median (100): invisible at the default 10×, flagged
    // once the workspace tightens the rule to 3×.
    importOutlierRatio = 3;
    const csv = [
      '排放源,描述,数量,单位',
      ...[100, 110, 90, 105, 95].map((n) => `Grid meter,电网电力,${n},kWh`),
      'Grid meter,电网电力,400,kWh',
    ].join('\n');
    const preview = await svc.stageImport(Buffer.from(csv, 'utf-8'), 'ledger.csv');
    svc.revalidate(preview.token, preview.mapping, period.id);
    svc.listSources(preview.token, org.id);
    const groups = svc.listGroups(preview.token) ?? [];
    svc.confirmGroup(preview.token, (groups[0] as { key: string }).key, GRID_EF, null);
    const result = svc.import(preview.token);
    expect(result).toMatchObject({ ok: true, imported_count: 6 });
    if (!result.ok) throw new Error('unreachable');
    expect(result.warnings.filter((w) => w.code === 'amount_outlier')).toEqual([
      { row: 7, code: 'amount_outlier', detail: expect.stringContaining('400') },
    ]);
  });

  it('expires the token after a successful import', async () => {
    const { token, groups } = await stageAndResolve();
    for (const g of groups) {
      svc.confirmGroup(
        token,
        (g as { key: string }).key,
        (g as { unit: string }).unit === 'kWh' ? GRID_EF : GASOLINE_EF,
        null,
      );
    }
    expect(svc.import(token)).toMatchObject({ ok: true });
    expect(svc.import(token)).toEqual({ ok: false, error: { _tag: 'TokenExpired' } });
  });
});
