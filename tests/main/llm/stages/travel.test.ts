import { type TravelExtraction, travelExtraction, travelStage } from '@main/llm/stages/travel';
import { describe, expect, it } from 'vitest';

const AIR_GOOD: TravelExtraction = {
  doc_type: 'travel',
  supplier_name: '中国国际航空',
  mode: 'air',
  passenger_name: '张三',
  origin: '北京首都国际机场',
  destination: '上海虹桥国际机场',
  departure_at: '2026-04-15T08:30',
  arrival_at: '2026-04-15T10:50',
  travel_class: '经济舱',
  distance_km: null,
  flight_or_train_no: 'CA1234',
  vehicle_plate: null,
  amount_yuan: 1250,
  ticket_no: '7841234567890',
  confidence: 'high',
};

const RAIL_GOOD: TravelExtraction = {
  doc_type: 'travel',
  supplier_name: '中国铁路',
  mode: 'rail',
  passenger_name: '李四',
  origin: '上海虹桥站',
  destination: '北京南站',
  departure_at: '2026-04-22T14:30',
  arrival_at: '2026-04-22T20:15',
  travel_class: '二等座',
  distance_km: null,
  flight_or_train_no: 'G102',
  vehicle_plate: null,
  amount_yuan: 553,
  ticket_no: 'E123456789',
  confidence: 'high',
};

const TAXI_GOOD: TravelExtraction = {
  doc_type: 'travel',
  supplier_name: '滴滴出行',
  mode: 'taxi',
  passenger_name: null,
  origin: '浦东国际机场',
  destination: '上海市浦东新区',
  departure_at: '2026-04-15T11:30',
  arrival_at: null,
  travel_class: null,
  distance_km: 42.5,
  flight_or_train_no: null,
  vehicle_plate: '沪A12345',
  amount_yuan: 180,
  ticket_no: 'DD20260415123',
  confidence: 'high',
};

describe('travelExtraction schema', () => {
  it('accepts a fully populated air-mode travel JSON', () => {
    expect(travelExtraction.parse(AIR_GOOD)).toEqual(AIR_GOOD);
  });

  it('accepts a fully populated rail-mode travel JSON', () => {
    expect(travelExtraction.parse(RAIL_GOOD)).toEqual(RAIL_GOOD);
  });

  it('accepts a fully populated taxi-mode travel JSON', () => {
    expect(travelExtraction.parse(TAXI_GOOD)).toEqual(TAXI_GOOD);
  });

  it('accepts the 7 nullable fields set to null', () => {
    const parsed = travelExtraction.parse({
      ...AIR_GOOD,
      passenger_name: null,
      arrival_at: null,
      travel_class: null,
      distance_km: null,
      flight_or_train_no: null,
      vehicle_plate: null,
      ticket_no: null,
    });
    expect(parsed.passenger_name).toBeNull();
    expect(parsed.arrival_at).toBeNull();
    expect(parsed.travel_class).toBeNull();
    expect(parsed.distance_km).toBeNull();
    expect(parsed.flight_or_train_no).toBeNull();
    expect(parsed.vehicle_plate).toBeNull();
    expect(parsed.ticket_no).toBeNull();
  });

  it('accepts permissive zero values for amount_yuan and distance_km', () => {
    expect(() => travelExtraction.parse({ ...AIR_GOOD, amount_yuan: 0 })).not.toThrow();
    expect(() => travelExtraction.parse({ ...TAXI_GOOD, distance_km: 0 })).not.toThrow();
  });

  it('accepts empty origin / destination / departure_at strings (permissive)', () => {
    expect(() => travelExtraction.parse({ ...AIR_GOOD, origin: '' })).not.toThrow();
    expect(() => travelExtraction.parse({ ...AIR_GOOD, destination: '' })).not.toThrow();
    expect(() => travelExtraction.parse({ ...AIR_GOOD, departure_at: '' })).not.toThrow();
  });

  it('accepts non-ISO departure_at / arrival_at strings (permissive)', () => {
    expect(() =>
      travelExtraction.parse({ ...AIR_GOOD, departure_at: '2026/04/15 08:30' }),
    ).not.toThrow();
    expect(() =>
      travelExtraction.parse({ ...AIR_GOOD, arrival_at: '2026/04/15 10:50' }),
    ).not.toThrow();
  });

  it('rejects negative amount_yuan', () => {
    expect(() => travelExtraction.parse({ ...AIR_GOOD, amount_yuan: -1 })).toThrow();
  });

  it('rejects negative distance_km', () => {
    expect(() => travelExtraction.parse({ ...TAXI_GOOD, distance_km: -5 })).toThrow();
  });

  it('rejects an unknown mode value', () => {
    expect(() =>
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid runtime input
      travelExtraction.parse({ ...AIR_GOOD, mode: 'ship' } as any),
    ).toThrow();
  });

  it('accepts each of the 3 valid mode values', () => {
    for (const mode of ['air', 'rail', 'taxi'] as const) {
      expect(() => travelExtraction.parse({ ...AIR_GOOD, mode })).not.toThrow();
    }
  });

  it('rejects an unknown confidence value', () => {
    expect(() =>
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid runtime input
      travelExtraction.parse({ ...AIR_GOOD, confidence: 'guess' } as any),
    ).toThrow();
  });

  it('rejects a doc_type other than the literal "travel"', () => {
    expect(() =>
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid runtime input
      travelExtraction.parse({ ...AIR_GOOD, doc_type: 'purchase' } as any),
    ).toThrow();
  });
});

describe('travelStage metadata', () => {
  it('exposes id="travel.v1", version, inputType, and prompt builders', () => {
    expect(travelStage.id).toBe('travel.v1');
    expect(travelStage.version).toBe('1.0.0');
    expect(travelStage.inputType).toBe('pdf_text');
    expect(typeof travelStage.buildPrompt).toBe('function');
    expect(typeof travelStage.buildVisionMessages).toBe('function');
  });

  it('buildPrompt embeds the PDF text inside <ticket>...</ticket> AND includes field rules', () => {
    const prompt = travelStage.buildPrompt('SAMPLE_TRAVEL_TEXT_TOKEN');
    expect(prompt).toContain('Chinese business-travel');
    expect(prompt).toContain('SAMPLE_TRAVEL_TEXT_TOKEN');
    expect(prompt).toContain('<ticket>');
    expect(prompt).toContain('</ticket>');
    // Field rules verbatim shared with vision path.
    expect(prompt).toContain('mode');
    expect(prompt).toContain('distance_km');
    // Each of the 3 mode enum values appears in the prompt body.
    expect(prompt).toContain('air');
    expect(prompt).toContain('rail');
    expect(prompt).toContain('taxi');
    // The "do not estimate distance" guidance is verbatim.
    expect(prompt).toContain('Do NOT estimate');
  });

  it('buildVisionMessages mirrors buildPrompt field rules but omits the <ticket> placeholder', () => {
    const msgs = travelStage.buildVisionMessages?.();
    expect(msgs).toBeDefined();
    expect(msgs?.userText).toContain('Chinese business-travel');
    expect(msgs?.userText).toContain('mode');
    expect(msgs?.userText).toContain('distance_km');
    expect(msgs?.userText).toContain('Do NOT estimate');
    // No PDF text placeholder — image content is appended by the caller.
    expect(msgs?.userText).not.toContain('<ticket>');
  });
});
