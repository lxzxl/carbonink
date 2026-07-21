import {
  autoDetectActivityMapping,
  parseImportDate,
  validateActivityRows,
} from '@main/services/activity-import/mapping';
import type { ActivityImportMapping } from '@shared/types';
import { describe, expect, it } from 'vitest';

const FULL_MAPPING: ActivityImportMapping = {
  source_name: 0,
  description: 1,
  amount: 2,
  unit: 3,
  occurred_at_start: 4,
  occurred_at_end: 5,
  notes: 6,
};

function rowsOf(...cellRows: string[][]): Array<{ row: number; cells: string[] }> {
  return cellRows.map((cells, i) => ({ row: i + 2, cells }));
}

describe('autoDetectActivityMapping', () => {
  it('maps canonical English headers verbatim', () => {
    const mapping = autoDetectActivityMapping([
      'source_name',
      'description',
      'amount',
      'unit',
      'occurred_at_start',
      'occurred_at_end',
      'notes',
    ]);
    expect(mapping).toMatchObject({
      source_name: 0,
      description: 1,
      amount: 2,
      unit: 3,
      occurred_at_start: 4,
      occurred_at_end: 5,
      notes: 6,
    });
  });

  it('maps a typical Chinese ledger; single 日期 column claims the start date', () => {
    const mapping = autoDetectActivityMapping(['排放源', '摘要', '数量', '单位', '日期', '备注']);
    expect(mapping).toMatchObject({
      source_name: 0,
      description: 1,
      amount: 2,
      unit: 3,
      occurred_at_start: 4,
      notes: 5,
    });
    expect(mapping.occurred_at_end).toBeUndefined();
  });

  it('never auto-maps 金额 as the activity amount', () => {
    const mapping = autoDetectActivityMapping(['排放源', '品名', '金额', '单位']);
    expect(mapping.amount).toBeUndefined();
  });

  it('lets 排放源名称 claim source_name so the 名称 catch-all falls to description', () => {
    const mapping = autoDetectActivityMapping(['排放源名称', '名称', '用量', '计量单位']);
    expect(mapping).toMatchObject({ source_name: 0, description: 1, amount: 2, unit: 3 });
  });
});

describe('parseImportDate', () => {
  it('accepts year-first shapes and normalizes to YYYY-MM-DD', () => {
    expect(parseImportDate('2025-03-01')).toBe('2025-03-01');
    expect(parseImportDate('2025/3/1')).toBe('2025-03-01');
    expect(parseImportDate('2025.3.1')).toBe('2025-03-01');
    expect(parseImportDate('2025年3月1日')).toBe('2025-03-01');
  });

  it('accepts exceljs toISOString output (xlsx date cells)', () => {
    expect(parseImportDate('2025-03-01T00:00:00.000Z')).toBe('2025-03-01');
  });

  it('accepts Excel serial dates', () => {
    expect(parseImportDate('45658')).toBe('2025-01-01');
  });

  it('rejects ambiguous day-first/month-first and impossible dates', () => {
    expect(parseImportDate('03/04/2025')).toBeNull();
    expect(parseImportDate('2025-02-30')).toBeNull();
    expect(parseImportDate('not a date')).toBeNull();
  });
});

describe('validateActivityRows', () => {
  it('normalizes a fully valid row', () => {
    const { validation, validRows } = validateActivityRows(
      rowsOf(['锅炉房', '天然气 采暖', '1,234.5', 'm³', '2025-01-01', '2025-01-31', '一月账单']),
      FULL_MAPPING,
    );
    expect(validation.valid_count).toBe(1);
    expect(validation.error_count).toBe(0);
    expect(validRows[0]).toEqual({
      row: 2,
      source_name: '锅炉房',
      description: '天然气 采暖',
      amount: 1234.5,
      unit: 'm³',
      occurred_at_start: '2025-01-01',
      occurred_at_end: '2025-01-31',
      notes: '一月账单',
    });
  });

  it('reports every missing required cell and skips the row', () => {
    const { validation, validRows } = validateActivityRows(
      rowsOf(['', '', '', '', '', '', '']),
      FULL_MAPPING,
    );
    expect(validRows).toHaveLength(0);
    const codes = validation.errors.map((e) => e.code).sort();
    expect(codes).toEqual([
      'amount_missing',
      'description_missing',
      'source_name_missing',
      'unit_missing',
    ]);
  });

  it('rejects zero, negative, and non-numeric amounts', () => {
    const { validation } = validateActivityRows(
      rowsOf(
        ['A', 'x', '0', 'kWh', '', '', ''],
        ['A', 'x', '-5', 'kWh', '', '', ''],
        ['A', 'x', 'abc', 'kWh', '', '', ''],
      ),
      FULL_MAPPING,
    );
    expect(validation.valid_count).toBe(0);
    expect(validation.errors.every((e) => e.code === 'amount_invalid')).toBe(true);
    expect(validation.error_count).toBe(3);
  });

  it('flags unparseable dates and inverted ranges', () => {
    const { validation } = validateActivityRows(
      rowsOf(
        ['A', 'x', '1', 'kWh', '31/01/2025', '', ''],
        ['A', 'x', '1', 'kWh', '2025-02-01', '2025-01-01', ''],
      ),
      FULL_MAPPING,
    );
    expect(validation.errors.map((e) => e.code)).toEqual(['date_invalid', 'date_range_invalid']);
  });

  it('collapses a one-sided date to a single-day range', () => {
    const { validRows } = validateActivityRows(
      rowsOf(['A', 'x', '1', 'kWh', '2025-06-15', '', '']),
      FULL_MAPPING,
    );
    expect(validRows[0]?.occurred_at_start).toBe('2025-06-15');
    expect(validRows[0]?.occurred_at_end).toBe('2025-06-15');
  });

  it('warns period_mismatch only for explicit out-of-period dates', () => {
    const { validation } = validateActivityRows(
      rowsOf(
        ['A', 'x', '1', 'kWh', '2024-12-15', '2024-12-31', ''],
        ['A', 'y', '1', 'kWh', '', '', ''],
      ),
      FULL_MAPPING,
      { period: { start: '2025-01-01', end: '2025-12-31' } },
    );
    expect(validation.warnings).toEqual([
      { row: 2, code: 'period_mismatch', detail: '2024-12-15~2024-12-31' },
    ]);
    expect(validation.valid_count).toBe(2);
  });

  it('marks second occurrences as duplicate_in_file with the first row in detail', () => {
    const { validation } = validateActivityRows(
      rowsOf(
        ['A', '电费', '100', 'kWh', '2025-01-01', '2025-01-31', ''],
        ['A', '电费', '100', 'kWh', '2025-01-01', '2025-01-31', ''],
      ),
      FULL_MAPPING,
    );
    expect(validation.warnings).toEqual([{ row: 3, code: 'duplicate_in_file', detail: '2' }]);
    expect(validation.valid_count).toBe(2);
  });

  it('stores empty notes as null', () => {
    const { validRows } = validateActivityRows(
      rowsOf(['A', 'x', '1', 'kWh', '', '', '']),
      FULL_MAPPING,
    );
    expect(validRows[0]?.notes).toBeNull();
    expect(validRows[0]?.occurred_at_start).toBeNull();
  });
});
