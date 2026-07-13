import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '@main/db/migrate';
import { ActivityDataService } from '@main/services/activity-data-service';
import { CalculationService } from '@main/services/calculation-service';
import { DocumentService } from '@main/services/document-service';
import { EfService } from '@main/services/ef-service';
import { EmissionSourceService } from '@main/services/emission-source-service';
import { OrganizationService } from '@main/services/organization-service';
import { UnitConversionService } from '@main/services/unit-conversion-service';
import { UserEfLibraryService } from '@main/services/user-ef-library-service';
import type { AuditEvent, EfImportPreview } from '@shared/types';
import Database from 'better-sqlite3';
import ExcelJS from 'exceljs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const FIXED_NOW = '2026-07-12T00:00:00.000Z';

const CSV = [
  'factor_code,name_zh,name_en,scope,category,year,geography,input_unit,co2e_kg_per_unit,gwp_basis',
  'DIESEL-1,内部柴油,Internal diesel,1,fuel.combustion,2024,CN,L,2.68,AR6',
  'GRID-EAST,华东电网,East grid,2,electricity.grid,2024,CN-East,kWh,0.7035,AR6',
  ',缺码因子,,3,freight.road,2024,,tkm,0.11,', // blank code/geo/gwp → defaults
  'BAD-ROW,坏行,,9,x,2024,CN,L,1.0,AR6', // scope_invalid → skipped
].join('\n');

let db: Database.Database;
let uploadsDir: string;
let documentService: DocumentService;
let service: UserEfLibraryService;
let efService: EfService;

function auditEvents(kind: string): Array<{ parsed: Record<string, unknown> }> {
  const rows = db
    .prepare('SELECT * FROM audit_event WHERE event_kind = ? ORDER BY occurred_at, id')
    .all(kind) as AuditEvent[];
  return rows.map((r) => ({ ...r, parsed: JSON.parse(r.payload) as Record<string, unknown> }));
}

function factorsOf(source: string): Array<Record<string, unknown>> {
  return db
    .prepare('SELECT * FROM emission_factor WHERE source = ? ORDER BY factor_code')
    .all(source) as Array<Record<string, unknown>>;
}

function ftsCount(query: string): number {
  const row = db.prepare('SELECT count(*) AS n FROM ef_fts WHERE ef_fts MATCH ?').get(query) as {
    n: number;
  };
  return row.n;
}

async function stage(csv: string = CSV, filename = 'factors.csv'): Promise<EfImportPreview> {
  return service.stageImport(Buffer.from(csv, 'utf-8'), filename);
}

async function importLibrary(
  name = '内部台账',
  version = 'v1',
  overrides: { allow_replace?: boolean; csv?: string } = {},
) {
  const preview = await stage(overrides.csv ?? CSV);
  return service.import({
    token: preview.token,
    name,
    version,
    mapping: preview.mapping,
    allow_replace: overrides.allow_replace ?? false,
  });
}

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  const ctx = { db, now: () => FIXED_NOW };
  uploadsDir = mkdtempSync(join(tmpdir(), 'carbonink-ef-lib-test-'));
  documentService = new DocumentService({ ...ctx, uploadsDir });
  service = new UserEfLibraryService({ ...ctx, documentService });
  efService = new EfService(ctx);
});

afterEach(() => {
  db.close();
  rmSync(uploadsDir, { recursive: true, force: true });
});

describe('stageImport', () => {
  it('auto-detects the mapping and validates rows', async () => {
    const preview = await stage();
    expect(preview.filename).toBe('factors.csv');
    expect(preview.total_rows).toBe(4);
    expect(preview.mapping).toMatchObject({
      factor_code: 0,
      name_zh: 1,
      name_en: 2,
      scope: 3,
      category: 4,
      year: 5,
      geography: 6,
      input_unit: 7,
      co2e_kg_per_unit: 8,
      gwp_basis: 9,
    });
    expect(preview.validation.valid_count).toBe(3);
    expect(preview.validation.errors).toEqual([{ row: 5, code: 'scope_invalid', detail: '9' }]);
    // kWh/L/tkm are seeded units; no unit warnings expected.
    expect(preview.validation.warnings).toEqual([]);
  });
});

