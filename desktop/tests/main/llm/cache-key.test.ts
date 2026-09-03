import { buildCacheKey, sha256Hex, stableStringify } from '@main/llm/cache-key';
import { describe, expect, it } from 'vitest';

describe('stableStringify', () => {
  it('sorts object keys recursively', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it('preserves array order', () => {
    expect(stableStringify([2, 1])).toBe('[2,1]');
  });
});

describe('buildCacheKey', () => {
  const base = {
    scope: 'ef-single',
    provider: 'deepseek',
    model: 'deepseek-chat',
    promptVersion: 'v1' as string,
    payload: { hint: 'diesel', unit: 'L' },
  };

  it('is deterministic regardless of payload key order', () => {
    const a = buildCacheKey(base);
    const b = buildCacheKey({ ...base, payload: { unit: 'L', hint: 'diesel' } });
    expect(a).toBe(b);
  });

  it('changes when any key input changes', () => {
    const a = buildCacheKey(base);
    expect(buildCacheKey({ ...base, model: 'other' })).not.toBe(a);
    expect(buildCacheKey({ ...base, provider: 'openai' })).not.toBe(a);
    expect(buildCacheKey({ ...base, promptVersion: 'v2' })).not.toBe(a);
    expect(buildCacheKey({ ...base, datasetVersion: 'v2024' })).not.toBe(a);
    expect(buildCacheKey({ ...base, payload: { hint: 'petrol', unit: 'L' } })).not.toBe(a);
  });

  it('hashes long payloads instead of inlining them', () => {
    const long = buildCacheKey({ ...base, payload: { text: 'x'.repeat(10_000) } });
    const short = buildCacheKey(base);
    expect(long.length).toBeLessThan(200);
    expect(long).toContain(sha256Hex(stableStringify({ text: 'x'.repeat(10_000) })));
    expect(long).not.toBe(short);
  });
});
