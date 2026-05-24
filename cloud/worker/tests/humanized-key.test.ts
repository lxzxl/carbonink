import { generateHumanizedKey, normalizeHumanizedKey } from '@carbonink-cloud/shared';
import { describe, expect, it } from 'vitest';

describe('generateHumanizedKey', () => {
  it('produces cik-XXXXX-XXXXX-XXXXX-XXXXX format', () => {
    const key = generateHumanizedKey();
    expect(key).toMatch(
      /^cik-[0-9a-hjkmnp-tv-z]{5}-[0-9a-hjkmnp-tv-z]{5}-[0-9a-hjkmnp-tv-z]{5}-[0-9a-hjkmnp-tv-z]{5}$/i,
    );
  });

  it('generates unique keys', () => {
    const keys = new Set(Array.from({ length: 100 }, () => generateHumanizedKey()));
    expect(keys.size).toBe(100);
  });
});

describe('normalizeHumanizedKey', () => {
  it('normalizes uppercase with dashes', () => {
    expect(normalizeHumanizedKey('CIK-ABCDE-12345-FGHJK-MNPQR')).toBe(
      'cik-abcde-12345-fghjk-mnpqr',
    );
  });

  it('normalizes input without dashes', () => {
    expect(normalizeHumanizedKey('cikABCDE12345FGHJKMNPQR')).toBe('cik-abcde-12345-fghjk-mnpqr');
  });

  it('rejects invalid characters (I, L, O, U)', () => {
    expect(normalizeHumanizedKey('CIK-ILOUD-12345-FGHJK-MNPQR')).toBeNull();
  });

  it('rejects wrong length', () => {
    expect(normalizeHumanizedKey('cik-ABC-DEF')).toBeNull();
  });
});
