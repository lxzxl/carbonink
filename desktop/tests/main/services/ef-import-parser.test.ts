import {
  EF_IMPORT_MAX_FILE_BYTES,
  EfImportParseError,
  parseCsv,
  parseEfImportFile,
} from '@main/services/ef-import/parser';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

async function xlsxBuffer(rows: Array<Array<string | number>>): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('factors');
  for (const row of rows) sheet.addRow(row);
  return Buffer.from((await workbook.xlsx.writeBuffer()) as ArrayBuffer);
}

function csvBuffer(text: string): Buffer {
  return Buffer.from(text, 'utf-8');
}

describe('parseCsv', () => {
  it('parses quoted fields, escaped quotes, and embedded commas/newlines', () => {
    const records = parseCsv('a,"b,1","say ""hi""","line1\nline2"\r\nc,d,e,f');
    expect(records).toEqual([
      ['a', 'b,1', 'say "hi"', 'line1\nline2'],
      ['c', 'd', 'e', 'f'],
    ]);
  });

  it('handles CRLF and trailing newline without a phantom record', () => {
    expect(parseCsv('a,b\r\nc,d\r\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });
});

describe('parseEfImportFile', () => {
  it('parses a UTF-8 BOM csv into headers + numbered rows', async () => {
    const bom = String.fromCharCode(0xfeff);
    const grid = await parseEfImportFile(
      csvBuffer(`${bom}name_zh,scope\n柴油,1\n\n电力,2\n`),
      'factors.csv',
    );
    expect(grid.headers).toEqual(['name_zh', 'scope']);
    // Blank row is dropped; original file row numbers survive.
    expect(grid.rows).toEqual([
      { row: 2, cells: ['柴油', '1'] },
      { row: 4, cells: ['电力', '2'] },
    ]);
  });

  it('decodes GB18030 csv (Chinese-Excel default) via fallback', async () => {
    const gbk = Buffer.from(
      new Uint8Array([
        // "名称,scope\n柴油,1" in GB18030
        0xc3, 0xfb, 0xb3, 0xc6, 0x2c, 0x73, 0x63, 0x6f, 0x70, 0x65, 0x0a, 0xb2, 0xf1, 0xd3, 0xcd,
        0x2c, 0x31,
      ]),
    );
    const grid = await parseEfImportFile(gbk, 'gbk.csv');
    expect(grid.headers).toEqual(['名称', 'scope']);
    expect(grid.rows[0]?.cells).toEqual(['柴油', '1']);
  });

  it('pads ragged data rows to the header width', async () => {
    const grid = await parseEfImportFile(csvBuffer('a,b,c\n1,2\n'), 'ragged.csv');
    expect(grid.rows[0]?.cells).toEqual(['1', '2', '']);
  });

  it('parses xlsx and preserves full numeric precision (not display format)', async () => {
    const bytes = await xlsxBuffer([
      ['name_en', 'co2e_kg_per_unit'],
      ['Diesel', 0.123456789],
    ]);
    const grid = await parseEfImportFile(bytes, 'factors.XLSX');
    expect(grid.headers).toEqual(['name_en', 'co2e_kg_per_unit']);
    expect(grid.rows[0]?.cells).toEqual(['Diesel', '0.123456789']);
  });

  it('rejects unsupported extensions', async () => {
    await expect(parseEfImportFile(csvBuffer('a,b'), 'factors.xls')).rejects.toMatchObject({
      code: 'unsupported_file_type',
    });
  });

  it('rejects oversized files before parsing', async () => {
    const big = Buffer.alloc(EF_IMPORT_MAX_FILE_BYTES + 1);
    await expect(parseEfImportFile(big, 'big.csv')).rejects.toMatchObject({
      code: 'file_too_large',
    });
  });

  it('rejects an empty / header-only file', async () => {
    await expect(parseEfImportFile(csvBuffer(''), 'empty.csv')).rejects.toBeInstanceOf(
      EfImportParseError,
    );
    await expect(parseEfImportFile(csvBuffer('\n\n'), 'blank.csv')).rejects.toMatchObject({
      code: 'file_empty',
    });
    // Header-only is fine at parse level (0 data rows); the service surfaces
    // "nothing to import" downstream.
    const grid = await parseEfImportFile(csvBuffer('name,scope\n'), 'header-only.csv');
    expect(grid.rows).toEqual([]);
  });

  it('rejects corrupt xlsx bytes', async () => {
    await expect(
      parseEfImportFile(Buffer.from('not a zip archive'), 'corrupt.xlsx'),
    ).rejects.toMatchObject({ code: 'xlsx_invalid' });
  });
});
