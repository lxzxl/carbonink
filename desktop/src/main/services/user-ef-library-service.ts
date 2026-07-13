import type {
  EfImportMapping,
  EfImportPreview,
  EfImportValidation,
  EfLibraryImportResult,
  UserEfLibrary,
} from '@shared/types.js';
import { EF_IMPORT_REQUIRED_FIELDS, USER_EF_SOURCE_PREFIX } from '@shared/types.js';
import { newId } from '@shared/ulid.js';
import ExcelJS from 'exceljs';
import type { ServiceContext } from './base.js';
import type { DocumentService } from './document-service.js';
import { autoDetectMapping, type EfImportValidRow, validateRows } from './ef-import/mapping.js';
import { type EfImportGrid, parseEfImportFile } from './ef-import/parser.js';

const LIBRARY_SELECT = `SELECT id, name, source, version, source_filename, document_id,
         factor_count, imported_at, created_at
    FROM user_ef_library`;

const MAX_LIBRARY_NAME_LENGTH = 50;

/** Control characters are the only thing a library name must never carry —
 * it becomes an `emission_factor.source` string shown all over the UI. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is this regex's entire purpose
const CONTROL_CHARS = /[\x00-\x1f\x7f]/u;

/** Columns of the template's data sheet, in order. Keys are the canonical
 * English header names `autoDetectMapping` recognizes verbatim. */
const TEMPLATE_COLUMNS: ReadonlyArray<{ header: string; example1: string; example2: string }> = [
  { header: 'factor_code', example1: 'DIESEL-STATIONARY', example2: 'GRID-EAST-CN' },
  { header: 'name_zh', example1: '柴油-固定燃烧', example2: '华东电网电力' },
  {
    header: 'name_en',
    example1: 'Diesel - stationary combustion',
    example2: 'East China grid electricity',
  },
  { header: 'scope', example1: '1', example2: '2' },
  { header: 'category', example1: 'fuel.combustion', example2: 'electricity.grid' },
  { header: 'year', example1: '2024', example2: '2024' },
  { header: 'geography', example1: 'CN', example2: 'CN-East' },
  { header: 'input_unit', example1: 'L', example2: 'kWh' },
  { header: 'co2e_kg_per_unit', example1: '2.68', example2: '0.7035' },
  { header: 'ch4_kg_per_unit', example1: '0.0001', example2: '' },
  { header: 'n2o_kg_per_unit', example1: '0.00002', example2: '' },
  { header: 'gwp_basis', example1: 'AR6', example2: 'AR6' },
  { header: 'description_zh', example1: '内部台账因子示例', example2: '' },
  { header: 'description_en', example1: 'Example row — replace me', example2: '' },
  { header: 'notes', example1: '', example2: '' },
  { header: 'citation_url', example1: '', example2: '' },
];

type PendingImport = {
  token: string;
  filename: string;
  /** Original file bytes, kept so import can store the file content-addressed. */
  bytes: Buffer;
  grid: EfImportGrid;
};

/**
 * User-imported emission-factor libraries (migration 019, ROADMAP §8.1-④).
 *
 * Imported rows land directly in `emission_factor` under the
 * `'user:<library name>'` source namespace — the composite PK isolates them
 * from the built-in catalog, the FTS5 triggers (migration 010) index them
 * automatically, and every downstream consumer (EfPicker, ef-matcher,
 * `EfService.pin`, the lineage panel) picks them up with zero changes.
 *
 * Deleting or replacing a library only touches the catalog: activity rows
 * reference `pinned_emission_factor` snapshots (full copies, no FK into
 * `emission_factor`), so already-pinned numbers keep their value, source
 * string and dataset_version — exactly the audit story the lineage drawer
 * tells.
 *
 * A parse is staged in a single in-memory slot (`pending`) keyed by a
 * token: pick-file stages it, the renderer's mapping edits revalidate
 * against it, and import consumes it. Picking a new file replaces the slot.
 */
export class UserEfLibraryService {
  private readonly db: ServiceContext['db'];
  private readonly now: () => string;
  private readonly documentService: DocumentService;
  private pending: PendingImport | null = null;

  constructor(ctx: ServiceContext & { documentService: DocumentService }) {
    this.db = ctx.db;
    this.now = ctx.now;
    this.documentService = ctx.documentService;
  }

  list(): UserEfLibrary[] {
    return this.db
      .prepare(`${LIBRARY_SELECT} ORDER BY imported_at DESC, id DESC`)
      .all() as UserEfLibrary[];
  }

  getById(id: string): UserEfLibrary | null {
    const row = this.db.prepare(`${LIBRARY_SELECT} WHERE id = ?`).get(id) as
      | UserEfLibrary
      | undefined;
    return row ?? null;
  }

  getByName(name: string): UserEfLibrary | null {
    const row = this.db.prepare(`${LIBRARY_SELECT} WHERE name = ?`).get(name) as
      | UserEfLibrary
      | undefined;
    return row ?? null;
  }

