import type {
  ActivityImportField,
  ActivityImportMapping,
  ActivityImportRow,
  ActivityImportRowIssue,
  ActivityImportValidation,
} from '@shared/types.js';

/** How many issues of each kind ride the IPC payload (full counts still reported). */
const MAX_REPORTED_ISSUES = 200;
/** How many normalized valid rows the preview pane shows. */
const SAMPLE_SIZE = 5;

/**
 * Header aliases per target field, in normalized form (see normalizeHeader).
 * Mirrors the EF-import detection engine: declaration order wins, one column
 * per field, specific aliases before catch-alls. A single "日期"/"date"
 * column claims occurred_at_start (end falls back to start = single-day
 * rows), which matches how consultant ledgers usually carry one date column.
 *
 * Deliberately absent: "金额" — a monetary column mapped as activity amount
 * would silently import spend as quantity; money ledgers must be hand-mapped.
 */
const FIELD_ALIASES: ReadonlyArray<{ field: ActivityImportField; aliases: readonly string[] }> = [
  {
    field: 'source_name',
    aliases: ['sourcename', 'emissionsource', 'source', 'facility', '排放源名称', '排放源', '源名称', '设施', '设备'],
  },
  {
    field: 'description',
    aliases: ['description', 'activity', 'item', 'detail', '活动描述', '描述', '说明', '摘要', '品名', '项目', '名称'],
  },
  {
    field: 'amount',
    aliases: ['amount', 'quantity', 'qty', '活动数据', '活动量', '数量', '用量', '消耗量', '数值'],
  },
  { field: 'unit', aliases: ['unit', '单位', '计量单位', '活动单位'] },
  {
    field: 'occurred_at_start',
    aliases: ['occurredatstart', 'startdate', 'datefrom', 'start', '开始日期', '起始日期', '开始时间', '日期', 'date'],
  },
  {
    field: 'occurred_at_end',
    aliases: ['occurredatend', 'enddate', 'dateto', 'end', '结束日期', '截止日期', '结束时间'],
  },
  { field: 'notes', aliases: ['notes', 'note', 'remarks', 'remark', '备注', '注'] },
];

function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .replace(/[\s_\-()（）:：/\\.]/gu, '')
    .trim();
}

/**
 * Auto-detect the column mapping from the header row. Same engine contract
 * as the EF import: each column claimed by at most one field, declaration
 * order beats catch-alls.
 */
export function autoDetectActivityMapping(headers: string[]): ActivityImportMapping {
  const normalized = headers.map(normalizeHeader);
  const claimed = new Set<number>();
  const mapping: ActivityImportMapping = {};
  for (const { field, aliases } of FIELD_ALIASES) {
    for (let col = 0; col < normalized.length; col += 1) {
      if (claimed.has(col)) continue;
      const header = normalized[col];
      if (header !== '' && aliases.includes(header as string)) {
        mapping[field] = col;
        claimed.add(col);
        break;
      }
    }
  }
  return mapping;
}

/**
 * Amount cell → strictly positive finite number. Strips thousands-separator
 * commas in unambiguous `1,234.5` form. Unlike EF factor values, an activity
 * amount can never legitimately be zero or negative.
 */
function parseAmount(raw: string): number | null {
  let text = raw;
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/u.test(text)) text = text.replace(/,/gu, '');
  if (text === '') return null;
  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

/** Days between 1899-12-30 (Excel's serial epoch) and 1970-01-01. */
const EXCEL_EPOCH_OFFSET_DAYS = 25_569;
const MS_PER_DAY = 86_400_000;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** True iff (y, m, d) is a real calendar date. */
function isRealDate(y: number, m: number, d: number): boolean {
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
  );
}

/**
 * Date cell → ISO `YYYY-MM-DD`. Accepts the shapes that are unambiguous:
 * - `YYYY-MM-DD` / `YYYY/M/D` / `YYYY.M.D` (year-first), with an optional
 *   `T…` time suffix (exceljs stringifies xlsx date cells via toISOString)
 * - `YYYY年M月D日`
 * - a raw Excel serial number (CSV exports sometimes leak these)
 * Day-first vs month-first forms (`03/04/2025`) are rejected as ambiguous.
 */
export function parseImportDate(raw: string): string | null {
  const text = raw.trim();
  if (text === '') return null;

  const ymd = text.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?(?:[T\s].*)?$/u);
  if (ymd) {
    const y = Number(ymd[1]);
    const m = Number(ymd[2]);
    const d = Number(ymd[3]);
    if (y < 1990 || y > 2100 || !isRealDate(y, m, d)) return null;
    return `${y}-${pad2(m)}-${pad2(d)}`;
  }

  if (/^\d{5}$/u.test(text)) {
    const serial = Number(text);
    if (serial >= 20_000 && serial <= 80_000) {
      const date = new Date((serial - EXCEL_EPOCH_OFFSET_DAYS) * MS_PER_DAY);
      return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
    }
  }

  return null;
}

