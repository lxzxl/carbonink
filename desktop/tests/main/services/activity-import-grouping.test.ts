import {
  buildGroups,
  detectAmountOutliers,
  groupKeyOf,
  normalizeDescription,
  type ResolvedImportRow,
} from '@main/services/activity-import/grouping';
import { describe, expect, it } from 'vitest';

let seq = 0;
function row(partial: Partial<ResolvedImportRow>): ResolvedImportRow {
  seq += 1;
  return {
    row: seq + 1,
    source_name: '锅炉房',
    description: '柴油',
    amount: 100,
    unit: 'L',
    occurred_at_start: null,
    occurred_at_end: null,
    notes: null,
    source_id: 'src-1',
    ...partial,
  };
}

describe('normalizeDescription / groupKeyOf', () => {
  it('merges case and whitespace variants, keeps distinct text apart', () => {
    expect(normalizeDescription('  柴油   叉车 ')).toBe('柴油 叉车');
    expect(groupKeyOf('Diesel  Forklift', 'L', 's')).toBe(groupKeyOf('diesel forklift', 'l', 's'));
    expect(groupKeyOf('柴油', 'L', 's')).not.toBe(groupKeyOf('汽油', 'L', 's'));
  });

  it('splits identical text by unit and by source', () => {
    expect(groupKeyOf('柴油', 'L', 's1')).not.toBe(groupKeyOf('柴油', 'kg', 's1'));
    expect(groupKeyOf('柴油', 'L', 's1')).not.toBe(groupKeyOf('柴油', 'L', 's2'));
  });
});

describe('buildGroups', () => {
  it('folds rows into groups with counts, totals, and first-seen description', () => {
    const rows = [
      row({ description: '柴油 叉车', amount: 100 }),
      row({ description: '柴油  叉车', amount: 50 }),
      row({ description: '电费', unit: 'kWh', amount: 1000, source_id: 'src-2' }),
    ];
    const groups = buildGroups(rows, (id) => (id === 'src-1' ? '锅炉房' : '办公楼'));
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({
      description: '柴油 叉车',
      unit: 'L',
      source_id: 'src-1',
      source_name: '锅炉房',
      row_count: 2,
      amount_total: 150,
      status: 'pending',
      ef: null,
      fuel_code: null,
    });
    expect(groups[1]).toMatchObject({ description: '电费', source_name: '办公楼', row_count: 1 });
  });
});

describe('detectAmountOutliers', () => {
  it('flags >10× deviations from the group median in both directions', () => {
    const rows = [
      row({ amount: 100 }),
      row({ amount: 110 }),
      row({ amount: 90 }),
      row({ amount: 105 }),
      row({ amount: 2000, row: 99 }),
      row({ amount: 5, row: 100 }),
    ];
    const issues = detectAmountOutliers(rows);
    expect(issues).toEqual([
      { row: 99, code: 'amount_outlier', detail: expect.stringContaining('2000') },
      { row: 100, code: 'amount_outlier', detail: expect.stringContaining('5') },
    ]);
  });

  it('stays silent for groups below the minimum size', () => {
    const rows = [row({ amount: 1 }), row({ amount: 10_000 }), row({ amount: 2 })];
    expect(detectAmountOutliers(rows)).toEqual([]);
  });

  it('treats each group independently', () => {
    const a = [100, 100, 100, 100, 100].map((amount) => row({ amount }));
    const b = [5000, 5000, 5000, 5000, 5000].map((amount) =>
      row({ amount, description: '电费', unit: 'kWh' }),
    );
    expect(detectAmountOutliers([...a, ...b])).toEqual([]);
  });

  it('honors a custom ratio (spec 2026-07-23-import-outlier-threshold)', () => {
    const rows = [
      row({ amount: 100 }),
      row({ amount: 110 }),
      row({ amount: 90 }),
      row({ amount: 105 }),
      row({ amount: 400, row: 42 }),
    ];
    // 400 is 4× the median: silent at the default 10×, flagged at 3×.
    expect(detectAmountOutliers(rows)).toEqual([]);
    expect(detectAmountOutliers(rows, 3)).toEqual([
      { row: 42, code: 'amount_outlier', detail: expect.stringContaining('400') },
    ]);
  });
});