describe('import', () => {
  it('lands valid rows in emission_factor under the user: namespace', async () => {
    const result = await importLibrary('内部台账', 'v1');
    expect(result).toMatchObject({
      ok: true,
      imported_count: 3,
      skipped_count: 1,
      replaced: false,
    });
    if (!result.ok) return;

    expect(result.library).toMatchObject({
      name: '内部台账',
      source: 'user:内部台账',
      version: 'v1',
      factor_count: 3,
      source_filename: 'factors.csv',
      imported_at: FIXED_NOW,
    });

    const rows = factorsOf('user:内部台账');
    expect(rows).toHaveLength(3);
    const diesel = rows.find((r) => r.factor_code === 'DIESEL-1');
    expect(diesel).toMatchObject({
      name_zh: '内部柴油',
      name_en: 'Internal diesel',
      scope: 1,
      category: 'fuel.combustion',
      year: 2024,
      geography: 'CN',
      dataset_version: 'v1',
      input_unit: 'L',
      co2e_kg_per_unit: 2.68,
      gwp_basis: 'AR6',
    });
    // Defaults: generated factor_code, GLOBAL geography, AR6 gwp.
    const generated = rows.find((r) => r.name_zh === '缺码因子');
    expect(generated).toMatchObject({ geography: 'GLOBAL', gwp_basis: 'AR6' });
    expect(String(generated?.factor_code)).toMatch(/^EF-\d{5}$/);
  });

  it('makes imported factors visible to EfService and the FTS mirror', async () => {
    const before = efService.list({}).length;
    await importLibrary();
    const after = efService.list({});
    expect(after.length).toBe(before + 3);

    const viaCategory = efService.list({ category: 'fuel.combustion' });
    expect(viaCategory.some((f) => f.source === 'user:内部台账')).toBe(true);

    // FTS triggers (migration 010) indexed the new rows.
    expect(ftsCount('华东电网')).toBeGreaterThan(0);
    expect(ftsCount('"Internal diesel"')).toBeGreaterThan(0);
  });

  it('stores the original file as an ef_library document, hidden from listAll', async () => {
    const result = await importLibrary();
    if (!result.ok) throw new Error('import failed');
    const doc = documentService.getById(result.library.document_id as string);
    expect(doc?.doc_type).toBe('ef_library');
    expect(doc?.filename).toBe('factors.csv');
    expect(documentService.listAll().find((d) => d.id === doc?.id)).toBeUndefined();
  });

  it('writes an ef_library.imported audit event with counts only', async () => {
    await importLibrary();
    const events = auditEvents('ef_library.imported');
    expect(events).toHaveLength(1);
    const payload = events[0]?.parsed;
    expect(payload).toMatchObject({
      name: '内部台账',
      version: 'v1',
      replaced: false,
      total_rows: 4,
      imported_count: 3,
      skipped_count: 1,
      warning_count: 0,
    });
    expect(payload).toHaveProperty('library_id');
    expect(payload).toHaveProperty('document_id');
    expect(payload).toHaveProperty('sha256');
    // No factor names / row content in the payload.
    expect(JSON.stringify(payload)).not.toContain('柴油');
  });

  it('rejects a duplicate library name unless allow_replace, then replaces atomically', async () => {
    await importLibrary('库A', 'v1');
    const again = await importLibrary('库A', 'v2');
    expect(again).toEqual({ ok: false, error: { _tag: 'NameExists' } });

    const smaller = ['name_zh,scope,year,input_unit,co2e_kg_per_unit', '新柴油,1,2025,L,2.70'].join(
      '\n',
    );
    const replaced = await importLibrary('库A', 'v2', { allow_replace: true, csv: smaller });
    expect(replaced).toMatchObject({ ok: true, imported_count: 1, replaced: true });

    const rows = factorsOf('user:库A');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name_zh: '新柴油', dataset_version: 'v2', year: 2025 });
    // Old rows left the FTS mirror; new one is searchable.
    expect(ftsCount('华东电网')).toBe(0);
    expect(ftsCount('新柴油')).toBe(1);
    // Registry still has exactly one row for the name, updated in place.
    expect(service.list()).toHaveLength(1);
    expect(service.list()[0]).toMatchObject({ name: '库A', version: 'v2', factor_count: 1 });
    // Second import event flags replaced=true.
    const events = auditEvents('ef_library.imported');
    expect(events).toHaveLength(2);
    expect(events[1]?.parsed).toMatchObject({ replaced: true });
  });

  it('validates the library name', async () => {
    const preview = await stage();
    const bad = service.import({
      token: preview.token,
      name: '   ',
      version: 'v1',
      mapping: preview.mapping,
      allow_replace: false,
    });
    expect(bad).toEqual({ ok: false, error: { _tag: 'InvalidName' } });
  });

  it('rejects a stale token and a mapping missing required fields', async () => {
    const preview = await stage();
    const { co2e_kg_per_unit: _dropped, ...incomplete } = preview.mapping;
    expect(
      service.import({
        token: preview.token,
        name: 'X',
        version: '',
        mapping: incomplete,
        allow_replace: false,
      }),
    ).toEqual({ ok: false, error: { _tag: 'NothingToImport' } });

    service.discardPending(preview.token);
    expect(
      service.import({
        token: preview.token,
        name: 'X',
        version: '',
        mapping: preview.mapping,
        allow_replace: false,
      }),
    ).toEqual({ ok: false, error: { _tag: 'TokenExpired' } });
  });

  it('defaults a blank version to the import date', async () => {
    const result = await importLibrary('日期版', '');
    if (!result.ok) throw new Error('import failed');
    expect(result.library.version).toBe('2026-07-12');
    expect(factorsOf('user:日期版')[0]?.dataset_version).toBe('2026-07-12');
  });
});

