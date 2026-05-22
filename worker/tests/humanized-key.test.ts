import { generateHumanizedKey, normalizeHumanizedKey } from '@carbonbook-cloud/shared';
import { describe, expect, it } from 'vitest';

describe('generateHumanizedKey', () => {
  it('produces cbk-XXXXX-XXXXX-XXXXX-XXXXX format', () => {
    const key = generateHumanizedKey();
    expect(key).toMatch(
      /^cbk-[0-9a-hjkmnp-tv-z]{5}-[0-9a-hjkmnp-tv-z]{5}-[0-9a-hjkmnp-tv-z]{5}-[0-9a-hjkmnp-tv-z]{5}$/i,
    );
  });

  it('generates unique keys', () => {
    const keys = new Set(Array.from({ length: 100 }, () => generateHumanizedKey()));
    expect(keys.size).toBe(100);
  });
});

describe('normalizeHumanizedKey', () => {
  it('normalizes uppercase with dashes', () => {
    expect(normalizeHumanizedKey('CBK-ABCDE-12345-FGHJK-MNPQR')).toBe(
      'cbk-abcde-12345-fghjk-mnpqr',
    );
  });

  it('normalizes input without dashes', () => {
    expect(normalizeHumanizedKey('cbkABCDE12345FGHJKMNPQR')).toBe('cbk-abcde-12345-fghjk-mnpqr');
  });

  it('rejects invalid characters (I, L, O, U)', () => {
    expect(normalizeHumanizedKey('CBK-ILOUD-12345-FGHJK-MNPQR')).toBeNull();
  });

  it('rejects wrong length', () => {
    expect(normalizeHumanizedKey('cbk-ABC-DEF')).toBeNull();
  });
});
