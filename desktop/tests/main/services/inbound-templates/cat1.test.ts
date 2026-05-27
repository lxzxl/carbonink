import {
  CAT1_SUPPLIER_DISCLOSURE,
  getInboundTemplate,
} from '@main/services/inbound-templates/index.js';
import type { InboundTemplateKind } from '@shared/types';
import { describe, expect, it } from 'vitest';

/**
 * `cell_ref` format: `<sheet_name>!<column><row>`. Sheet names in the Cat 1
 * template are lowercase ASCII identifiers (`metadata`, `tier1`, `tier2`);
 * column is one-or-more uppercase letters; row is one-or-more digits.
 *
 * Parser-side validation lives in ExcelTemplateRenderer (Task 5). Here we
 * just guard against typo'd refs that would silently look up empty cells.
 */
const CELL_REF_RE = /^[a-z0-9_]+![A-Z]+\d+$/;

describe('CAT1_SUPPLIER_DISCLOSURE', () => {
  it('has the expected template-level metadata', () => {
    expect(CAT1_SUPPLIER_DISCLOSURE.template_kind).toBe('cat1_supplier_disclosure');
    expect(CAT1_SUPPLIER_DISCLOSURE.version).toBe('1.0');
    expect(CAT1_SUPPLIER_DISCLOSURE.scope).toBe(3);
    expect(CAT1_SUPPLIER_DISCLOSURE.category).toBe('purchased_goods');
    expect(CAT1_SUPPLIER_DISCLOSURE.ghg_protocol_path).toBe('scope3.cat1_purchased_goods');
  });

  it('ships exactly 7 questions', () => {
    expect(CAT1_SUPPLIER_DISCLOSURE.questions).toHaveLength(7);
  });

  it('question positions are all unique', () => {
    const positions = CAT1_SUPPLIER_DISCLOSURE.questions.map((q) => q.position);
    expect(new Set(positions).size).toBe(positions.length);
  });

  it('cell_refs are all well-formed and unique', () => {
    const refs = CAT1_SUPPLIER_DISCLOSURE.questions.map((q) => q.cell_ref);
    for (const ref of refs) {
      expect(ref).toMatch(CELL_REF_RE);
    }
    expect(new Set(refs).size).toBe(refs.length);
  });

  it('every question has both raw_zh and raw_en non-empty', () => {
    for (const q of CAT1_SUPPLIER_DISCLOSURE.questions) {
      expect(q.raw_zh.trim()).not.toBe('');
      expect(q.raw_en.trim()).not.toBe('');
    }
  });

  it('metadata questions (3) carry tier=null', () => {
    const meta = CAT1_SUPPLIER_DISCLOSURE.questions.filter((q) => q.position.startsWith('meta.'));
    expect(meta).toHaveLength(3);
    for (const q of meta) {
      expect(q.tier).toBeNull();
    }
  });

  it('Tier 1 questions are all numerical (PCF in kgCO2e/kg)', () => {
    const tier1 = CAT1_SUPPLIER_DISCLOSURE.questions.filter((q) => q.tier === 1);
    expect(tier1.length).toBeGreaterThan(0);
    for (const q of tier1) {
      expect(q.kind).toBe('numerical');
      // Tier 1 must declare its expected unit so ingest can validate.
      expect(q.expected_unit).not.toBeNull();
    }
  });

  it('Tier 2 has at least one numerical question (the kgCO2e total)', () => {
    const tier2 = CAT1_SUPPLIER_DISCLOSURE.questions.filter((q) => q.tier === 2);
    expect(tier2.length).toBeGreaterThan(0);
    const numeric = tier2.filter((q) => q.kind === 'numerical');
    expect(numeric.length).toBeGreaterThan(0);
  });

  it('numerical questions all declare expected_unit', () => {
    const numeric = CAT1_SUPPLIER_DISCLOSURE.questions.filter((q) => q.kind === 'numerical');
    for (const q of numeric) {
      expect(q.expected_unit).not.toBeNull();
      // No empty-string expected_unit either — would silently bypass parser
      // unit checks.
      expect(q.expected_unit?.trim()).not.toBe('');
    }
  });

  it('categorical / narrative questions carry expected_unit=null', () => {
    const nonNum = CAT1_SUPPLIER_DISCLOSURE.questions.filter((q) => q.kind !== 'numerical');
    for (const q of nonNum) {
      expect(q.expected_unit).toBeNull();
    }
  });

  it('every question references one of the three known sheets', () => {
    const knownSheets = new Set(['metadata', 'tier1', 'tier2']);
    for (const q of CAT1_SUPPLIER_DISCLOSURE.questions) {
      const sheet = q.cell_ref.split('!')[0];
      expect(knownSheets.has(sheet ?? '')).toBe(true);
    }
  });
});

describe('getInboundTemplate', () => {
  it('returns CAT1_SUPPLIER_DISCLOSURE for the cat1 kind', () => {
    const t = getInboundTemplate('cat1_supplier_disclosure');
    expect(t).toBe(CAT1_SUPPLIER_DISCLOSURE);
  });

  it('throws on unknown template kind', () => {
    // Cast bypasses the type narrowing — we're simulating a future kind that
    // was added to the union without a switch-case landing.
    const bogus = 'cat99_not_a_template' as unknown as InboundTemplateKind;
    expect(() => getInboundTemplate(bogus)).toThrow(/Unknown inbound template kind/);
  });
});
