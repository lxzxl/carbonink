import ExcelJS from 'exceljs';

export interface AnswerCell {
  ref: string;
  value: string;
  isDraft: boolean;
}

export interface WriteResult {
  buffer: Buffer;
  written: number;
  drafts: number;
}

export async function writeAnswers(
  originalBytes: Buffer | ArrayBuffer,
  cells: readonly AnswerCell[],
): Promise<WriteResult> {
  const wb = new ExcelJS.Workbook();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await wb.xlsx.load(originalBytes as any);

  let written = 0;
  let drafts = 0;

  for (const cell of cells) {
    const [sheetName, address] = cell.ref.split('!');
    if (!sheetName || !address) continue;
    const sheet = wb.getWorksheet(sheetName);
    if (!sheet) continue;
    const xlCell = sheet.getCell(address);

    const numeric = Number(cell.value);
    const isNumber = Number.isFinite(numeric) && cell.value.trim() !== '';
    xlCell.value = isNumber ? numeric : cell.value;

    if (cell.isDraft) {
      xlCell.note = 'draft';
      drafts++;
    }
    written++;
  }

  const out = await wb.xlsx.writeBuffer();
  return { buffer: Buffer.from(out as ArrayBuffer), written, drafts };
}
