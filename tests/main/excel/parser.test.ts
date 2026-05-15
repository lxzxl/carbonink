import { ExcelParser } from '@main/excel/parser';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

async function buildXlsx(populate: (sheet: ExcelJS.Worksheet) => void): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Sheet1');
  populate(sheet);
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

describe('ExcelParser.parse', () => {
  it('returns non-empty cells across all sheets with sheet/row/col/value/ref', async () => {
    const bytes = await buildXlsx((s) => {
      s.getCell('A1').value = 'Question';
      s.getCell('B1').value = 'Answer';
      s.getCell('A2').value = 'Total electricity (kWh)';
      s.getCell('A3').value = 'Total natural gas (m³)';
    });
    const cells = await ExcelParser.parse(bytes);
    expect(cells.length).toBe(4);
    const a1 = cells.find((c) => c.ref === 'Sheet1!A1');
    expect(a1?.value).toBe('Question');
    expect(a1?.sheet).toBe('Sheet1');
    expect(a1?.row).toBe(1);
    expect(a1?.col).toBe(1);
  });

  it('skips empty cells', async () => {
    const bytes = await buildXlsx((s) => {
      s.getCell('A1').value = 'foo';
      s.getCell('C1').value = 'bar';
    });
    const cells = await ExcelParser.parse(bytes);
    expect(cells.map((c) => c.ref).sort()).toEqual(['Sheet1!A1', 'Sheet1!C1']);
  });

  it('coerces numeric and string values', async () => {
    const bytes = await buildXlsx((s) => {
      s.getCell('A1').value = 42;
      s.getCell('A2').value = 'hello';
    });
    const cells = await ExcelParser.parse(bytes);
    const a1 = cells.find((c) => c.ref === 'Sheet1!A1');
    const a2 = cells.find((c) => c.ref === 'Sheet1!A2');
    expect(a1?.value).toBe(42);
    expect(a2?.value).toBe('hello');
  });

  it('walks multiple sheets', async () => {
    const wb = new ExcelJS.Workbook();
    const s1 = wb.addWorksheet('Scope 1');
    s1.getCell('A1').value = 'fuel';
    const s2 = wb.addWorksheet('Scope 2');
    s2.getCell('A1').value = 'electricity';
    const bytes = Buffer.from(await wb.xlsx.writeBuffer());
    const cells = await ExcelParser.parse(bytes);
    expect(cells.map((c) => c.ref).sort()).toEqual(['Scope 1!A1', 'Scope 2!A1']);
  });
});
