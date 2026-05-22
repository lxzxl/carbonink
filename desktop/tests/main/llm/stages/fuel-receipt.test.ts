import {
  type FuelReceiptExtraction,
  fuelReceiptExtraction,
  fuelReceiptStage,
} from '@main/llm/stages/fuel-receipt';
import { getStage, listStages } from '@main/llm/stages/registry';
import { describe, expect, it } from 'vitest';

/**
 * Canonical happy-path extraction shape. Branch off this baseline and
 * tweak one field per test to assert acceptance / rejection.
 */
const GOOD: FuelReceiptExtraction = {
  doc_type: 'fuel_receipt',
  supplier_name: '中国石化北京加油站',
  fuel_type: '92#汽油',
  fuel_category: 'gasoline',
  volume_l: 38.5,
  unit_price_yuan: 7.85,
  amount_yuan: 302.23,
  occurred_at: '2026-04-15',
  license_plate: '京A12345',
  confidence: 'high',
};

describe('fuelReceiptExtraction schema', () => {
  it('accepts a fully populated fuel-receipt JSON', () => {
    expect(fuelReceiptExtraction.parse(GOOD)).toEqual(GOOD);
  });

  it('accepts the two nullable fields set to null (unit_price + license_plate)', () => {
    const parsed = fuelReceiptExtraction.parse({
      ...GOOD,
      unit_price_yuan: null,
      license_plate: null,
    });
    expect(parsed.unit_price_yuan).toBeNull();
    expect(parsed.license_plate).toBeNull();
  });

  it('accepts permissive zero values for volume_l and amount_yuan (model says "I cannot read this")', () => {
    expect(() => fuelReceiptExtraction.parse({ ...GOOD, volume_l: 0 })).not.toThrow();
    expect(() => fuelReceiptExtraction.parse({ ...GOOD, amount_yuan: 0 })).not.toThrow();
  });

  it('accepts non-ISO / empty occurred_at strings (permissive)', () => {
    expect(() => fuelReceiptExtraction.parse({ ...GOOD, occurred_at: '2026/04/15' })).not.toThrow();
    expect(() => fuelReceiptExtraction.parse({ ...GOOD, occurred_at: '' })).not.toThrow();
  });

  it('rejects negative volume_l (fueling can be zero but never negative)', () => {
    expect(() => fuelReceiptExtraction.parse({ ...GOOD, volume_l: -1 })).toThrow();
  });

  it('rejects negative amount_yuan', () => {
    expect(() => fuelReceiptExtraction.parse({ ...GOOD, amount_yuan: -1 })).toThrow();
  });

  it('rejects an unknown fuel_category value', () => {
    expect(() =>
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid runtime input
      fuelReceiptExtraction.parse({ ...GOOD, fuel_category: 'rocket_fuel' } as any),
    ).toThrow();
  });

  it('accepts fuel_category = "other" (UI uses this as the fallback warning case)', () => {
    expect(() => fuelReceiptExtraction.parse({ ...GOOD, fuel_category: 'other' })).not.toThrow();
  });

  it('rejects an unknown confidence value', () => {
    expect(() =>
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid runtime input
      fuelReceiptExtraction.parse({ ...GOOD, confidence: 'maybe' } as any),
    ).toThrow();
  });

  it('rejects a doc_type other than the literal "fuel_receipt"', () => {
    expect(() =>
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid runtime input
      fuelReceiptExtraction.parse({ ...GOOD, doc_type: 'china_utility' } as any),
    ).toThrow();
  });
});

describe('fuelReceiptStage metadata', () => {
  it('exposes id="fuel_receipt.v1", version, inputType, and prompt builders', () => {
    expect(fuelReceiptStage.id).toBe('fuel_receipt.v1');
    expect(fuelReceiptStage.version).toBe('1.0.0');
    expect(fuelReceiptStage.inputType).toBe('pdf_text');
    expect(typeof fuelReceiptStage.buildPrompt).toBe('function');
    expect(typeof fuelReceiptStage.buildVisionMessages).toBe('function');
  });

  it('buildPrompt embeds the PDF text inside <receipt>...</receipt> AND includes field rules', () => {
    const prompt = fuelReceiptStage.buildPrompt('SAMPLE_FUEL_RECEIPT_TEXT_TOKEN');
    expect(prompt).toContain('Chinese fuel receipt');
    expect(prompt).toContain('SAMPLE_FUEL_RECEIPT_TEXT_TOKEN');
    expect(prompt).toContain('<receipt>');
    expect(prompt).toContain('</receipt>');
    // Field rules verbatim shared with vision path.
    expect(prompt).toContain('fuel_category');
    expect(prompt).toContain('92#汽油');
    expect(prompt).toContain('gasoline');
  });

  it('buildVisionMessages mirrors buildPrompt field rules but omits the <receipt> placeholder', () => {
    const msgs = fuelReceiptStage.buildVisionMessages?.();
    expect(msgs).toBeDefined();
    expect(msgs?.userText).toContain('Chinese fuel receipt');
    expect(msgs?.userText).toContain('fuel_category');
    expect(msgs?.userText).toContain('92#汽油');
    expect(msgs?.userText).toContain('gasoline');
    // No PDF text placeholder — image content is appended by the caller.
    expect(msgs?.userText).not.toContain('<receipt>');
  });
});

describe('fuelReceiptStage registry integration', () => {
  it('is returned by getStage("fuel_receipt.v1")', () => {
    expect(getStage('fuel_receipt.v1')).toBe(fuelReceiptStage);
  });

  it('appears in listStages()', () => {
    const ids = listStages().map((s) => s.id);
    expect(ids).toContain('fuel_receipt.v1');
    // china_utility.v1 still registered too — adding a stage shouldn't
    // displace existing ones.
    expect(ids).toContain('china_utility.v1');
  });
});
