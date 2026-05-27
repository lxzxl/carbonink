import type { InboundTemplate, InboundTemplateQuestion } from '@shared/types';
import ExcelJS from 'exceljs';

/**
 * Renders an inbound questionnaire template as a fillable `.xlsx` workbook.
 *
 * Layout (5 sheets):
 *
 *   1. "封面 Cover"    — instructions copy with `{{period_year}}` substituted
 *                        in place. The user emails this xlsx to a supplier;
 *                        this sheet teaches the supplier what to fill.
 *   2. "metadata"     — questions whose template `tier` is null. v2.0 = 3 rows.
 *   3. "tier1"        — supplier-specific PCF (per-unit carbon footprint).
 *                        v2.0 = 1 numerical row.
 *   4. "tier2"        — allocated company-level emissions. v2.0 = 3 rows.
 *   5. "__sentinels"  — `veryHidden` sheet carrying template fingerprint
 *                        (kind, version, questionnaire_id, expected_period).
 *                        Parser-side validation in {@link parseInboundXlsx}
 *                        reads these BEFORE attempting to read any answer
 *                        cell — if they don't match the questionnaire we
 *                        sent, parse fails fast with a typed error.
 *
 * On each non-sentinel sheet the layout is:
 *
 *   | Column A         | Column B (input)  | Column C (notes)             |
 *   | "question (zh)   | _empty_           | "备注 / Notes:"              |
 *   |  question (en)"  |                   |                              |
 *
 * Row coordinates come straight from each question's `cell_ref` (e.g.
 * `tier2!B5`). Column A always holds the question text; column B always
 * holds the supplier's answer; column C is a free-form notes column the
 * supplier can use for caveats or attachment filenames. The parser only
 * cares about column B — A and C are pure UX scaffolding.
 *
 * We deliberately do NOT pre-set column widths, fonts, or colors. v2.0's
 * goal is correctness, not aesthetics. The smoke test (T13) will surface
 * any "too narrow to read the question" issues and we'll tweak then.
 */

const SENTINEL_SHEET_NAME = '__sentinels';
const COVER_SHEET_NAME = '封面 Cover';
const QUESTION_TEXT_COLUMN = 'A';
const NOTES_COLUMN = 'C';

/**
 * Sentinel keys baked into the hidden sheet. Parser-side validation
 * compares each value to expected. Keep these stable — changing any key
 * forces all in-flight xlsx files to fail validation on import.
 */
export const SENTINEL_KEYS = {
  templateKind: '__carbonink.template_kind',
  templateVersion: '__carbonink.template_version',
  questionnaireId: '__carbonink.questionnaire_id',
  expectedPeriod: '__carbonink.expected_period',
} as const;

export interface RenderInboundXlsxArgs {
  template: InboundTemplate;
  /** Subset of `template.questions` to actually include. Empty array → all. */
  includedPositions?: readonly string[];
  /** UUID of the questionnaire we're rendering for — embedded in sentinel. */
  questionnaireId: string;
  /** Supplier-facing display name (e.g. "Acme Steel Co."). Appears on cover. */
  supplierName: string;
  /** Reporting year the buyer is asking about (also embedded in sentinel). */
  periodYear: number;
  /** Buyer's own org name. Appears on cover so the supplier knows who's asking. */
  myOrgName: string;
  /** Optional. ISO date string (YYYY-MM-DD). Surfaced on cover if present. */
  dueDate?: string | null;
}

/**
 * Build the fillable xlsx. Returns a `Buffer` ready to write to disk via the
 * dialog handler in T9. Pure function modulo `ExcelJS.Workbook` allocation —
 * no I/O.
 *
 * Async because `wb.xlsx.writeBuffer()` is async (ExcelJS streams ZIP entries
 * even for in-memory output).
 */
