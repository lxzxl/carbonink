import type {
  EfImportField,
  EfImportMapping,
  EfImportRowIssue,
  EfImportSampleRow,
  EfImportValidation,
} from '@shared/types.js';

/** How many issues of each kind ride the IPC payload (full counts still reported). */
const MAX_REPORTED_ISSUES = 200;
/** How many normalized valid rows the preview pane shows. */
const SAMPLE_SIZE = 5;

/**
 * Header aliases per target field, in normalized form (see normalizeHeader):
 * lowercased, whitespace/underscore/hyphen/parens/colons stripped. Both the
 * English canonical column names (used by the downloadable template) and the
 * Chinese labels a consultant's own spreadsheet would plausibly carry.
 *
 * Detection order = declaration order; the first unclaimed column matching
 * an alias wins, so more-specific fields (e.g. name_zh's 中文名称) are listed
 * before catch-alls (名称).
 */
const FIELD_ALIASES: ReadonlyArray<{ field: EfImportField; aliases: readonly string[] }> = [
  { field: 'factor_code', aliases: ['factorcode', 'code', '因子编码', '因子代码', '编码', '代码'] },
  {
    field: 'name_zh',
    aliases: ['namezh', 'zhname', '中文名称', '中文名', '名称中文', '因子名称', '名称'],
  },
  {
    field: 'name_en',
    aliases: ['nameen', 'enname', 'englishname', '英文名称', '英文名', '名称英文', 'name'],
  },
  { field: 'scope', aliases: ['scope', '范围'] },
  { field: 'category', aliases: ['category', '类别', '分类', '类目'] },
  { field: 'year', aliases: ['year', '年份', '年度', '年'] },
  {
    field: 'geography',
    aliases: ['geography', 'region', 'geo', '地区', '区域', '地理', '国家地区', '国家'],
  },
  { field: 'input_unit', aliases: ['inputunit', 'unit', '单位', '活动单位', '计量单位'] },
  {
    field: 'co2e_kg_per_unit',
    aliases: [
      'co2ekgperunit',
      'co2e',
      'kgco2e',
      'co2ekg',
      '排放因子值',
      '排放因子',
      '因子值',
      '因子数值',
      'factorvalue',
      'value',
      '数值',
    ],
  },
  { field: 'ch4_kg_per_unit', aliases: ['ch4kgperunit', 'ch4'] },
  { field: 'n2o_kg_per_unit', aliases: ['n2okgperunit', 'n2o'] },
  { field: 'hfc_kg_per_unit', aliases: ['hfckgperunit', 'hfc', 'hfcs'] },
  { field: 'pfc_kg_per_unit', aliases: ['pfckgperunit', 'pfc', 'pfcs'] },
  { field: 'sf6_kg_per_unit', aliases: ['sf6kgperunit', 'sf6'] },
  { field: 'nf3_kg_per_unit', aliases: ['nf3kgperunit', 'nf3'] },
  {
    field: 'biogenic_co2_factor',
    aliases: ['biogenicco2factor', 'biogenicco2', 'biogenic', '生物源co2', '生物源因子', '生物源'],
  },
  { field: 'gwp_basis', aliases: ['gwpbasis', 'gwp', 'gwp基准', 'gwp版本'] },
  { field: 'description_zh', aliases: ['descriptionzh', '中文描述', '描述中文', '描述', '说明'] },
  {
    field: 'description_en',
    aliases: ['descriptionen', 'englishdescription', '英文描述', 'description'],
  },
  { field: 'notes', aliases: ['notes', 'note', '备注'] },
  {
    field: 'citation_url',
    aliases: ['citationurl', 'citation', 'url', '引用链接', '引用', '来源链接', '链接'],
  },
];

function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .replace(/[\s_\-()（）:：/\\.]/gu, '')
    .trim();
}

/**
 * Auto-detect the column mapping from the header row. Each column is claimed
 * by at most one field; fields are matched in declaration order so specific
 * aliases beat catch-alls.
 */
