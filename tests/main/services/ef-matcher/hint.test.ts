import { extractHint } from '@main/services/ef-matcher/hint';
import { describe, expect, it } from 'vitest';

describe('extractHint', () => {
  it('china_utility.v1 → supplier_name', () => {
    expect(extractHint('china_utility.v1', { supplier_name: '国家电网北京' })).toContain('国家电网北京');
  });

  it('fuel_receipt.v1 → fuel_type + fuel_category', () => {
    const out = extractHint('fuel_receipt.v1', { fuel_type: '柴油', fuel_category: 'diesel' });
    expect(out).toContain('柴油');
    expect(out).toContain('diesel');
  });

  it('freight.v1 → mode + vehicle_class + supplier_name', () => {
    const out = extractHint('freight.v1', { mode: 'road', vehicle_class: '重型卡车', supplier_name: '顺丰' });
    expect(out).toContain('road');
    expect(out).toContain('重型卡车');
    expect(out).toContain('顺丰');
  });

  it('purchase.v1 → category + item_description + supplier_name', () => {
    const out = extractHint('purchase.v1', { category: 'raw_material', item_description: '冷轧钢板', supplier_name: '宝钢' });
    expect(out).toContain('raw_material');
    expect(out).toContain('冷轧钢板');
    expect(out).toContain('宝钢');
  });

  it('travel.v1 → mode + travel_class + supplier_name', () => {
    const out = extractHint('travel.v1', { mode: 'air', travel_class: '经济舱', supplier_name: '国航' });
    expect(out).toContain('air');
    expect(out).toContain('经济舱');
    expect(out).toContain('国航');
  });

  it('returns empty string for unknown stage', () => {
    expect(extractHint('unknown.v9', { foo: 'bar' })).toBe('');
  });

  it('skips null/undefined/empty fields', () => {
    const out = extractHint('freight.v1', { mode: 'road', vehicle_class: null, supplier_name: '' });
    expect(out).toContain('road');
    expect(out).not.toContain('null');
    expect(out.split(/\s+/).filter(Boolean).length).toBe(1);
  });
});
