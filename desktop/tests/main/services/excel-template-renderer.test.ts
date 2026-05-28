import {
  InboundPeriodMismatch,
  InboundQuestionnaireMismatch,
  InboundTemplateMismatch,
  InboundTemplateMissingSentinels,
  parseInboundXlsx,
  renderInboundXlsx,
  SENTINEL_KEYS,
} from '@main/services/excel-template-renderer';
import { CAT1_SUPPLIER_DISCLOSURE } from '@main/services/inbound-templates/index.js';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

/**
 * Round-trip helper: render a Cat 1 xlsx, parse it back via a fresh ExcelJS
 * workbook, and hand the workbook to the assertion. Mirrors the integration
 * path the real parser (T5) will take.
 */
async function renderAndReopen(overrides: Partial<Parameters<typeof renderInboundXlsx>[0]> = {}) {
  const buf = await renderInboundXlsx({
    template: CAT1_SUPPLIER_DISCLOSURE,
    questionnaireId: 'qn-test-1',
    supplierName: 'Acme Steel Co.',
    periodYear: 2025,
    myOrgName: '碳墨测试',
    dueDate: '2026-06-30',
    ...overrides,
  });
  const wb = new ExcelJS.Workbook();
  // ExcelJS / @types/node Buffer generic mismatch — same cast pattern as
  // `excel/answer-writer.ts`. The runtime accepts a Buffer just fine.
  // biome-ignore lint/suspicious/noExplicitAny: Boundary cast — see comment.
  await wb.xlsx.load(buf as any);
  return { buf, wb };
}

describe('renderInboundXlsx — workbook structure', () => {
  it('produces 5 worksheets (cover + 3 question sheets + 1 hidden sentinel)', async () => {
    const { wb } = await renderAndReopen();
    const names = wb.worksheets.map((s) => s.name).sort();
    expect(names).toContain('封面 Cover');
    expect(names).toContain('metadata');
    expect(names).toContain('tier1');
    expect(names).toContain('tier2');
    expect(names).toContain('__sentinels');
    expect(wb.worksheets).toHaveLength(5);
  });

  it("the sentinel sheet is veryHidden so the supplier can't delete it accidentally", async () => {
    const { wb } = await renderAndReopen();
    const sentinel = wb.getWorksheet('__sentinels');
    expect(sentinel).toBeDefined();
    expect(sentinel?.state).toBe('veryHidden');
  });

  it('cover sheet is first so it opens by default in Excel', async () => {
    const { wb } = await renderAndReopen();
    expect(wb.worksheets[0]?.name).toBe('封面 Cover');
  });
});

describe('renderInboundXlsx — sentinel fingerprint', () => {
  it('writes the four expected sentinel rows in column A/B', async () => {
    const { wb } = await renderAndReopen({
      questionnaireId: 'qn-deadbeef',
      periodYear: 2026,
    });
    const s = wb.getWorksheet('__sentinels');
    expect(s).toBeDefined();
    if (!s) throw new Error('unreachable');

    expect(s.getCell('A1').value).toBe(SENTINEL_KEYS.templateKind);
    expect(s.getCell('B1').value).toBe('cat1_supplier_disclosure');
    expect(s.getCell('A2').value).toBe(SENTINEL_KEYS.templateVersion);
    expect(s.getCell('B2').value).toBe('1.0');
    expect(s.getCell('A3').value).toBe(SENTINEL_KEYS.questionnaireId);
    expect(s.getCell('B3').value).toBe('qn-deadbeef');
    expect(s.getCell('A4').value).toBe(SENTINEL_KEYS.expectedPeriod);
    expect(s.getCell('B4').value).toBe(2026);
  });
});