export function autoDetectMapping(headers: string[]): EfImportMapping {
  const normalized = headers.map(normalizeHeader);
  const claimed = new Set<number>();
  const mapping: EfImportMapping = {};
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

/** Scope cell → 1|2|3. Accepts `1`, `Scope 1`, `范围1`, `范围一` (any case/space). */
function parseScope(raw: string): 1 | 2 | 3 | null {
  const compact = raw.toLowerCase().replace(/[\s]/gu, '');
  const match = compact.match(/^(?:scope|范围)?([123一二三])$/u);
  if (!match) return null;
  const digit = match[1] as string;
  if (digit === '1' || digit === '一') return 1;
  if (digit === '2' || digit === '二') return 2;
  return 3;
}

/**
 * Numeric cell → finite number. Strips thousands-separator commas when the
 * string is unambiguously in `1,234.5` form. Negative values are allowed
 * (removal / biogenic factors legitimately go below zero).
 */
function parseNumber(raw: string): number | null {
  let text = raw;
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/u.test(text)) text = text.replace(/,/gu, '');
  if (text === '') return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/** Year cell → integer within a sane inventory range. */
function parseYear(raw: string): number | null {
  const value = Number(raw);
  if (!Number.isInteger(value)) return null;
  if (value < 1990 || value > 2100) return null;
  return value;
}

export type EfImportValidRow = { row: number; data: EfImportSampleRow };

export type EfImportValidationDetail = {
  /** Wire-shaped summary (capped issue lists + sample). */
  validation: EfImportValidation;
  /** Every normalized valid row, for the import step. */
  validRows: EfImportValidRow[];
};

/**
 * Validate + normalize all data rows under a column mapping. Pure function:
 * the caller supplies the known-unit set (for the advisory unit warning) so
 * this module stays db-free and trivially testable.
 *
 * Error rows are skipped at import time; warnings never block. Duplicate
 * detection keys on (factor_code, year, geography) — source and
 * dataset_version are constant within one library import, so that triple is
 * exactly the part of the composite PK the file controls.
 */
export function validateRows(
  rows: ReadonlyArray<{ row: number; cells: string[] }>,
  mapping: EfImportMapping,
  opts: { knownUnits?: ReadonlySet<string> } = {},
): EfImportValidationDetail {
  const errors: EfImportRowIssue[] = [];
  const warnings: EfImportRowIssue[] = [];
  let errorCount = 0;
  let warningCount = 0;
  const validRows: EfImportValidRow[] = [];
  const seenKeys = new Set<string>();

  const pushError = (issue: EfImportRowIssue): void => {
    errorCount += 1;
    if (errors.length < MAX_REPORTED_ISSUES) errors.push(issue);
  };
  const pushWarning = (issue: EfImportRowIssue): void => {
    warningCount += 1;
    if (warnings.length < MAX_REPORTED_ISSUES) warnings.push(issue);
  };

  const cellOf = (cells: string[], field: EfImportField): string => {
    const col = mapping[field];
    if (col === undefined) return '';
    return (cells[col] ?? '').trim();
  };

  for (let idx = 0; idx < rows.length; idx += 1) {
    const { row, cells } = rows[idx] as { row: number; cells: string[] };
    const rowErrors: EfImportRowIssue[] = [];

    const nameZh = cellOf(cells, 'name_zh');
    const nameEn = cellOf(cells, 'name_en');
    if (nameZh === '' && nameEn === '') {
      rowErrors.push({ row, code: 'name_missing' });
    }

    const scopeRaw = cellOf(cells, 'scope');
    let scope: 1 | 2 | 3 | null = null;
    if (scopeRaw === '') {
      rowErrors.push({ row, code: 'scope_missing' });
    } else {
      scope = parseScope(scopeRaw);
      if (scope === null) rowErrors.push({ row, code: 'scope_invalid', detail: scopeRaw });
    }

    const yearRaw = cellOf(cells, 'year');
    let year: number | null = null;
    if (yearRaw === '') {
      rowErrors.push({ row, code: 'year_missing' });
    } else {
      year = parseYear(yearRaw);
      if (year === null) rowErrors.push({ row, code: 'year_invalid', detail: yearRaw });
    }

    const inputUnit = cellOf(cells, 'input_unit');
    if (inputUnit === '') rowErrors.push({ row, code: 'unit_missing' });

    const co2eRaw = cellOf(cells, 'co2e_kg_per_unit');
    let co2e: number | null = null;
    if (co2eRaw === '') {
      rowErrors.push({ row, code: 'co2e_missing' });
    } else {
      co2e = parseNumber(co2eRaw);
      if (co2e === null) rowErrors.push({ row, code: 'value_invalid', detail: co2eRaw });
    }

    const gas = (field: EfImportField): number | null => {
      const raw = cellOf(cells, field);
      if (raw === '') return null;
      const value = parseNumber(raw);
      if (value === null) {
        rowErrors.push({ row, code: 'value_invalid', detail: raw });
        return null;
      }
      return value;
    };
    const ch4 = gas('ch4_kg_per_unit');
    const n2o = gas('n2o_kg_per_unit');
    const hfc = gas('hfc_kg_per_unit');
    const pfc = gas('pfc_kg_per_unit');
    const sf6 = gas('sf6_kg_per_unit');
    const nf3 = gas('nf3_kg_per_unit');
    const biogenic = gas('biogenic_co2_factor');

    const gwpRaw = cellOf(cells, 'gwp_basis');
    let gwp: 'AR5' | 'AR6' = 'AR6';
    if (gwpRaw !== '') {
      const upper = gwpRaw.toUpperCase();
      if (upper === 'AR5' || upper === 'AR6') gwp = upper;
      else rowErrors.push({ row, code: 'gwp_invalid', detail: gwpRaw });
    }

    // factor_code: user-supplied or generated from the position in the file.
    // Generated codes are only stable within one import, which is fine —
    // libraries replace wholesale and pins are snapshots (spec D4).
    const codeRaw = cellOf(cells, 'factor_code');
    const factorCode = codeRaw !== '' ? codeRaw : `EF-${String(idx + 1).padStart(5, '0')}`;

    const geographyRaw = cellOf(cells, 'geography');
    const geography = geographyRaw !== '' ? geographyRaw : 'GLOBAL';

    if (rowErrors.length === 0 && year !== null) {
      const key = JSON.stringify([factorCode, year, geography]);
      if (seenKeys.has(key)) {
        rowErrors.push({
          row,
          code: 'duplicate_key',
          detail: `${factorCode} / ${year} / ${geography}`,
        });
      } else {
        seenKeys.add(key);
      }
    }

    if (rowErrors.length > 0) {
      for (const issue of rowErrors) pushError(issue);
      continue;
    }

    const category = cellOf(cells, 'category');
    if (category === '') {
      pushWarning({ row, code: 'category_empty' });
    }
    if (opts.knownUnits && opts.knownUnits.size > 0 && !opts.knownUnits.has(inputUnit)) {
      pushWarning({ row, code: 'unit_unknown', detail: inputUnit });
    }

    const optional = (field: EfImportField): string | null => {
      const raw = cellOf(cells, field);
      return raw === '' ? null : raw;
    };

    validRows.push({
      row,
      data: {
        factor_code: factorCode,
        year: year as number,
        geography,
        scope: scope as 1 | 2 | 3,
        category: category === '' ? null : category,
        ghg_protocol_path: null,
        input_unit: inputUnit,
        co2e_kg_per_unit: co2e as number,
        ch4_kg_per_unit: ch4,
        n2o_kg_per_unit: n2o,
        hfc_kg_per_unit: hfc,
        pfc_kg_per_unit: pfc,
        sf6_kg_per_unit: sf6,
        nf3_kg_per_unit: nf3,
        gwp_basis: gwp,
        name_zh: nameZh === '' ? null : nameZh,
        name_en: nameEn === '' ? null : nameEn,
        description_zh: optional('description_zh'),
        description_en: optional('description_en'),
        notes: optional('notes'),
        biogenic_co2_factor: biogenic,
        citation_url: optional('citation_url'),
      },
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
      sample: validRows.slice(0, SAMPLE_SIZE).map((r) => r.data),
    },
    validRows,
  };
}