  /**
   * Parse an uploaded file and stage it for import. Throws
   * `EfImportParseError` (code-carrying) on structural problems; the IPC
   * handler folds that into its discriminated result.
   */
  async stageImport(bytes: Buffer, filename: string): Promise<EfImportPreview> {
    const grid = await parseEfImportFile(bytes, filename);
    const token = newId();
    this.pending = { token, filename, bytes, grid };
    const mapping = autoDetectMapping(grid.headers);
    const { validation } = validateRows(grid.rows, mapping, { knownUnits: this.knownUnits() });
    return {
      token,
      filename,
      headers: grid.headers,
      total_rows: grid.rows.length,
      mapping,
      validation,
    };
  }

  /** Re-run validation on the staged parse under an edited mapping. */
  revalidate(token: string, mapping: EfImportMapping): EfImportValidation | null {
    const pending = this.requirePending(token);
    if (!pending) return null;
    return validateRows(pending.grid.rows, mapping, { knownUnits: this.knownUnits() }).validation;
  }

  /** Drop the staged parse (renderer closed the drawer without importing). */
  discardPending(token: string): void {
    if (this.pending?.token === token) this.pending = null;
  }

  /**
   * Commit the staged import: valid rows land in `emission_factor` under
   * `source = 'user:<name>'`, the original file is stored content-addressed
   * (doc_type 'ef_library'), the registry row is inserted or — with
   * `allow_replace` on an existing name — rewritten after deleting the old
   * rows. One transaction, one `ef_library.imported` audit event.
   */
  import(input: {
    token: string;
    name: string;
    version: string;
    mapping: EfImportMapping;
    allow_replace: boolean;
  }): EfLibraryImportResult {
    const pending = this.requirePending(input.token);
    if (!pending) {
      return { ok: false, error: { _tag: 'TokenExpired' } };
    }

    const name = input.name.trim();
    if (name.length === 0 || name.length > MAX_LIBRARY_NAME_LENGTH || CONTROL_CHARS.test(name)) {
      return { ok: false, error: { _tag: 'InvalidName' } };
    }
    const version = input.version.trim() === '' ? this.now().slice(0, 10) : input.version.trim();

    for (const field of EF_IMPORT_REQUIRED_FIELDS) {
      if (input.mapping[field] === undefined) {
        // The renderer disables import until required fields are mapped, so
        // reaching this means a stale/bypassed client — treat as nothing.
        return { ok: false, error: { _tag: 'NothingToImport' } };
      }
    }

    const existing = this.getByName(name);
    if (existing && !input.allow_replace) {
      return { ok: false, error: { _tag: 'NameExists' } };
    }

    const { validation, validRows } = validateRows(pending.grid.rows, input.mapping, {
      knownUnits: this.knownUnits(),
    });
    if (validRows.length === 0) {
      return { ok: false, error: { _tag: 'NothingToImport' } };
    }

    const source = `${USER_EF_SOURCE_PREFIX}${name}`;
    const ts = this.now();

    const tx = this.db.transaction((): UserEfLibrary => {
      if (existing) {
        // Replace: clear the old catalog rows first (FTS5 AFTER DELETE
        // triggers unindex each row). Pinned snapshots are untouched.
        this.db.prepare('DELETE FROM emission_factor WHERE source = ?').run(existing.source);
      }

      const doc = this.documentService.uploadFile(
        {
          filename: pending.filename,
          mimeType: mimeForFilename(pending.filename),
          bytes: pending.bytes,
        },
        { purpose: 'ef_library' },
      );

      this.insertFactors(source, version, validRows);

      let library: UserEfLibrary;
      if (existing) {
        this.db
          .prepare(
            `UPDATE user_ef_library
                SET version = ?, source_filename = ?, document_id = ?,
                    factor_count = ?, imported_at = ?
              WHERE id = ?`,
          )
          .run(version, pending.filename, doc.id, validRows.length, ts, existing.id);
        library = this.getById(existing.id) as UserEfLibrary;
      } else {
        const id = newId();
        this.db
          .prepare(
            `INSERT INTO user_ef_library
               (id, name, source, version, source_filename, document_id,
                factor_count, imported_at, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(id, name, source, version, pending.filename, doc.id, validRows.length, ts, ts);
        library = this.getById(id) as UserEfLibrary;
      }

      this.writeAudit('ef_library.imported', ts, {
        library_id: library.id,
        name,
        version,
        replaced: existing !== null,
        total_rows: validation.total_rows,
        imported_count: validRows.length,
        skipped_count: validation.error_count,
        warning_count: validation.warning_count,
        document_id: doc.id,
        sha256: doc.sha256,
      });

      return library;
    });

    const library = tx();
    this.pending = null;
    return {
      ok: true,
      library,
      imported_count: validRows.length,
      skipped_count: validation.error_count,
      replaced: existing !== null,
    };
  }

  /**
   * Delete a library: its catalog rows and the registry entry, in one
   * transaction, with an `ef_library.deleted` audit event. Pinned snapshots
   * (and therefore every existing activity/answer/report number) survive by
   * construction; the factors just stop being offered for new bindings.
   */
  delete(id: string): { ok: true; deleted_factor_count: number } | { ok: false } {
    const library = this.getById(id);
    if (!library) return { ok: false };

    const tx = this.db.transaction((): number => {
      const result = this.db
        .prepare('DELETE FROM emission_factor WHERE source = ?')
        .run(library.source);
      this.db.prepare('DELETE FROM user_ef_library WHERE id = ?').run(id);
      this.writeAudit('ef_library.deleted', this.now(), {
        library_id: library.id,
        name: library.name,
        version: library.version,
        factor_count: result.changes,
      });
      return result.changes;
    });

    return { ok: true, deleted_factor_count: tx() };
  }

  /** The downloadable import template: data sheet + a bilingual notes sheet. */
  async buildTemplateXlsx(): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const data = workbook.addWorksheet('factors');
    data.addRow(TEMPLATE_COLUMNS.map((c) => c.header));
    data.addRow(TEMPLATE_COLUMNS.map((c) => c.example1));
    data.addRow(TEMPLATE_COLUMNS.map((c) => c.example2));
    data.getRow(1).font = { bold: true };
    for (let i = 1; i <= TEMPLATE_COLUMNS.length; i += 1) {
      data.getColumn(i).width = 22;
    }

    const notes = workbook.addWorksheet('说明 notes');
    const lines = [
      '碳墨排放因子库导入模板 · CarbonInk EF library import template',
      '',
      '必填列 required: scope (1/2/3), year, input_unit, co2e_kg_per_unit;',
      'name_zh / name_en 至少填一列 at least one of name_zh / name_en.',
      'factor_code 缺省自动生成 auto-generated when blank.',
      'geography 缺省 GLOBAL when blank. gwp_basis 缺省 AR6 (allowed: AR5/AR6).',
      '',
      'category 建议使用内置点分税表以参与 AI 匹配 dotted taxonomy examples:',
      'fuel.combustion / electricity.grid / freight.road / travel.air.economy.shorthaul /',
      'purchase.material.steel / purchase.service.consulting',
      '',
      '示例行请删除后再导入 delete the example rows before importing.',
    ];
    for (const line of lines) notes.addRow([line]);
    notes.getColumn(1).width = 90;

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer as ArrayBuffer);
  }

  private insertFactors(source: string, version: string, validRows: EfImportValidRow[]): void {
    const stmt = this.db.prepare(
      `INSERT INTO emission_factor (
         factor_code, year, source, geography, dataset_version,
         scope, category, ghg_protocol_path, input_unit,
         co2e_kg_per_unit, ch4_kg_per_unit, n2o_kg_per_unit,
         hfc_kg_per_unit, pfc_kg_per_unit, sf6_kg_per_unit, nf3_kg_per_unit,
         gwp_basis, name_zh, name_en, description_zh, description_en,
         notes, biogenic_co2_factor, citation_url
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const { data } of validRows) {
      stmt.run(
        data.factor_code,
        data.year,
        source,
        data.geography,
        version,
        data.scope,
        data.category,
        data.ghg_protocol_path,
        data.input_unit,
        data.co2e_kg_per_unit,
        data.ch4_kg_per_unit,
        data.n2o_kg_per_unit,
        data.hfc_kg_per_unit,
        data.pfc_kg_per_unit,
        data.sf6_kg_per_unit,
        data.nf3_kg_per_unit,
        data.gwp_basis,
        data.name_zh,
        data.name_en,
        data.description_zh,
        data.description_en,
        data.notes,
        data.biogenic_co2_factor,
        data.citation_url,
      );
    }
  }

  /**
   * Advisory known-unit set for the `unit_unknown` warning. Read straight
   * from `unit_definition` — same table UnitConversionService uses; no
   * service dependency needed for a read-only membership check.
   */
  private knownUnits(): ReadonlySet<string> {
    const rows = this.db.prepare('SELECT unit FROM unit_definition').all() as Array<{
      unit: string;
    }>;
    return new Set(rows.map((r) => r.unit));
  }

  private requirePending(token: string): PendingImport | null {
    if (!this.pending || this.pending.token !== token) return null;
    return this.pending;
  }

  private writeAudit(kind: string, ts: string, payload: Record<string, unknown>): void {
    this.db
      .prepare('INSERT INTO audit_event (id, event_kind, payload, occurred_at) VALUES (?, ?, ?, ?)')
      .run(newId(), kind, JSON.stringify(payload), ts);
  }
}

function mimeForFilename(filename: string): string {
  return filename.toLowerCase().endsWith('.csv')
    ? 'text/csv'
    : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
}
