import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { checkRateLimit } from '../src/lib/rate-limit.js';

describe('checkRateLimit', () => {
  const config = { max: 3, windowS: 60 };

  it('allows requests within the limit', async () => {
    const now = 1700000000;
    const r1 = await checkRateLimit(env.RATE_LIMIT, 'test', 'key1', config, now);
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(2);
  });

  it('blocks after exceeding the limit', async () => {
    const now = 1700000100;
    for (let i = 0; i < 3; i++) {
      await checkRateLimit(env.RATE_LIMIT, 'test', 'key2', config, now);
    }
    const blocked = await checkRateLimit(env.RATE_LIMIT, 'test', 'key2', config, now);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it('resets after the window expires', async () => {
    const now1 = 1700000200;
    for (let i = 0; i < 3; i++) {
      await checkRateLimit(env.RATE_LIMIT, 'test', 'key3', config, now1);
    }
    const now2 = now1 + 61;
    const r = await checkRateLimit(env.RATE_LIMIT, 'test', 'key3', config, now2);
    expect(r.allowed).toBe(true);
  });

  it('does not throw near window end (KV TTL >= 60s regression)', async () => {
    const start = 1700000300;
    await checkRateLimit(env.RATE_LIMIT, 'test', 'edge', config, start);
    await expect(
      checkRateLimit(env.RATE_LIMIT, 'test', 'edge', config, start + 58),
    ).resolves.toBeTruthy();
  });
});
