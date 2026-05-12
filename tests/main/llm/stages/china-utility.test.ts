import {
  type ChinaUtilityExtraction,
  chinaUtilityExtraction,
  chinaUtilityStage,
} from '@main/llm/stages/china-utility';
import { describe, expect, it } from 'vitest';

/**
 * The "happy" fixture — a fully populated extraction as we'd hope GPT-4o
 * returns for a real 国网 bill. Lets every test branch off a known-good
 * baseline and tweak one field to assert rejection.
 */
const GOOD: ChinaUtilityExtraction = {
  doc_type: 'china_utility',
  supplier_name: '国家电网上海市浦东供电公司',
  account_no: '1234567890',
  amount_kwh: 412.5,
  amount_yuan: 235.8,
  period_start: '2025-01-01',
  period_end: '2025-01-31',
  confidence: 'high',
};

describe('chinaUtilityExtraction schema', () => {
  it('accepts a fully populated china-bill JSON', () => {
    expect(chinaUtilityExtraction.parse(GOOD)).toEqual(GOOD);
  });

  it('accepts nullable fields set to null', () => {
    const parsed = chinaUtilityExtraction.parse({
      ...GOOD,
      account_no: null,
      amount_yuan: null,
    });
    expect(parsed.account_no).toBeNull();
    expect(parsed.amount_yuan).toBeNull();
  });

  it('accepts non-ISO date strings (permissive schema — model needs to say "I cannot parse this")', () => {
    // Schema relaxed Phase 1b smoke fix: DeepSeek + OpenAI-compat lack
    // native JSON Schema mode and the model needs an escape hatch to
    // honestly report "this period field isn't readable" without forcing
    // SchemaMismatchError. The ActivityForm Confirm flow validates ISO
    // format at the point the date becomes activity_data.
    expect(() =>
      chinaUtilityExtraction.parse({ ...GOOD, period_start: '2025/01/01' }),
    ).not.toThrow();
    expect(() => chinaUtilityExtraction.parse({ ...GOOD, period_start: '' })).not.toThrow();
  });

  it('accepts amount_kwh = 0 (model reports "I could not read consumption")', () => {
    // Same rationale as date relaxation. The review UI flags any
    // zero/empty fields visually so the user knows to override before
    // committing.
    expect(() => chinaUtilityExtraction.parse({ ...GOOD, amount_kwh: 0 })).not.toThrow();
  });

  it('rejects a negative amount_kwh (consumption can be zero but never negative)', () => {
    expect(() => chinaUtilityExtraction.parse({ ...GOOD, amount_kwh: -10 })).toThrow();
  });

  it('rejects an unknown confidence value', () => {
    expect(() =>
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid runtime input
      chinaUtilityExtraction.parse({ ...GOOD, confidence: 'unknown' } as any),
    ).toThrow();
  });

  it('rejects a doc_type other than the literal "china_utility"', () => {
    expect(() =>
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid runtime input
      chinaUtilityExtraction.parse({ ...GOOD, doc_type: 'us_utility' } as any),
    ).toThrow();
  });
});

describe('chinaUtilityStage metadata', () => {
  it('exposes id, version, inputType and a prompt builder', () => {
    expect(chinaUtilityStage.id).toBe('china_utility.v1');
    expect(chinaUtilityStage.version).toBe('1.0.0');
    expect(chinaUtilityStage.inputType).toBe('pdf_text');
    // buildPrompt should weave the supplied PDF text into the template
    // verbatim — that's the contract the ExtractionService relies on.
    const prompt = chinaUtilityStage.buildPrompt('SAMPLE_PDF_TEXT_TOKEN');
    expect(prompt).toContain('SAMPLE_PDF_TEXT_TOKEN');
    expect(prompt).toContain('Chinese electricity utility bill');
  });
});