export async function renderInboundXlsx(args: RenderInboundXlsxArgs): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = `CarbonInk — ${args.myOrgName}`;
  wb.created = new Date();

  const selectedPositions =
    args.includedPositions && args.includedPositions.length > 0
      ? new Set(args.includedPositions)
      : new Set(args.template.questions.map((q) => q.position));

  // 1) Cover sheet (must come first so it opens by default in Excel).
  buildCoverSheet(wb, args);

  // 2-4) Per-question sheets, grouped by sheet name parsed out of cell_ref.
  // We trust the template's cell_ref sheet names are well-formed; cat1.ts
  // has integrity tests for that.
  const grouped = groupQuestionsBySheet(args.template.questions, selectedPositions);
  for (const [sheetName, questions] of grouped) {
    buildQuestionSheet(wb, sheetName, questions);
  }

  // 5) Hidden sentinel sheet, written last so it doesn't accidentally
  // become the active sheet on open.
  buildSentinelSheet(wb, {
    templateKind: args.template.template_kind,
    templateVersion: args.template.version,
    questionnaireId: args.questionnaireId,
    expectedPeriod: args.periodYear,
  });

  // ExcelJS's `writeBuffer()` is typed `Promise<Buffer>`. Modern @types/node
  // makes `Buffer` generic over the backing ArrayBufferLike, so the value
  // round-trips back through `Buffer.from(... as any)` like other call-sites
  // in this codebase (see `excel/answer-writer.ts`). Acceptable: this is the
  // boundary at which we hand bytes back to disk-writing code.
  const out = await wb.xlsx.writeBuffer();
  // biome-ignore lint/suspicious/noExplicitAny: ExcelJS / @types/node Buffer generic mismatch.
  return out as any as Buffer;
}

// ---------------------------------------------------------------------------
// Internal sheet builders
// ---------------------------------------------------------------------------

function buildCoverSheet(wb: ExcelJS.Workbook, args: RenderInboundXlsxArgs): void {
  const sheet = wb.addWorksheet(COVER_SHEET_NAME);
  sheet.getColumn('A').width = 90;
  sheet.getColumn('A').alignment = { wrapText: true, vertical: 'top' };

  // Lines authored as data so tests can assert the substituted variants are
  // present. Each row is one cell in column A — Excel's wrapText handles
  // newlines visually.
  const lines = [
    `碳排放数据采集问卷 — ${args.template.template_kind}`,
    '',
    `本表由 ${args.myOrgName} 通过 CarbonInk 系统生成，用于收集贵公司报告期内（${args.periodYear} 年）作为我方供应商所产生的温室气体排放数据。`,
    '',
    '填写说明：',
    '1. 请优先填写 **Tier 1** sheet（单位产品碳足迹）。如贵公司持有第三方核证 PCF 报告，请将文件作为附件回传并在备注列注明文件名。',
    '2. 若无 PCF，请填写 **Tier 2** sheet（公司层级分配排放），需填全 3 项（总排放、分配方法、归因排放）。',
    '3. **metadata** sheet 中的 3 项基础信息为必填。',
    '4. 仅填部分字段也可；缺失字段我方将以行业平均估算。',
    '',
    args.dueDate ? `截止日期：${args.dueDate}` : '截止日期：请尽快回复',
    `请回传至：${args.myOrgName} 对接窗口（邮件正文中已注明）。`,
    '',
    '─────────────────────────────────────────────────────────────',
    '',
    `Carbon Emission Data Collection Questionnaire — ${args.template.template_kind}`,
    '',
    `This workbook was generated by ${args.myOrgName} via CarbonInk to collect greenhouse-gas data attributable to our purchases from your company during reporting period ${args.periodYear}.`,
    '',
    'Instructions:',
    '1. Fill the **Tier 1** sheet first (per-unit product carbon footprint). If you have a third-party verified PCF report, attach it to your reply email and reference the filename in the notes column.',
    '2. If no PCF is available, fill the **Tier 2** sheet (allocated company emissions) — all three fields required.',
    '3. The 3 fields on the **metadata** sheet are required.',
    '4. Partial completion is accepted; missing fields are estimated using industry averages.',
    '',
    args.dueDate
      ? `Deadline: ${args.dueDate}`
      : 'Deadline: please reply at your earliest convenience',
    `Return to: ${args.myOrgName} (contact details in covering email).`,
  ];

  for (let i = 0; i < lines.length; i++) {
    const row = sheet.getRow(i + 1);
    row.getCell('A').value = lines[i] ?? '';
  }

  // Sentinel cells the cover sheet itself doesn't need — supplier identity
  // and period are surfaced as visible text. Keep cover purely informational.
  sheet.getCell('Z1').value = args.supplierName; // off-screen marker for QA tooling
}

