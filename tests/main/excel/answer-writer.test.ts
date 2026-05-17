import { writeAnswers } from '@main/excel/answer-writer';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

async function buildFixture(cells: { sheet: string; address: string; value: string | number }[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sheets = new Map<string, ExcelJS.Worksheet>();
  for (const c of cells) {
    let sheet = sheets.get(c.sheet);
    if (!sheet) {
      sheet = wb.addWorksheet(c.sheet);
      sheets.set(c.sheet, sheet);
    }
    sheet.getCell(c.address).value = c.value;
  }
  return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

async function readCell(buffer: Buffer, sheet: string, address: string): Promise<{ value: unknown; note: unknown }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const cell = wb.getWorksheet(sheet)!.getCell(address);
  return { value: cell.value, note: cell.note };
}

describe('writeAnswers', () => {
  it('writes a numeric value into the indicated cell', async () => {
    const original = await buildFixture([{ sheet: 'Sheet1', address: 'A1', value: 'Header' }]);
    const result = await writeAnswers(original, [
      { ref: 'Sheet1!B5', value: '14820', isDraft: false },
    ]);
    const cell = await readCell(result.buffer, 'Sheet1', 'B5');
    expect(cell.value).toBe(14820);
    expect(cell.note).toBeFalsy();
    expect(result.written).toBe(1);
    expect(result.drafts).toBe(0);
  });

  it('attaches a "draft" comment when isDraft=true', async () => {
    const original = await buildFixture([{ sheet: 'Sheet1', address: 'A1', value: 'Header' }]);
    const result = await writeAnswers(original, [
      { ref: 'Sheet1!C3', value: 'Beijing', isDraft: true },
    ]);
    const cell = await readCell(result.buffer, 'Sheet1', 'C3');
    expect(cell.value).toBe('Beijing');
    expect(cell.note).toBe('draft');
    expect(result.drafts).toBe(1);
  });

  it('silently skips malformed refs and missing sheets', async () => {
    const original = await buildFixture([{ sheet: 'Sheet1', address: 'A1', value: 'Header' }]);
    const result = await writeAnswers(original, [
      { ref: 'NoSuchSheet!B5', value: 'x', isDraft: false },
      { ref: 'bad-ref', value: 'y', isDraft: false },
      { ref: 'Sheet1!D1', value: '42', isDraft: false },
    ]);
    expect(result.written).toBe(1); // only the valid one
    const cell = await readCell(result.buffer, 'Sheet1', 'D1');
    expect(cell.value).toBe(42);
  });
});
