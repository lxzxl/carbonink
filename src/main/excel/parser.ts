import ExcelJS from 'exceljs';

export type ParsedCell = {
  sheet: string;
  row: number;
  col: number;
  value: string | number | null;
  ref: string; // e.g. "Sheet1!B5"
};

/**
 * Read-only Excel parser. Loads a .xlsx buffer fully into memory and
 * returns a flat list of non-empty cells across all sheets.
 *
 * Cell ref format: "<sheet name>!<column letter><row>", e.g. "Sheet1!B5".
 * Use the ref to write answers back later (Phase 2.2c).
 *
 * Performance: real CDP questionnaires are <500 KB / <2000 cells.
 * For larger files (10MB+) consider streaming; not needed for v1.
 */
export class ExcelParser {
  static async parse(bytes: Buffer | ArrayBuffer): Promise<ParsedCell[]> {
    const wb = new ExcelJS.Workbook();
    // ExcelJS expects Uint8Array but has overly strict typing
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await wb.xlsx.load(bytes as any);

    const out: ParsedCell[] = [];
    wb.eachSheet((sheet) => {
      sheet.eachRow((row) => {
        row.eachCell((cell) => {
          const raw = cell.value;
          if (raw === null || raw === undefined || raw === '') return;
          // Coerce ExcelJS rich types to primitives.
          let value: string | number;
          if (typeof raw === 'string' || typeof raw === 'number') {
            value = raw;
          } else if (typeof raw === 'object' && raw !== null) {
            if ('result' in raw && (typeof raw.result === 'string' || typeof raw.result === 'number')) {
              value = raw.result;
            } else if ('richText' in raw && Array.isArray((raw as { richText: unknown[] }).richText)) {
              value = ((raw as { richText: Array<{ text: string }> }).richText).map((r) => r.text).join('');
            } else if (raw instanceof Date) {
              value = raw.toISOString();
            } else {
              value = String(raw);
            }
          } else {
            value = String(raw);
          }
          out.push({
            sheet: sheet.name,
            row: cell.fullAddress.row,
            col: cell.fullAddress.col,
            value,
            ref: `${sheet.name}!${cell.address}`,
          });
        });
      });
    });

    return out;
  }
}