function buildQuestionSheet(
  wb: ExcelJS.Workbook,
  sheetName: string,
  questions: readonly InboundTemplateQuestion[],
): void {
  const sheet = wb.addWorksheet(sheetName);
  // Column widths chosen for "readable on first open" rather than pixel-
  // perfect: question column gets the most space; input + notes are sized
  // for typical numeric inputs and brief notes.
  sheet.getColumn('A').width = 80;
  sheet.getColumn('B').width = 24;
  sheet.getColumn(NOTES_COLUMN).width = 40;
  sheet.getColumn('A').alignment = { wrapText: true, vertical: 'top' };
  sheet.getColumn(NOTES_COLUMN).alignment = { wrapText: true, vertical: 'top' };

  // Header row at A1 — a one-line label so the supplier knows what sheet
  // they're on. Helpful when scrolling through 4 visible tabs.
  const headerRow = sheet.getRow(1);
  headerRow.getCell('A').value = sheetLabel(sheetName);
  headerRow.getCell('B').value = '答案 / Answer';
  headerRow.getCell(NOTES_COLUMN).value = '备注 / Notes';
  headerRow.font = { bold: true };

  for (const q of questions) {
    const [, address] = q.cell_ref.split('!');
    if (!address) continue;
    const rowNumber = parseRowNumberFromAddress(address);
    if (rowNumber === null) continue;

    const row = sheet.getRow(rowNumber);
    // Column A: question text (zh on top, en below).
    row.getCell(QUESTION_TEXT_COLUMN).value = `${q.raw_zh}\n\n${q.raw_en}`;
    row.getCell(QUESTION_TEXT_COLUMN).alignment = { wrapText: true, vertical: 'top' };
    // Column B: input cell — empty for the supplier to fill. We attach a
    // note hinting the expected unit for numerical questions; the parser
    // doesn't read notes (only the value).
    const inputCell = row.getCell('B');
    if (q.expected_unit !== null && q.expected_unit !== '') {
      inputCell.note = `单位 / Unit: ${q.expected_unit}`;
    }
    // Column C: notes column (also empty, free-form for supplier).
    row.getCell(NOTES_COLUMN).value = '';

    // Row auto-height: make it tall enough for the wrapped question text.
    // ExcelJS doesn't compute auto-height reliably; we just bump to 60pt
    // which fits 4-6 lines of CJK + Latin.
    row.height = 60;
  }
}

function buildSentinelSheet(
  wb: ExcelJS.Workbook,
  payload: {
    templateKind: string;
    templateVersion: string;
    questionnaireId: string;
    expectedPeriod: number;
  },
): void {
  const sheet = wb.addWorksheet(SENTINEL_SHEET_NAME);
  // `veryHidden` is stricter than `hidden`: Excel's Format → Sheet → Unhide
  // dialog doesn't list veryHidden sheets, so a curious supplier can't
  // delete the fingerprint by accident without going into VBA.
  sheet.state = 'veryHidden';
  sheet.getCell('A1').value = SENTINEL_KEYS.templateKind;
  sheet.getCell('B1').value = payload.templateKind;
  sheet.getCell('A2').value = SENTINEL_KEYS.templateVersion;
  sheet.getCell('B2').value = payload.templateVersion;
  sheet.getCell('A3').value = SENTINEL_KEYS.questionnaireId;
  sheet.getCell('B3').value = payload.questionnaireId;
  sheet.getCell('A4').value = SENTINEL_KEYS.expectedPeriod;
  sheet.getCell('B4').value = payload.expectedPeriod;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Group template questions by their `cell_ref`'s sheet name, keeping the
 * original template ordering within each sheet. Returns a Map iteration in
 * insertion order — Map preserves it per ECMA-262.
 */
function groupQuestionsBySheet(
  questions: readonly InboundTemplateQuestion[],
  included: ReadonlySet<string>,
): Map<string, InboundTemplateQuestion[]> {
  const out = new Map<string, InboundTemplateQuestion[]>();
  for (const q of questions) {
    if (!included.has(q.position)) continue;
    const [sheetName] = q.cell_ref.split('!');
    if (!sheetName) continue;
    const list = out.get(sheetName);
    if (list) {
      list.push(q);
    } else {
      out.set(sheetName, [q]);
    }
  }
  return out;
}

/**
 * Pull the row number out of an A1-style address (`'B5'` → 5). Returns
 * null if the address is malformed — caller skips such cells silently
 * because cat1.ts's tests already guarantee well-formed cell_refs at
 * build time; this is just runtime defense in depth.
 */
function parseRowNumberFromAddress(address: string): number | null {
  const m = address.match(/\d+$/);
  if (!m) return null;
  const n = Number.parseInt(m[0], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Bilingual sheet label for the header row. Hard-coded for v2.0's three
 * non-cover sheets; templating across more sheets in v2.x can extend.
 */
function sheetLabel(sheetName: string): string {
  switch (sheetName) {
    case 'metadata':
      return '基础信息 / Metadata';
    case 'tier1':
      return 'Tier 1：单位产品碳足迹 / Per-unit Product Carbon Footprint';
    case 'tier2':
      return 'Tier 2：分配排放 / Allocated Company Emissions';
    default:
      return sheetName;
  }
}