export type ActivityImportValidRow = ActivityImportRow;

export type ActivityImportValidationDetail = {
  /** Wire-shaped summary (capped issue lists + sample). */
  validation: ActivityImportValidation;
  /** Every normalized valid row, for the grouping + import steps. */
  validRows: ActivityImportValidRow[];
};

/**
 * Validate + normalize all data rows under a column mapping. Pure function —
 * the caller supplies the reporting-period bounds so this module stays
 * db-free and trivially testable.
 *
 * Error rows are skipped at import; warnings never block (EF-import
 * semantics). `period_mismatch` only fires for rows with explicit dates:
 * date-less rows inherit the period bounds and are in-range by construction.
 * `duplicate_in_file` marks the second and later occurrences of
 * (source, dates, amount, unit); `detail` carries the first row's number.
 */
export function validateActivityRows(
  rows: ReadonlyArray<{ row: number; cells: string[] }>,
  mapping: ActivityImportMapping,
  opts: { period?: { start: string; end: string } } = {},
): ActivityImportValidationDetail {
  const errors: ActivityImportRowIssue[] = [];
  const warnings: ActivityImportRowIssue[] = [];
  let errorCount = 0;
  let warningCount = 0;
  const validRows: ActivityImportValidRow[] = [];
  const seenKeys = new Map<string, number>();

  const pushError = (issue: ActivityImportRowIssue): void => {
    errorCount += 1;
    if (errors.length < MAX_REPORTED_ISSUES) errors.push(issue);
  };
  const pushWarning = (issue: ActivityImportRowIssue): void => {
    warningCount += 1;
    if (warnings.length < MAX_REPORTED_ISSUES) warnings.push(issue);
  };

  const cellOf = (cells: string[], field: ActivityImportField): string => {
    const col = mapping[field];
    if (col === undefined) return '';
    return (cells[col] ?? '').trim();
  };

  for (const { row, cells } of rows) {
    const rowErrors: ActivityImportRowIssue[] = [];

    const sourceName = cellOf(cells, 'source_name');
    if (sourceName === '') rowErrors.push({ row, code: 'source_name_missing' });

    const description = cellOf(cells, 'description');
    if (description === '') rowErrors.push({ row, code: 'description_missing' });

    const amountRaw = cellOf(cells, 'amount');
    let amount: number | null = null;
    if (amountRaw === '') {
      rowErrors.push({ row, code: 'amount_missing' });
    } else {
      amount = parseAmount(amountRaw);
      if (amount === null) rowErrors.push({ row, code: 'amount_invalid', detail: amountRaw });
    }

    const unit = cellOf(cells, 'unit');
    if (unit === '') rowErrors.push({ row, code: 'unit_missing' });

    const startRaw = cellOf(cells, 'occurred_at_start');
    const endRaw = cellOf(cells, 'occurred_at_end');
    let start: string | null = null;
    let end: string | null = null;
    if (startRaw !== '') {
      start = parseImportDate(startRaw);
      if (start === null) rowErrors.push({ row, code: 'date_invalid', detail: startRaw });
    }
    if (endRaw !== '') {
      end = parseImportDate(endRaw);
      if (end === null) rowErrors.push({ row, code: 'date_invalid', detail: endRaw });
    }
    // One-sided dates collapse to a single-day range.
    if (start !== null && end === null && endRaw === '') end = start;
    if (end !== null && start === null && startRaw === '') start = end;
    if (start !== null && end !== null && start > end) {
      rowErrors.push({ row, code: 'date_range_invalid', detail: `${start} > ${end}` });
    }

    if (rowErrors.length > 0) {
      for (const issue of rowErrors) pushError(issue);
      continue;
    }

    if (opts.period && start !== null && end !== null) {
      if (start < opts.period.start || end > opts.period.end) {
        pushWarning({ row, code: 'period_mismatch', detail: `${start}~${end}` });
      }
    }

    const key = JSON.stringify([
      sourceName.toLowerCase(),
      start ?? '',
      end ?? '',
      amount,
      unit.toLowerCase(),
    ]);
    const firstRow = seenKeys.get(key);
    if (firstRow !== undefined) {
      pushWarning({ row, code: 'duplicate_in_file', detail: String(firstRow) });
    } else {
      seenKeys.set(key, row);
    }

    const notes = cellOf(cells, 'notes');
    validRows.push({
      row,
      source_name: sourceName,
      description,
      amount: amount as number,
      unit,
      occurred_at_start: start,
      occurred_at_end: end,
      notes: notes === '' ? null : notes,
    });
  }

  return {
    validation: {
      total_rows: rows.length,
      valid_count: validRows.length,
      error_count: errorCount,
      warning_count: warningCount,
      errors,
      warnings,
      sample: validRows.slice(0, SAMPLE_SIZE),
    },
    validRows,
  };
}