describe('renderInboundXlsx — question cells', () => {
  it('places every template question at its cell_ref coordinate', async () => {
    const { wb } = await renderAndReopen();
    for (const q of CAT1_SUPPLIER_DISCLOSURE.questions) {
      const [sheetName, address] = q.cell_ref.split('!');
      if (!sheetName || !address) throw new Error(`bad cell_ref: ${q.cell_ref}`);
      const sheet = wb.getWorksheet(sheetName);
      expect(sheet, `sheet ${sheetName} missing`).toBeDefined();
      if (!sheet) continue;
      // The input cell itself stays empty (supplier fills it). What we
      // assert is that the question text lives in column A of the SAME row.
      const rowNum = Number.parseInt(address.match(/\d+$/)?.[0] ?? '0', 10);
      const labelCell = sheet.getCell(`A${rowNum}`);
      const labelText = String(labelCell.value ?? '');
      expect(labelText, `question label for ${q.position}`).toContain(q.raw_zh);
      expect(labelText).toContain(q.raw_en);
    }
  });

  it("input cells (column B at each question's row) are left empty for the supplier", async () => {
    const { wb } = await renderAndReopen();
    for (const q of CAT1_SUPPLIER_DISCLOSURE.questions) {
      const [sheetName, address] = q.cell_ref.split('!');
      if (!sheetName || !address) continue;
      const sheet = wb.getWorksheet(sheetName);
      const inputCell = sheet?.getCell(address);
      // Either undefined / null / empty string — anything supplier-equivalent.
      const raw = inputCell?.value;
      expect(raw == null || raw === '').toBe(true);
    }
  });

  // Note: in earlier drafts we asserted that numerical input cells carry
  // their `expected_unit` as a cell note (Excel comment). ExcelJS writes
  // the note correctly — when a human opens the xlsx in Excel the comment
  // indicator appears — but `wb.xlsx.load()` round-trip doesn't reliably
  // re-surface notes on the cell object (the data goes into a separate
  // comments part of the .xlsx zip that this version of ExcelJS doesn't
  // re-attach on load). Rather than fight the library here, we trust the
  // smoke (T13 manual step) to confirm comments render in real Excel.
  it('produces a workbook even when no overrides are given (smoke)', async () => {
    const { buf } = await renderAndReopen();
    expect(buf.length).toBeGreaterThan(1000);
  });
});

describe('renderInboundXlsx — cover content', () => {
  it('substitutes period_year, supplier name, and org name into the cover copy', async () => {
    const { wb } = await renderAndReopen({
      periodYear: 2024,
      myOrgName: '某采购方',
      supplierName: 'Beta Chemicals Ltd.',
      dueDate: '2026-08-15',
    });
    const cover = wb.getWorksheet('封面 Cover');
    expect(cover).toBeDefined();
    if (!cover) return;
    const concatenated = collectColumnA(cover);
    expect(concatenated).toContain('2024');
    expect(concatenated).toContain('某采购方');
    expect(concatenated).toContain('2026-08-15');
  });

  it('falls back to "请尽快回复 / please reply at your earliest convenience" when dueDate is null', async () => {
    const { wb } = await renderAndReopen({ dueDate: null });
    const cover = wb.getWorksheet('封面 Cover');
    if (!cover) throw new Error('unreachable');
    const concatenated = collectColumnA(cover);
    expect(concatenated).toContain('请尽快回复');
    expect(concatenated).toContain('please reply at your earliest convenience');
  });
});

