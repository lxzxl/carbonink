import { autoDetectMapping, validateRows } from '@main/services/ef-import/mapping';
import type { EfImportMapping } from '@shared/types';
import { describe, expect, it } from 'vitest';

const FULL_MAPPING: EfImportMapping = {
  name_zh: 0,
  scope: 1,
  year: 2,
  input_unit: 3,
  co2e_kg_per_unit: 4,
};

function rowsOf(...cellRows: string[][]): Array<{ row: number; cells: string[] }> {
  return cellRows.map((cells, i) => ({ row: i + 2, cells }));
}

describe('autoDetectMapping', () => {
  it('maps canonical template headers verbatim', () => {
    const mapping = autoDetectMapping([
      'factor_code',
      'name_zh',
      'name_en',
      'scope',
      'category',
      'year',
      'geography',
      'input_unit',
      'co2e_kg_per_unit',
      'gwp_basis',
    ]);
    expect(mapping).toMatchObject({
      factor_code: 0,
      name_zh: 1,
      name_en: 2,
      scope: 3,
      category: 4,
      year: 5,
      geography: 6,
      input_unit: 7,
      co2e_kg_per_unit: 8,
      gwp_basis: 9,
    });
  });

  it('maps Chinese headers with punctuation/spacing noise', () => {
    const mapping = autoDetectMapping([
      '因子编码',
      '中文名称',
      '范围',
      '年 份',
      '计量单位',
      '排放因子值',
      '地区',
    ]);
    expect(mapping).toMatchObject({
      factor_code: 0,
      name_zh: 1,
      scope: 2,
      year: 3,
      input_unit: 4,
      co2e_kg_per_unit: 5,
      geography: 6,
    });
  });

  it('claims each column once — 名称 falls to name_zh, name to name_en', () => {
    const mapping = autoDetectMapping(['名称', 'name', 'value']);
    expect(mapping.name_zh).toBe(0);
    expect(mapping.name_en).toBe(1);
    expect(mapping.co2e_kg_per_unit).toBe(2);
  });

  it('leaves unrecognized headers unmapped', () => {
    const mapping = autoDetectMapping(['whatever', '随便']);
    expect(Object.keys(mapping)).toEqual([]);
  });
});

describe('validateRows', () => {
  it('normalizes a fully valid row with defaults applied', () => {
    const { validation, validRows } = validateRows(
      rowsOf(['柴油', 'Scope 1', '2024', 'L', '2.68']),
      FULL_MAPPING,
    );
    expect(validation).toMatchObject({
      total_rows: 1,
      valid_count: 1,
      error_count: 0,
      warning_count: 1, // category_empty
    });
    const data = validRows[0]?.data;
    expect(data).toMatchObject({
      name_zh: '柴油',
      name_en: null,
      scope: 1,
      year: 2024,
      geography: 'GLOBAL',
      input_unit: 'L',
      co2e_kg_per_unit: 2.68,
      gwp_basis: 'AR6',
      ghg_protocol_path: null,
    });
    expect(data?.factor_code).toMatch(/^EF-\d{5}$/);
  });

  it('accepts 范围二 / scope2 forms and thousands-separated numbers', () => {
    const { validRows } = validateRows(
      rowsOf(['电力', '范围二', '2024', 'kWh', '1,234.5']),
      FULL_MAPPING,
    );
    expect(validRows[0]?.data).toMatchObject({ scope: 2, co2e_kg_per_unit: 1234.5 });
  });

  it('reports per-field error codes with row numbers from the file', () => {
    const { validation } = validateRows(
      rowsOf(
        ['', '1', '2024', 'kWh', '0.5'], // name_missing
        ['A', '9', '2024', 'kWh', '0.5'], // scope_invalid
        ['B', '2', 'not-a-year', 'kWh', '0.5'], // year_invalid
        ['C', '2', '2024', '', '0.5'], // unit_missing
        ['D', '2', '2024', 'kWh', 'abc'], // value_invalid
        ['E', '2', '2024', 'kWh', ''], // co2e_missing
      ),
      FULL_MAPPING,
    );
    expect(validation.valid_count).toBe(0);
    expect(validation.errors).toEqual([
      { row: 2, code: 'name_missing' },
      { row: 3, code: 'scope_invalid', detail: '9' },
      { row: 4, code: 'year_invalid', detail: 'not-a-year' },
      { row: 5, code: 'unit_missing' },
      { row: 6, code: 'value_invalid', detail: 'abc' },
      { row: 7, code: 'co2e_missing' },
    ]);
  });

  it('flags in-file duplicate (factor_code, year, geography) keys', () => {
    const mapping: EfImportMapping = { ...FULL_MAPPING, factor_code: 5 };
    const { validation, validRows } = validateRows(
      rowsOf(
        ['柴油', '1', '2024', 'L', '2.68', 'DIESEL'],
        ['柴油2', '1', '2024', 'L', '2.7', 'DIESEL'],
      ),
      mapping,
    );
    expect(validRows).toHaveLength(1);
    expect(validation.errors[0]).toMatchObject({ row: 3, code: 'duplicate_key' });
  });

  it('warns on unknown units without blocking the row', () => {
    const { validation, validRows } = validateRows(
      rowsOf(['柴油', '1', '2024', '桶', '2.68']),
      FULL_MAPPING,
      { knownUnits: new Set(['L', 'kWh']) },
    );
    expect(validRows).toHaveLength(1);
    expect(validation.warnings).toContainEqual({ row: 2, code: 'unit_unknown', detail: '桶' });
  });

  it('rejects invalid gwp_basis but defaults blank to AR6', () => {
    const mapping: EfImportMapping = { ...FULL_MAPPING, gwp_basis: 5 };
    const { validation, validRows } = validateRows(
      rowsOf(
        ['A', '1', '2024', 'L', '1', 'ar5'],
        ['B', '1', '2024', 'L', '1', ''],
        ['C', '1', '2024', 'L', '1', 'AR4'],
      ),
      mapping,
    );
    expect(validRows.map((r) => r.data.gwp_basis)).toEqual(['AR5', 'AR6']);
    expect(validation.errors[0]).toMatchObject({ code: 'gwp_invalid', detail: 'AR4' });
  });

  it('caps reported issue lists while keeping full counts', () => {
    const bad = Array.from({ length: 205 }, () => ['', '1', '2024', 'kWh', '1']);
    const { validation } = validateRows(rowsOf(...bad), FULL_MAPPING);
    expect(validation.error_count).toBe(205);
    expect(validation.errors).toHaveLength(200);
  });

  it('keeps only the first N sample rows', () => {
    const good = Array.from({ length: 8 }, (_, i) => [`因子${i}`, '1', '2024', 'kWh', '1.5']);
    const { validation } = validateRows(rowsOf(...good), FULL_MAPPING);
    expect(validation.valid_count).toBe(8);
    expect(validation.sample).toHaveLength(5);
  });
});