describe('revalidate', () => {
  it('re-runs validation under an edited mapping', async () => {
    const headerless = ['colA,colB,colC,colD,colE', '柴油,1,2024,L,2.68'].join('\n');
    const preview = await stage(headerless, 'noheaders.csv');
    // Nothing auto-detected → everything missing.
    expect(preview.validation.valid_count).toBe(0);
    const fixed = service.revalidate(preview.token, {
      name_zh: 0,
      scope: 1,
      year: 2,
      input_unit: 3,
      co2e_kg_per_unit: 4,
    });
    expect(fixed?.valid_count).toBe(1);
    expect(service.revalidate('nope', preview.mapping)).toBeNull();
  });
});

describe('delete', () => {
  it('removes catalog rows + registry entry but preserves pinned snapshots', async () => {
    await importLibrary();

    // Bind an activity to an imported factor — pins a full snapshot.
    const ctx = { db, now: () => FIXED_NOW };
    const orgService = new OrganizationService(ctx);
    const unitConv = new UnitConversionService({ db });
    const org = orgService.createOrganization({
      name_en: 'Acme',
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
    const source = new EmissionSourceService(ctx).create({
      site_id: site.id,
      name: 'Diesel boiler',
      scope: 1,
      category: 'fuel.combustion',
    });
    const activityService = new ActivityDataService({
      ...ctx,
      efService,
      calculationService: new CalculationService({ unitConversion: unitConv }),
      unitConversionService: unitConv,
    });
    const activity = activityService.create({
      emission_source_id: source.id,
      reporting_period_id: period.id,
      occurred_at_start: '2024-01-01',
      occurred_at_end: '2024-01-31',
      amount: 100,
      unit: 'L',
      ef_factor_code: 'DIESEL-1',
      ef_year: 2024,
      ef_source: 'user:内部台账',
      ef_geography: 'CN',
      ef_dataset_version: 'v1',
    });
    expect(activity.computed_co2e_kg).toBeCloseTo(268, 6);

    const library = service.list()[0];
    if (!library) throw new Error('library missing');
    const result = service.delete(library.id);
    expect(result).toEqual({ ok: true, deleted_factor_count: 3 });

    // Catalog + FTS + registry cleared…
    expect(factorsOf('user:内部台账')).toHaveLength(0);
    expect(ftsCount('华东电网')).toBe(0);
    expect(service.list()).toHaveLength(0);
    // …but the pinned snapshot and the activity's numbers survive.
    const pinned = db
      .prepare(`SELECT * FROM pinned_emission_factor WHERE source = 'user:内部台账'`)
      .all();
    expect(pinned).toHaveLength(1);
    const activityRow = db
      .prepare('SELECT computed_co2e_kg FROM activity_data WHERE id = ?')
      .get(activity.id) as { computed_co2e_kg: number };
    expect(activityRow.computed_co2e_kg).toBeCloseTo(268, 6);

    const events = auditEvents('ef_library.deleted');
    expect(events).toHaveLength(1);
    expect(events[0]?.parsed).toMatchObject({
      library_id: library.id,
      name: '内部台账',
      version: 'v1',
      factor_count: 3,
    });
  });

  it('returns ok:false for an unknown id', () => {
    expect(service.delete('missing')).toEqual({ ok: false });
  });
});

describe('buildTemplateXlsx', () => {
  it('produces a template whose headers auto-detect completely', async () => {
    const bytes = await service.buildTemplateXlsx();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes as unknown as ArrayBuffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new Error('template has no sheet');
    const headers: string[] = [];
    sheet.getRow(1).eachCell((cell) => headers.push(String(cell.value)));
    expect(headers).toContain('factor_code');
    expect(headers).toContain('co2e_kg_per_unit');

    // Round-trip: the template with its example rows imports cleanly.
    const preview = await service.stageImport(bytes, 'carbonink-ef-template.xlsx');
    expect(preview.validation.valid_count).toBe(2);
    expect(preview.validation.error_count).toBe(0);
  });
});
