import { type FreightExtraction, freightExtraction, freightStage } from '@main/llm/stages/freight';
import { describe, expect, it } from 'vitest';

const GOOD: FreightExtraction = {
  doc_type: 'freight',
  supplier_name: '顺丰速运',
  mode: 'road',
  vehicle_class: '冷链车',
  weight_kg: 1250,
  volume_m3: 4.5,
  distance_km: 1430,
  origin: '广州市番禺区',
  destination: '上海市浦东新区',
  tracking_no: 'SF1234567890',
  amount_yuan: 2680,
  occurred_at: '2026-05-08',
  confidence: 'high',
};

describe('freightExtraction schema', () => {
  it('accepts a fully populated freight JSON', () => {
    expect(freightExtraction.parse(GOOD)).toEqual(GOOD);
  });

  it('accepts the 4 nullable fields set to null (vehicle_class, volume_m3, distance_km, tracking_no)', () => {
    const parsed = freightExtraction.parse({
      ...GOOD,
      vehicle_class: null,
      volume_m3: null,
      distance_km: null,
      tracking_no: null,
    });
    expect(parsed.vehicle_class).toBeNull();
    expect(parsed.volume_m3).toBeNull();
    expect(parsed.distance_km).toBeNull();
    expect(parsed.tracking_no).toBeNull();
  });

  it('accepts permissive zero values for weight_kg and amount_yuan', () => {
    expect(() => freightExtraction.parse({ ...GOOD, weight_kg: 0 })).not.toThrow();
    expect(() => freightExtraction.parse({ ...GOOD, amount_yuan: 0 })).not.toThrow();
  });

  it('accepts empty origin / destination strings (permissive)', () => {
    expect(() => freightExtraction.parse({ ...GOOD, origin: '' })).not.toThrow();
    expect(() => freightExtraction.parse({ ...GOOD, destination: '' })).not.toThrow();
  });

  it('accepts non-ISO / empty occurred_at strings (permissive)', () => {
    expect(() => freightExtraction.parse({ ...GOOD, occurred_at: '2026/05/08' })).not.toThrow();
    expect(() => freightExtraction.parse({ ...GOOD, occurred_at: '' })).not.toThrow();
  });

  it('rejects negative weight_kg', () => {
    expect(() => freightExtraction.parse({ ...GOOD, weight_kg: -1 })).toThrow();
  });

  it('rejects negative amount_yuan', () => {
    expect(() => freightExtraction.parse({ ...GOOD, amount_yuan: -1 })).toThrow();
  });

  it('rejects negative volume_m3 and distance_km', () => {
    expect(() => freightExtraction.parse({ ...GOOD, volume_m3: -0.1 })).toThrow();
    expect(() => freightExtraction.parse({ ...GOOD, distance_km: -10 })).toThrow();
  });

  it('rejects an unknown mode value', () => {
    expect(() =>
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid runtime input
      freightExtraction.parse({ ...GOOD, mode: 'spaceship' } as any),
    ).toThrow();
  });

  it('accepts each of the 4 valid mode values', () => {
    for (const mode of ['road', 'rail', 'sea', 'air'] as const) {
      expect(() => freightExtraction.parse({ ...GOOD, mode })).not.toThrow();
    }
  });

  it('rejects an unknown confidence value', () => {
    expect(() =>
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid runtime input
      freightExtraction.parse({ ...GOOD, confidence: 'definitely' } as any),
    ).toThrow();
  });

  it('rejects a doc_type other than the literal "freight"', () => {
    expect(() =>
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid runtime input
      freightExtraction.parse({ ...GOOD, doc_type: 'fuel_receipt' } as any),
    ).toThrow();
  });
});

describe('freightStage metadata', () => {
  it('exposes id="freight.v1", version, inputType, and prompt builders', () => {
    expect(freightStage.id).toBe('freight.v1');
    expect(freightStage.version).toBe('1.0.0');
    expect(freightStage.inputType).toBe('pdf_text');
    expect(typeof freightStage.buildPrompt).toBe('function');
    expect(typeof freightStage.buildVisionMessages).toBe('function');
  });
});
