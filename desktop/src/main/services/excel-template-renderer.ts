import type { ImportPreviewWarning, InboundTemplate, InboundTemplateQuestion } from '@shared/types';
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

// ===========================================================================
// PARSER (T5)
// ===========================================================================

/**
 * Result of parsing a single template question's filled cell. The service
 * layer (T7) decorates these with `proposed_activity` + `question_id` to
 * build the full `ImportPreview`; this layer stops at "what does the cell
 * say + did we manage to coerce it".
 */
export interface ParsedXlsxAnswer {
  /** Template-stable position, e.g. `'tier2.1'`. */
  position: string;
  /** Verbatim cell value as a string. Empty string if cell was blank. */
  raw_value: string;
  /**
   * Type-coerced value. `number` for numerical questions whose cell parsed
   * cleanly; `string` for categorical / narrative; `null` for blank cells
   * or numerical cells we couldn't coerce (the corresponding warning will
   * be present in `result.warnings`).
   */
  parsed_value: number | string | null;
  /** True when the cell was empty or contained only whitespace. */
  is_blank: boolean;
  /**
   * Free-form note from the same row's "备注 / Notes" column (C). Trimmed;
   * empty string when the supplier left it blank. Independent of
   * `is_blank` (which only reflects the answer cell B) — a supplier can
   * leave the answer blank but still add a note, or vice versa.
   */
  note: string;
}

export interface ParseInboundXlsxResult {
  answers: ParsedXlsxAnswer[];
  warnings: ImportPreviewWarning[];
}

export interface ParseInboundXlsxArgs {
  fileBytes: Buffer | ArrayBuffer;
  template: InboundTemplate;
  /**
   * What questionnaire we expect this file to belong to. The sentinel
   * sheet's `questionnaire_id` row must match exactly; mismatch throws
   * {@link InboundQuestionnaireMismatch} so the user can't accidentally
   * import a different supplier's reply.
   */
  expectedQuestionnaireId: string;
  /**
   * What reporting period we asked about. Mismatch against the sentinel
   * (the hidden value we wrote at render time) throws
   * {@link InboundPeriodMismatch} — the file was tampered or it's from a
   * different period's questionnaire.
   */
  expectedPeriodYear: number;
}

/**
 * Parse a supplier-filled xlsx that was previously emitted by
 * {@link renderInboundXlsx}. Hard failures (template fingerprint mismatch,
 * missing sentinels, wrong questionnaire id) throw typed errors; soft
 * issues (unparseable number, unrecognized unit suffix) appear in
 * `result.warnings` so the review UI can render them next to the
 * affected row.
 *
 * The parser intentionally does NOT touch the DB. It just transforms
 * bytes → structured answers. T7 wraps it with the answer-row UPSERTs.
 */