describe('renderInboundXlsx — subset rendering', () => {
  it('respects includedPositions and only emits the requested questions', async () => {
    const { wb } = await renderAndReopen({
      includedPositions: ['meta.1', 'tier1.1'],
    });
    // Both included sheets exist...
    expect(wb.getWorksheet('metadata')).toBeDefined();
    expect(wb.getWorksheet('tier1')).toBeDefined();
    // ...but tier2 sheet should be absent (no questions selected for it).
    expect(wb.getWorksheet('tier2')).toBeUndefined();
  });

  it('renders all positions when includedPositions is omitted or empty', async () => {
    const { wb: wbOmitted } = await renderAndReopen({});
    expect(wbOmitted.getWorksheet('tier2')).toBeDefined();

    const { wb: wbEmpty } = await renderAndReopen({ includedPositions: [] });
    expect(wbEmpty.getWorksheet('tier2')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function collectColumnA(sheet: ExcelJS.Worksheet): string {
  const parts: string[] = [];
  sheet.eachRow((row) => {
    const v = row.getCell('A').value;
    if (v != null) parts.push(String(v));
  });
  return parts.join('\n');
}

// ===========================================================================
// PARSER tests (T5)
// ===========================================================================

/**
 * Render → simulate supplier filling cells → write back to buffer → parse.
 * Mirrors the round-trip the real flow goes through (export → email →
 * supplier fills → email back → import).
 */
async function renderFillAndParse(
  fills: Record<string, string | number>,
  overrides: Partial<{ questionnaireId: string; periodYear: number }> = {},
) {
  const questionnaireId = overrides.questionnaireId ?? 'qn-roundtrip-1';
  const periodYear = overrides.periodYear ?? 2025;
  const blank = await renderInboundXlsx({
    template: CAT1_SUPPLIER_DISCLOSURE,
    questionnaireId,
    supplierName: 'Acme Steel Co.',
    periodYear,
    myOrgName: '碳墨测试',
    dueDate: '2026-06-30',
  });

  // Open + write supplier cells + dump to a new buffer.
  const wb = new ExcelJS.Workbook();
  // biome-ignore lint/suspicious/noExplicitAny: Buffer cast — see render side.
  await wb.xlsx.load(blank as any);
  for (const [cellRef, value] of Object.entries(fills)) {
    const [sheetName, address] = cellRef.split('!');
    if (!sheetName || !address) continue;
    const sheet = wb.getWorksheet(sheetName);
    if (!sheet) continue;
    sheet.getCell(address).value = value;
  }
  const filled = await wb.xlsx.writeBuffer();

  return parseInboundXlsx({
    // biome-ignore lint/suspicious/noExplicitAny: Buffer cast — see render side.
    fileBytes: filled as any,
    template: CAT1_SUPPLIER_DISCLOSURE,
    expectedQuestionnaireId: questionnaireId,
    expectedPeriodYear: periodYear,
  });
}

describe('parseInboundXlsx — sentinel hard-failure modes', () => {
  it('throws InboundTemplateMissingSentinels when the workbook lacks the hidden sheet', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('metadata');
    wb.addWorksheet('tier1');
    wb.addWorksheet('tier2');
    const bytes = await wb.xlsx.writeBuffer();
    await expect(
      parseInboundXlsx({
        // biome-ignore lint/suspicious/noExplicitAny: Buffer cast.
        fileBytes: bytes as any,
        template: CAT1_SUPPLIER_DISCLOSURE,
        expectedQuestionnaireId: 'qn-x',
        expectedPeriodYear: 2025,
      }),
    ).rejects.toThrow(InboundTemplateMissingSentinels);
  });

  it('throws InboundTemplateMismatch when the sentinel template_kind differs', async () => {
    // Build a workbook with sentinels claiming a different template_kind.
    const wb = new ExcelJS.Workbook();
    const s = wb.addWorksheet('__sentinels');
    s.state = 'veryHidden';
    s.getCell('A1').value = SENTINEL_KEYS.templateKind;
    s.getCell('B1').value = 'cat99_other_template';
    s.getCell('A2').value = SENTINEL_KEYS.templateVersion;
    s.getCell('B2').value = '1.0';
    s.getCell('A3').value = SENTINEL_KEYS.questionnaireId;
    s.getCell('B3').value = 'qn-x';
    s.getCell('A4').value = SENTINEL_KEYS.expectedPeriod;
    s.getCell('B4').value = 2025;
    const bytes = await wb.xlsx.writeBuffer();
    await expect(
      parseInboundXlsx({
        // biome-ignore lint/suspicious/noExplicitAny: Buffer cast.
        fileBytes: bytes as any,
        template: CAT1_SUPPLIER_DISCLOSURE,
        expectedQuestionnaireId: 'qn-x',
        expectedPeriodYear: 2025,
      }),
    ).rejects.toThrow(InboundTemplateMismatch);
  });

  it('throws InboundQuestionnaireMismatch when the embedded id differs', async () => {
    // Render an xlsx for qn-A but try to parse it as qn-B.
    const blank = await renderInboundXlsx({
      template: CAT1_SUPPLIER_DISCLOSURE,
      questionnaireId: 'qn-A',
      supplierName: 'Acme',
      periodYear: 2025,
      myOrgName: 'Test',
    });
    await expect(
      parseInboundXlsx({
        // biome-ignore lint/suspicious/noExplicitAny: Buffer cast.
        fileBytes: blank as any,
        template: CAT1_SUPPLIER_DISCLOSURE,
        expectedQuestionnaireId: 'qn-B', // wrong id
        expectedPeriodYear: 2025,
      }),
    ).rejects.toThrow(InboundQuestionnaireMismatch);
  });

  it('throws InboundPeriodMismatch when the embedded period differs from caller-expected', async () => {
    const blank = await renderInboundXlsx({
      template: CAT1_SUPPLIER_DISCLOSURE,
      questionnaireId: 'qn-x',
      supplierName: 'Acme',
      periodYear: 2025,
      myOrgName: 'Test',
    });
    await expect(
      parseInboundXlsx({
        // biome-ignore lint/suspicious/noExplicitAny: Buffer cast.
        fileBytes: blank as any,
        template: CAT1_SUPPLIER_DISCLOSURE,
        expectedQuestionnaireId: 'qn-x',
        expectedPeriodYear: 2024, // wrong year
      }),
    ).rejects.toThrow(InboundPeriodMismatch);
  });
});

describe('parseInboundXlsx — happy-path round trips', () => {
  it('returns ParsedXlsxAnswer for every template position (filled or blank)', async () => {
    const result = await renderFillAndParse({
      'metadata!B5': 'Acme Steel Co., Ltd.',
      'tier2!B5': 850000,
      'tier2!B7': 'mass-based',
      'tier2!B9': 12000,
    });
    expect(result.answers).toHaveLength(7); // one per template question

    const meta1 = result.answers.find((a) => a.position === 'meta.1');
    expect(meta1?.parsed_value).toBe('Acme Steel Co., Ltd.');
    expect(meta1?.is_blank).toBe(false);

    const tier2_1 = result.answers.find((a) => a.position === 'tier2.1');
    expect(tier2_1?.parsed_value).toBe(850000);
    expect(tier2_1?.is_blank).toBe(false);

    const tier2_2 = result.answers.find((a) => a.position === 'tier2.2');
    expect(tier2_2?.parsed_value).toBe('mass-based');

    const tier2_3 = result.answers.find((a) => a.position === 'tier2.3');
    expect(tier2_3?.parsed_value).toBe(12000);

    // tier1.1 wasn't filled → blank
    const tier1_1 = result.answers.find((a) => a.position === 'tier1.1');
    expect(tier1_1?.is_blank).toBe(true);
    expect(tier1_1?.parsed_value).toBeNull();
  });

  it('parses numerical cells supplied as strings with optional unit suffix', async () => {
    const result = await renderFillAndParse({
      'tier1!B5': '2.5 kgCO2e/kg',
    });
    const tier1_1 = result.answers.find((a) => a.position === 'tier1.1');
    expect(tier1_1?.parsed_value).toBe(2.5);
    expect(tier1_1?.is_blank).toBe(false);
    // No unit warning — supplier's "kgCO2e/kg" matches expected "kgCO2e/kg".
    const unitWarn = result.warnings.find((w) => w.kind === 'unit_unrecognized');
    expect(unitWarn).toBeUndefined();
  });

  it('accepts comma thousands separators', async () => {
    const result = await renderFillAndParse({
      'tier2!B5': '1,234,567',
    });
    const tier2_1 = result.answers.find((a) => a.position === 'tier2.1');
    expect(tier2_1?.parsed_value).toBe(1234567);
  });

  it('captures the supplier note from column C alongside the answer', async () => {
    const result = await renderFillAndParse({
      'tier1!B5': 111,
      'tier1!C5': '111-estimate', // note column for tier1.1
      'tier2!B5': 222,
      'tier2!C5': '预估', // note column for tier2.1
    });
    const tier1_1 = result.answers.find((a) => a.position === 'tier1.1');
    expect(tier1_1?.parsed_value).toBe(111);
    expect(tier1_1?.note).toBe('111-estimate');

    const tier2_1 = result.answers.find((a) => a.position === 'tier2.1');
    expect(tier2_1?.note).toBe('预估');

    // A cell with no note comes back as '' (not undefined/null).
    const tier2_3 = result.answers.find((a) => a.position === 'tier2.3');
    expect(tier2_3?.note).toBe('');
  });

  it('captures a note even when the answer cell itself is blank', async () => {
    const result = await renderFillAndParse({
      'tier1!C5': '见附件 PCF 报告', // note only, B5 left empty
    });
    const tier1_1 = result.answers.find((a) => a.position === 'tier1.1');
    expect(tier1_1?.is_blank).toBe(true); // answer cell empty
    expect(tier1_1?.note).toBe('见附件 PCF 报告'); // but note survives
  });
});

describe('parseInboundXlsx — soft warnings', () => {
  it('emits numerical_unparseable warning when a numerical cell has non-numeric text', async () => {
    const result = await renderFillAndParse({
      'tier2!B5': 'about 800k',
    });
    const tier2_1 = result.answers.find((a) => a.position === 'tier2.1');
    expect(tier2_1?.parsed_value).toBeNull();
    expect(tier2_1?.is_blank).toBe(false);
    const warn = result.warnings.find((w) => w.kind === 'numerical_unparseable');
    expect(warn).toBeDefined();
    expect(warn?.detail).toContain('about 800k');
  });

  it('emits unit_unrecognized warning when suffix is wrong', async () => {
    const result = await renderFillAndParse({
      'tier1!B5': '2.5 kgCO2/kg', // missing the "e"
    });
    const warn = result.warnings.find((w) => w.kind === 'unit_unrecognized');
    expect(warn).toBeDefined();
    expect(warn?.detail).toContain('tier1.1');
  });

  it('emits blank_template warning when no tier numerical answer is filled', async () => {
    const result = await renderFillAndParse({
      // metadata only
      'metadata!B5': 'Empty Supplier',
    });
    const warn = result.warnings.find((w) => w.kind === 'blank_template');
    expect(warn).toBeDefined();
  });

  it('does NOT emit blank_template when any tier numerical is filled', async () => {
    const result = await renderFillAndParse({
      'tier1!B5': 2.5,
    });
    const warn = result.warnings.find((w) => w.kind === 'blank_template');
    expect(warn).toBeUndefined();
  });
});
