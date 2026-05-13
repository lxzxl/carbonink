import {
  type PurchaseExtraction,
  purchaseExtraction,
  purchaseStage,
} from '@main/llm/stages/purchase';
import { describe, expect, it } from 'vitest';

const GOOD: PurchaseExtraction = {
  doc_type: 'purchase',
  supplier_name: '宝山钢铁股份有限公司',
  item_description: '热轧钢板 5mm / 冷轧钢板 3mm',
  category: 'raw_material',
  quantity_kg: 7500,
  amount_yuan: 48650,
  occurred_at: '2026-04-22',
  invoice_no: '12345678',
  confidence: 'medium',
};

describe('purchaseExtraction schema', () => {
  it('accepts a fully populated purchase JSON', () => {
    expect(purchaseExtraction.parse(GOOD)).toEqual(GOOD);
  });

  it('accepts the 2 nullable fields set to null (quantity_kg, invoice_no)', () => {
    const parsed = purchaseExtraction.parse({
      ...GOOD,
      quantity_kg: null,
      invoice_no: null,
    });
    expect(parsed.quantity_kg).toBeNull();
    expect(parsed.invoice_no).toBeNull();
  });

  it('accepts permissive zero values for amount_yuan', () => {
    expect(() => purchaseExtraction.parse({ ...GOOD, amount_yuan: 0 })).not.toThrow();
  });

  it('accepts quantity_kg = 0 (model reports "I cannot read")', () => {
    expect(() => purchaseExtraction.parse({ ...GOOD, quantity_kg: 0 })).not.toThrow();
  });

  it('accepts empty supplier_name / item_description (permissive)', () => {
    expect(() => purchaseExtraction.parse({ ...GOOD, supplier_name: '' })).not.toThrow();
    expect(() => purchaseExtraction.parse({ ...GOOD, item_description: '' })).not.toThrow();
  });

  it('accepts non-ISO / empty occurred_at strings (permissive)', () => {
    expect(() => purchaseExtraction.parse({ ...GOOD, occurred_at: '2026/04/22' })).not.toThrow();
    expect(() => purchaseExtraction.parse({ ...GOOD, occurred_at: '' })).not.toThrow();
  });

  it('rejects negative quantity_kg', () => {
    expect(() => purchaseExtraction.parse({ ...GOOD, quantity_kg: -1 })).toThrow();
  });

  it('rejects negative amount_yuan', () => {
    expect(() => purchaseExtraction.parse({ ...GOOD, amount_yuan: -1 })).toThrow();
  });

  it('rejects an unknown category value', () => {
    expect(() =>
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid runtime input
      purchaseExtraction.parse({ ...GOOD, category: 'machinery' } as any),
    ).toThrow();
  });

  it('accepts each of the 6 valid category values', () => {
    for (const category of [
      'raw_material',
      'component',
      'consumable',
      'office_supply',
      'service',
      'other',
    ] as const) {
      expect(() => purchaseExtraction.parse({ ...GOOD, category })).not.toThrow();
    }
  });

  it('rejects an unknown confidence value', () => {
    expect(() =>
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid runtime input
      purchaseExtraction.parse({ ...GOOD, confidence: 'unsure' } as any),
    ).toThrow();
  });

  it('rejects a doc_type other than the literal "purchase"', () => {
    expect(() =>
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid runtime input
      purchaseExtraction.parse({ ...GOOD, doc_type: 'fuel_receipt' } as any),
    ).toThrow();
  });
});

describe('purchaseStage metadata', () => {
  it('exposes id="purchase.v1", version, inputType, and prompt builders', () => {
    expect(purchaseStage.id).toBe('purchase.v1');
    expect(purchaseStage.version).toBe('1.0.0');
    expect(purchaseStage.inputType).toBe('pdf_text');
    expect(typeof purchaseStage.buildPrompt).toBe('function');
    expect(typeof purchaseStage.buildVisionMessages).toBe('function');
  });

  it('buildPrompt embeds the PDF text inside <invoice>...</invoice> AND includes field rules', () => {
    const prompt = purchaseStage.buildPrompt('SAMPLE_PURCHASE_TEXT_TOKEN');
    expect(prompt).toContain('Chinese purchase invoice');
    expect(prompt).toContain('SAMPLE_PURCHASE_TEXT_TOKEN');
    expect(prompt).toContain('<invoice>');
    expect(prompt).toContain('</invoice>');
    // Field rules verbatim shared with vision path.
    expect(prompt).toContain('category');
    expect(prompt).toContain('quantity_kg');
    // Each of the 6 category enum values appears in the prompt body.
    expect(prompt).toContain('raw_material');
    expect(prompt).toContain('component');
    expect(prompt).toContain('consumable');
    expect(prompt).toContain('office_supply');
    expect(prompt).toContain('service');
    // The multi-line aggregation instruction.
    expect(prompt).toContain('aggregate');
  });

  it('buildVisionMessages mirrors buildPrompt field rules but omits the <invoice> placeholder', () => {
    const msgs = purchaseStage.buildVisionMessages?.();
    expect(msgs).toBeDefined();
    expect(msgs?.userText).toContain('Chinese purchase invoice');
    expect(msgs?.userText).toContain('category');
    expect(msgs?.userText).toContain('quantity_kg');
    expect(msgs?.userText).toContain('raw_material');
    expect(msgs?.userText).toContain('aggregate');
    // No PDF text placeholder — image content is appended by the caller.
    expect(msgs?.userText).not.toContain('<invoice>');
  });
});
