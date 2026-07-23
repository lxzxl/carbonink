/**
 * Client deliverable bundle (spec 2026-07-23-client-deliverable-bundle):
 * real seeded chain (org → site → period → source → activities), real
 * evidence files on disk via DocumentService/EvidenceService, real zip
 * written by archiver — then unpacked with jszip and verified byte-for-
 * byte against manifest.csv, exactly the way an external reviewer would.
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '@main/db/migrate';
import { ActivityDataService } from '@main/services/activity-data-service';
import { CalculationService } from '@main/services/calculation-service';
import { buildDeliverableBundle } from '@main/services/deliverable-export-service';
import { DocumentService } from '@main/services/document-service';
import { EfService } from '@main/services/ef-service';
import { EmissionSourceService } from '@main/services/emission-source-service';
import { EvidenceService } from '@main/services/evidence-service';
import { OrganizationService } from '@main/services/organization-service';
import { UnitConversionService } from '@main/services/unit-conversion-service';
import type { ActivityData } from '@shared/types';
import Database from 'better-sqlite3';
import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const FIXED_NOW = '2026-07-23T00:00:00.000Z';

const CN_NATIONAL = {
  ef_factor_code: 'electricity.grid.cn.national.2024',
  ef_year: 2024,
  ef_source: 'MEE_China',
  ef_geography: 'CN',
  ef_dataset_version: '2024.q4',
} as const;

const REPORT_PDF = Buffer.from('%PDF-1.4 fake report body');
const APPENDIX_XLSX = Buffer.from('PK fake appendix body');

let db: Database.Database;
let uploadsDir: string;
let outDir: string;
let documentService: DocumentService;
let evidence: EvidenceService;
let activityService: ActivityDataService;
let periodId: string;
let sourceId: string;

function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function makeActivity(amount: number): ActivityData {
  return activityService.create({
    emission_source_id: sourceId,
    reporting_period_id: periodId,
    occurred_at_start: '2024-01-01',
    occurred_at_end: '2024-01-31',
    amount,
    unit: 'kWh',
    ...CN_NATIONAL,
  });
}

function attach(activityId: string, filename: string, content: string): string {
  const row = evidence.add({
    target: { activity_data_id: activityId },
    file: { filename, mimeType: 'application/pdf', bytes: Buffer.from(content) },
  });
  return row.document_id;
}

/** Strip a leading BOM without any escape sequence in this source file. */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Parse one data row written by the bundle's always-quoted CSV writer. */
function parseCsvRow(line: string): string[] {
  const fields = line.match(/"(?:[^"]|"")*"/g) ?? [];
  return fields.map((f) => f.slice(1, -1).replace(/""/g, '"'));
}

async function loadZip(zipPath: string): Promise<JSZip> {
  return JSZip.loadAsync(readFileSync(zipPath));
}

async function readManifest(zip: JSZip): Promise<{ header: string[]; rows: string[][] }> {
  const text = await zip.file('manifest.csv')?.async('string');
  if (text === undefined) throw new Error('manifest.csv missing from zip');
  const lines = stripBom(text).trimEnd().split('\n');
  const headerLine = lines[0];
  if (headerLine === undefined) throw new Error('manifest.csv empty');
  return { header: headerLine.split(','), rows: lines.slice(1).map(parseCsvRow) };
}

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  const ctx = { db, now: () => FIXED_NOW };

  uploadsDir = mkdtempSync(join(tmpdir(), 'carbonink-deliverable-up-'));
  outDir = mkdtempSync(join(tmpdir(), 'carbonink-deliverable-out-'));
  documentService = new DocumentService({ ...ctx, uploadsDir });
  evidence = new EvidenceService({ ...ctx, documentService });

  const unitConv = new UnitConversionService({ db });
  const efService = new EfService(ctx);
  const orgService = new OrganizationService(ctx);
  const sourceService = new EmissionSourceService(ctx);
  activityService = new ActivityDataService({
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
  periodId = period.id;
  const source = sourceService.create({
    site_id: site.id,
    name: 'Grid meter',
    scope: 2,
    category: 'electricity.grid',
  });
  sourceId = source.id;
});

afterEach(() => {
  db.close();
  rmSync(uploadsDir, { recursive: true, force: true });
  rmSync(outDir, { recursive: true, force: true });
});

