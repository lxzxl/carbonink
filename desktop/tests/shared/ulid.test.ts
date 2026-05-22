import { newId } from '@shared/ulid';
import { describe, expect, it } from 'vitest';

describe('newId', () => {
  it('returns 26-char ULID strings', () => {
    const id = newId();
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('returns monotonic ids when called rapidly', () => {
    const a = newId();
    const b = newId();
    expect(b > a).toBe(true);
  });

  it('returns unique ids in a tight loop', () => {
    const ids = Array.from({ length: 1000 }, () => newId());
    expect(new Set(ids).size).toBe(1000);
  });
});