export async function parseInboundXlsx(
  args: ParseInboundXlsxArgs,
): Promise<ParseInboundXlsxResult> {
  const wb = new ExcelJS.Workbook();
  // Same boundary cast as the render side — ExcelJS / @types/node Buffer
  // generic mismatch; runtime accepts both Buffer and ArrayBuffer.
  // biome-ignore lint/suspicious/noExplicitAny: see render side for rationale.
  await wb.xlsx.load(args.fileBytes as any);

  // ----- Hard validation: sentinel sheet must be present + correct -----
  const sentinel = wb.getWorksheet(SENTINEL_SHEET_NAME);
  if (!sentinel) {
    throw new InboundTemplateMissingSentinels();
  }

  const seen = {
    templateKind: readSentinelValue(sentinel, 1),
    templateVersion: readSentinelValue(sentinel, 2),
    questionnaireId: readSentinelValue(sentinel, 3),
    expectedPeriod: readSentinelValue(sentinel, 4),
  };

  if (
    seen.templateKind !== args.template.template_kind ||
    seen.templateVersion !== args.template.version
  ) {
    throw new InboundTemplateMismatch({
      expectedKind: args.template.template_kind,
      expectedVersion: args.template.version,
      seenKind: String(seen.templateKind ?? ''),
      seenVersion: String(seen.templateVersion ?? ''),
    });
  }

  if (seen.questionnaireId !== args.expectedQuestionnaireId) {
    throw new InboundQuestionnaireMismatch({
      expected: args.expectedQuestionnaireId,
      seen: String(seen.questionnaireId ?? ''),
    });
  }

  // The sentinel's expectedPeriod is a number we wrote; it must equal what
  // we're now passing as expected_period. Mismatch = the file was
  // tampered or the user picked the wrong questionnaire to import against.
  const seenPeriod = Number(seen.expectedPeriod);
  if (!Number.isFinite(seenPeriod) || seenPeriod !== args.expectedPeriodYear) {
    throw new InboundPeriodMismatch({
      expected: args.expectedPeriodYear,
      seen: seen.expectedPeriod == null ? null : String(seen.expectedPeriod),
    });
  }

  // ----- Soft parse: walk every template question + read its cell --------
  const answers: ParsedXlsxAnswer[] = [];
  const warnings: ImportPreviewWarning[] = [];

  for (const q of args.template.questions) {
    const [sheetName, address] = q.cell_ref.split('!');
    if (!sheetName || !address) continue;
    const sheet = wb.getWorksheet(sheetName);
    if (!sheet) {
      // The supplier deleted a whole sheet. We track the position as
      // blank (so the review still shows it) but don't crash.
      answers.push({
        position: q.position,
        raw_value: '',
        parsed_value: null,
        is_blank: true,
        note: '',
      });
      continue;
    }
    const cell = sheet.getCell(address);
    const { raw, parsed, isBlank, warning } = coerceCellByKind(cell.value, q);
    // Notes live in column C of the same row (see render layout). Derive
    // the address by swapping the answer cell's column for NOTES_COLUMN.
    const note = readNoteCell(sheet, address);
    answers.push({
      position: q.position,
      raw_value: raw,
      parsed_value: parsed,
      is_blank: isBlank,
      note,
    });
    if (warning) {
      warnings.push(warning);
    }
  }

  // Blank-template warning: if no Tier 1 or Tier 2 numerical answer is
  // filled, the supplier returned a useless workbook. Worth flagging at
  // the workbook level so the review UI can lead with it.
  const anyTierNumerical = answers.some((a) => {
    const tq = args.template.questions.find((q) => q.position === a.position);
    return tq && tq.tier !== null && tq.kind === 'numerical' && !a.is_blank;
  });
  if (!anyTierNumerical) {
    warnings.push({
      question_id: null,
      kind: 'blank_template',
      detail:
        'No Tier 1 or Tier 2 numerical answer was filled — supplier returned no actionable data.',
    });
  }

  return { answers, warnings };
}

// ---------------------------------------------------------------------------
// Parser helpers
// ---------------------------------------------------------------------------

/**
 * Read the "备注 / Notes" cell (column C) sitting on the same row as a
 * given answer cell address (e.g. answer at `B5` → note at `C5`). Returns
 * the trimmed string, or '' when the note cell is blank / the address is
 * malformed. The answer column is always B in our render layout, so we
 * just reuse the row number and the NOTES_COLUMN constant.
 */
function readNoteCell(sheet: ExcelJS.Worksheet, answerAddress: string): string {
  const m = answerAddress.match(/\d+$/);
  if (!m) return '';
  const noteCell = sheet.getCell(`${NOTES_COLUMN}${m[0]}`);
  return cellToString(noteCell.value).trim();
}

/**
 * Read column B of a given row from the sentinel sheet. ExcelJS exposes
 * the cell value as `string | number | Date | …` — we coerce to a JS
 * primitive (string|number|null) for the comparators.
 */
function readSentinelValue(sheet: ExcelJS.Worksheet, row: number): string | number | null {
  const v = sheet.getCell(`B${row}`).value;
  if (v == null) return null;
  if (typeof v === 'string' || typeof v === 'number') return v;
  // Anything else (Date, formula, rich text) we coerce via String() —
  // it's enough for an equality test against the values we wrote, which
  // are always plain strings or numbers.
  return String(v);
}

/**
 * Coerce a raw cell value by the template question's `kind`. Returns the
 * triple needed by `ParsedXlsxAnswer` plus an optional warning when the
 * coercion was lossy.
 *
 * For numerical:
 *   - empty / null → blank, parsed_value=null, no warning
 *   - number cell  → parsed_value=number, no warning
 *   - string cell  → try to strip trailing unit text (e.g. "0.5 kgCO2e/kg"
 *                    → 0.5) and parseFloat. Success → number with possible
 *                    unit_unrecognized warning if the suffix differs from
 *                    expected_unit. Failure → null + numerical_unparseable
 *                    warning.
 *
 * For categorical / narrative:
 *   - empty → blank, null
 *   - otherwise → trimmed string, no warning
 */