describe('buildDeliverableBundle', () => {
  it('packs report + appendix + evidence copies + manifest; every sha256 verifies', async () => {
    const act1 = makeActivity(1000);
    const act2 = makeActivity(2000);
    attach(act1.id, '电费单.pdf', '%PDF bill jan');
    attach(act1.id, 'meter-photo.pdf', '%PDF photo jan');
    attach(act2.id, 'bill-feb.pdf', '%PDF bill feb');

    const zipPath = join(outDir, 'bundle.zip');
    const result = await buildDeliverableBundle({
      db,
      periodId,
      activities: [
        { id: act1.id, source_name: 'Grid meter' },
        { id: act2.id, source_name: 'Grid meter' },
      ],
      reportPdf: { name: 'acme-iso-2024.pdf', bytes: REPORT_PDF },
      appendixXlsx: { name: 'acme-iso-2024-appendix.xlsx', bytes: APPENDIX_XLSX },
      outPath: zipPath,
    });

    expect(result).toEqual({ evidenceTotal: 3, evidenceMissing: 0 });

    const zip = await loadZip(zipPath);
    const names = Object.keys(zip.files).sort();
    expect(names).toEqual(
      [
        'acme-iso-2024.pdf',
        'acme-iso-2024-appendix.xlsx',
        'evidence/001-电费单.pdf',
        'evidence/001-meter-photo.pdf',
        'evidence/002-bill-feb.pdf',
        'manifest.csv',
      ].sort(),
    );

    const { header, rows } = await readManifest(zip);
    expect(header).toEqual([
      'file',
      'type',
      'sha256',
      'size_bytes',
      'activity_no',
      'activity_id',
      'source_name',
      'original_filename',
      'status',
    ]);
    expect(rows).toHaveLength(5);

    // Offline-reviewer verification: recompute the sha256 of every file in
    // the zip and compare against what the manifest claims.
    for (const row of rows) {
      const [file, type, sha, , activityNo, activityId, sourceName, original, status] = row;
      expect(status).toBe('included');
      if (file === undefined || sha === undefined) throw new Error('manifest row malformed');
      const bytes = await zip.file(file)?.async('nodebuffer');
      if (!bytes) throw new Error(`zip entry missing: ${file}`);
      expect(sha256Hex(bytes)).toBe(sha);
      if (type === 'evidence') {
        expect(['1', '2']).toContain(activityNo);
        expect([act1.id, act2.id]).toContain(activityId);
        expect(sourceName).toBe('Grid meter');
        expect(original?.length).toBeGreaterThan(0);
      }
    }
  });

  it('flags missing evidence files in the manifest instead of failing', async () => {
    const act1 = makeActivity(1000);
    attach(act1.id, 'kept.pdf', '%PDF kept');
    const goneDocId = attach(act1.id, 'gone.pdf', '%PDF gone');
    const goneDoc = documentService.getById(goneDocId);
    if (!goneDoc) throw new Error('fixture: document row missing');
    unlinkSync(goneDoc.storage_path);

    const zipPath = join(outDir, 'bundle.zip');
    const result = await buildDeliverableBundle({
      db,
      periodId,
      activities: [{ id: act1.id, source_name: 'Grid meter' }],
      reportPdf: { name: 'r.pdf', bytes: REPORT_PDF },
      appendixXlsx: { name: 'a.xlsx', bytes: APPENDIX_XLSX },
      outPath: zipPath,
    });

    expect(result).toEqual({ evidenceTotal: 2, evidenceMissing: 1 });

    const zip = await loadZip(zipPath);
    expect(zip.file('evidence/001-kept.pdf')).toBeTruthy();
    expect(Object.keys(zip.files).some((n) => n.includes('gone'))).toBe(false);

    const { rows } = await readManifest(zip);
    const missingRow = rows.find((r) => r[8] === 'missing');
    if (!missingRow) throw new Error('missing row absent from manifest');
    expect(missingRow[0]).toBe('');
    expect(missingRow[7]).toBe('gone.pdf');
    // The ledger's expected sha256 is still listed so the reviewer knows
    // exactly which bytes are absent.
    expect(missingRow[2]).toBe(goneDoc.sha256);
  });

  it('dedupes colliding entry names and sanitizes path separators', async () => {
    const act1 = makeActivity(1000);
    attach(act1.id, 'dup.pdf', '%PDF dup one');
    attach(act1.id, 'dup.pdf', '%PDF dup two');
    attach(act1.id, '../escape/../up.pdf', '%PDF sneaky');

    const zipPath = join(outDir, 'bundle.zip');
    await buildDeliverableBundle({
      db,
      periodId,
      activities: [{ id: act1.id, source_name: 'Grid meter' }],
      reportPdf: { name: 'r.pdf', bytes: REPORT_PDF },
      appendixXlsx: { name: 'a.xlsx', bytes: APPENDIX_XLSX },
      outPath: zipPath,
    });

    const zip = await loadZip(zipPath);
    const names = Object.keys(zip.files);
    expect(names).toContain('evidence/001-dup.pdf');
    expect(names).toContain('evidence/001-dup-2.pdf');
    // Separators can't survive sanitization — every entry stays exactly
    // one level under evidence/ and no path segment is a traversal.
    for (const n of names) {
      expect(n.startsWith('evidence/') || ['r.pdf', 'a.xlsx', 'manifest.csv'].includes(n)).toBe(
        true,
      );
      const segments = n.split('/');
      expect(segments.length).toBeLessThanOrEqual(2);
      expect(segments.some((s) => s === '..')).toBe(false);
    }
  });

  it('handles a >100-file period without loss (streaming path)', async () => {
    const act1 = makeActivity(1000);
    for (let i = 0; i < 120; i++) {
      attach(act1.id, `bill-${String(i).padStart(3, '0')}.pdf`, `%PDF evidence number ${i}`);
    }

    const zipPath = join(outDir, 'bundle.zip');
    const result = await buildDeliverableBundle({
      db,
      periodId,
      activities: [{ id: act1.id, source_name: 'Grid meter' }],
      reportPdf: { name: 'r.pdf', bytes: REPORT_PDF },
      appendixXlsx: { name: 'a.xlsx', bytes: APPENDIX_XLSX },
      outPath: zipPath,
    });

    expect(result).toEqual({ evidenceTotal: 120, evidenceMissing: 0 });

    const zip = await loadZip(zipPath);
    const evidenceEntries = Object.keys(zip.files).filter((n) => n.startsWith('evidence/'));
    expect(evidenceEntries).toHaveLength(120);
    const { rows } = await readManifest(zip);
    expect(rows.filter((r) => r[1] === 'evidence')).toHaveLength(120);
  });
});
