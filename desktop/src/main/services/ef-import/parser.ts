import type { EfImportFileErrorCode } from '@shared/types.js';
import ExcelJS from 'exceljs';

/**
 * Raw grid extracted from an uploaded EF-library file: the header row plus
 * every non-empty data row. `row` keeps the 1-based row number from the
 * user's file (header included in the numbering) so validation issues can
 * say "row 17" and the user can find that exact row in Excel.
 */
export type EfImportGrid = {
  headers: string[];
  rows: Array<{ row: number; cells: string[] }>;
};

/**
 * Hard caps for the import path. The file cap bounds the synchronous
 * main-process read; the row cap bounds everything downstream that walks
 * the whole catalog per call (`EfService.list` in the matcher, the
 * un-virtualized EfPicker list).
 */
export const EF_IMPORT_MAX_FILE_BYTES = 20 * 1024 * 1024;
export const EF_IMPORT_MAX_DATA_ROWS = 50_000;

/**
 * File-level parse failure. Carries a locale-neutral `code` (+ short
 * `detail` payload) instead of prose — the renderer renders it through
 * paraglide so zh-CN/en parity stays structural (the inbound importer's
 * inline-Chinese errors are documented debt, not a pattern to copy).
 */
export class EfImportParseError extends Error {
  readonly _tag = 'EfImportParseFailed';
  constructor(
    readonly code: EfImportFileErrorCode,
    readonly detail?: string,
  ) {
    super(`ef-import parse failed: ${code}${detail ? ` (${detail})` : ''}`);
  }
}

/**
 * Stringify an exceljs cell value without going through `cell.text`, which
 * applies the cell's display format (a factor stored as 0.12345 but shown
 * with two decimals would silently import as "0.12"). Numbers keep full
 * precision via String(); formula cells contribute their cached result.
 */
function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if ('richText' in value) {
      return value.richText
        .map((part) => part.text)
        .join('')
        .trim();
    }
    if ('result' in value) return cellToString(value.result as ExcelJS.CellValue);
    if ('text' in value) return cellToString(value.text as ExcelJS.CellValue);
    if ('error' in value) return '';
  }
  return String(value).trim();
}

/**
 * Decode CSV bytes. Chinese Excel saves plain "CSV" as GB18030/GBK unless
 * the user explicitly picks "CSV UTF-8", so a strict UTF-8 decode that
 * fails falls back to gb18030. Pure-ASCII content decodes identically
 * under both, so the fallback can't corrupt anything.
 */
function decodeCsvBytes(bytes: Buffer): string {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder('gb18030').decode(bytes);
  }
  // Strip a UTF-8 BOM (Excel's "CSV UTF-8" flavor always writes one).
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Minimal RFC 4180 parser: comma-separated, `"` quoting with `""` escapes,
 * CRLF or LF record breaks (a quoted field may span lines). No new
 * dependency — the repo's CSV needs are hand-rolled (see the audit CSV
 * export) and this stays symmetric with that decision.
 */
export function parseCsv(text: string): string[][] {
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;
  let i = 0;

  const endField = (): void => {
    record.push(field.trim());
    field = '';
  };
  const endRecord = (): void => {
    endField();
    records.push(record);
    record = [];
  };

  while (i < text.length) {
    const ch = text[i] as string;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && field.length === 0) {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      endField();
      i += 1;
      continue;
    }
    if (ch === '\n') {
      endRecord();
      i += 1;
      continue;
    }
    if (ch === '\r') {
      endRecord();
      if (text[i + 1] === '\n') i += 2;
      else i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  // Flush the trailing record unless the file ended exactly on a newline.
  if (field.length > 0 || record.length > 0) endRecord();
  return records;
}

function isBlankRow(cells: string[]): boolean {
  return cells.every((c) => c === '');
}

function gridFromMatrix(matrix: Array<{ row: number; cells: string[] }>): EfImportGrid {
  const nonEmpty = matrix.filter((r) => !isBlankRow(r.cells));
  const headerRow = nonEmpty[0];
  if (!headerRow) {
    throw new EfImportParseError('file_empty');
  }
  const width = headerRow.cells.length;
  const rows = nonEmpty.slice(1).map((r) => ({
    row: r.row,
    // Pad/truncate every data row to the header width so column indexes
    // from the mapping always resolve.
    cells: Array.from({ length: width }, (_, c) => r.cells[c] ?? ''),
  }));
  if (rows.length > EF_IMPORT_MAX_DATA_ROWS) {
    throw new EfImportParseError('too_many_rows', String(rows.length));
  }
  return { headers: headerRow.cells.map((h) => h.trim()), rows };
}

async function parseXlsx(bytes: Buffer): Promise<EfImportGrid> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(bytes as unknown as ArrayBuffer);
  } catch {
    throw new EfImportParseError('xlsx_invalid');
  }
  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new EfImportParseError('file_empty');
  }
  const matrix: Array<{ row: number; cells: string[] }> = [];
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const cells: string[] = [];
    // `row.cellCount` reflects the rightmost populated cell of this row;
    // gridFromMatrix pads all data rows to the header width afterwards.
    for (let c = 1; c <= row.cellCount; c += 1) {
      cells.push(cellToString(row.getCell(c).value));
    }
    matrix.push({ row: rowNumber, cells });
  });
  return gridFromMatrix(matrix);
}

function parseCsvGrid(bytes: Buffer): EfImportGrid {
  const records = parseCsv(decodeCsvBytes(bytes));
  const matrix = records.map((cells, idx) => ({ row: idx + 1, cells }));
  return gridFromMatrix(matrix);
}

/**
 * Parse an uploaded EF-library file (.xlsx or .csv) into a raw string grid.
 * Throws {@link EfImportParseError} on any structural problem (unsupported
 * extension, empty file, size/row caps, corrupt workbook).
 */
export async function parseEfImportFile(bytes: Buffer, filename: string): Promise<EfImportGrid> {
  if (bytes.length > EF_IMPORT_MAX_FILE_BYTES) {
    throw new EfImportParseError('file_too_large', `${(bytes.length / 1024 / 1024).toFixed(1)}MB`);
  }
  const lower = filename.toLowerCase();
  if (lower.endsWith('.xlsx')) return parseXlsx(bytes);
  if (lower.endsWith('.csv')) return parseCsvGrid(bytes);
  throw new EfImportParseError('unsupported_file_type', filename);
}