function coerceCellByKind(
  rawValue: ExcelJS.CellValue,
  q: InboundTemplateQuestion,
): {
  raw: string;
  parsed: number | string | null;
  isBlank: boolean;
  warning: ImportPreviewWarning | null;
} {
  const rawStr = cellToString(rawValue);
  const trimmed = rawStr.trim();
  const isBlank = trimmed === '';

  if (q.kind !== 'numerical') {
    return {
      raw: rawStr,
      parsed: isBlank ? null : trimmed,
      isBlank,
      warning: null,
    };
  }

  // Numerical from here.
  if (isBlank) {
    return { raw: rawStr, parsed: null, isBlank: true, warning: null };
  }

  if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
    return { raw: rawStr, parsed: rawValue, isBlank: false, warning: null };
  }

  // String path: try to extract a leading number, optionally followed by
  // a unit suffix. We accept `1234`, `1234.56`, `1,234.56`, `1234 kgCO2e`,
  // `1234kgCO2e/kg`. The leading number is what we keep.
  const m = trimmed.match(/^[+-]?[\d,]+(?:\.\d+)?/);
  if (!m) {
    return {
      raw: rawStr,
      parsed: null,
      isBlank: false,
      warning: {
        // question_id is filled in by the service layer once it joins
        // ParsedXlsxAnswer → question row. The parser doesn't know.
        question_id: null,
        kind: 'numerical_unparseable',
        detail: `Could not parse a numerical value from "${trimmed}" for position ${q.position}.`,
      },
    };
  }
  const numericStr = m[0].replace(/,/g, '');
  const numericVal = Number.parseFloat(numericStr);
  if (!Number.isFinite(numericVal)) {
    return {
      raw: rawStr,
      parsed: null,
      isBlank: false,
      warning: {
        question_id: null,
        kind: 'numerical_unparseable',
        detail: `Could not parse "${trimmed}" as a finite number for position ${q.position}.`,
      },
    };
  }

  // Check for an unrecognized unit suffix. If the supplier typed
  // "0.5 kgCO2/kg" instead of our expected "kgCO2e/kg" we shouldn't
  // silently accept it as the same thing.
  const suffix = trimmed.slice(m[0].length).trim();
  let warning: ImportPreviewWarning | null = null;
  if (suffix !== '' && q.expected_unit !== null) {
    const normalized = suffix.toLowerCase().replace(/\s+/g, '');
    const expectedNorm = q.expected_unit.toLowerCase().replace(/\s+/g, '');
    if (!normalized.includes(expectedNorm) && !expectedNorm.includes(normalized)) {
      warning = {
        question_id: null,
        kind: 'unit_unrecognized',
        detail: `Cell unit "${suffix}" does not match expected "${q.expected_unit}" for position ${q.position}.`,
      };
    }
  }

  return { raw: rawStr, parsed: numericVal, isBlank: false, warning };
}

/**
 * Lossy-but-good-enough conversion of an ExcelJS cell value to a display
 * string. Rich-text cells get their plain-text concatenation; formula
 * cells get their `result`; everything else uses `String()`.
 */
function cellToString(v: ExcelJS.CellValue): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    // Rich text: { richText: [{ text }, ...] }
    const rt = (v as { richText?: Array<{ text: string }> }).richText;
    if (Array.isArray(rt)) return rt.map((r) => r.text).join('');
    // Formula: { result }
    const result = (v as { result?: unknown }).result;
    if (result != null) return cellToString(result as ExcelJS.CellValue);
    // Hyperlink: { text, hyperlink }
    const text = (v as { text?: string }).text;
    if (typeof text === 'string') return text;
  }
  return String(v);
}

// ---------------------------------------------------------------------------
// Tagged errors for the parser hard-failure modes. Plain Error subclasses
// match the inbound-questionnaire-service style — service layer can
// instanceof-check + map to IPC-friendly messages in T9.
// ---------------------------------------------------------------------------

export class InboundTemplateMissingSentinels extends Error {
  readonly _tag = 'InboundTemplateMissingSentinels' as const;
  constructor() {
    super('Imported workbook has no __sentinels sheet — not a CarbonInk template.');
  }
}

export class InboundTemplateMismatch extends Error {
  readonly _tag = 'InboundTemplateMismatch' as const;
  constructor(
    public readonly details: {
      expectedKind: string;
      expectedVersion: string;
      seenKind: string;
      seenVersion: string;
    },
  ) {
    super(
      `Template fingerprint mismatch: expected ${details.expectedKind}@${details.expectedVersion}, ` +
        `saw ${details.seenKind}@${details.seenVersion}.`,
    );
  }
}

export class InboundQuestionnaireMismatch extends Error {
  readonly _tag = 'InboundQuestionnaireMismatch' as const;
  constructor(public readonly details: { expected: string; seen: string }) {
    super(
      `Questionnaire ID mismatch: expected ${details.expected}, saw ${details.seen}. ` +
        'This xlsx belongs to a different questionnaire.',
    );
  }
}

export class InboundPeriodMismatch extends Error {
  readonly _tag = 'InboundPeriodMismatch' as const;
  constructor(public readonly details: { expected: number; seen: string | null }) {
    super(
      `Reporting period mismatch: expected ${details.expected}, saw ${details.seen ?? '<blank>'}.`,
    );
  }
}
