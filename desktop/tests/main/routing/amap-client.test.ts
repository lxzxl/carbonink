import { distanceByAddressAmap } from '@main/services/routing/amap-client';
import { Cause, Effect, Exit, Option } from 'effect';
import { describe, expect, it, vi } from 'vitest';

function failureTag<A>(exit: Exit.Exit<A, unknown>): string | null {
  if (Exit.isSuccess(exit)) return null;
  const failure = Cause.failureOption(exit.cause);
  if (Option.isNone(failure)) return null;
  return (failure.value as { _tag?: string })._tag ?? null;
}

const VALID_AMAP_BODY = {
  status: '1',
  info: 'OK',
  infocode: '10000',
  route: { paths: [{ distance: '12345' }] },
};

describe('distanceByAddressAmap', () => {
  it('happy path: returns km from driving response', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      json: async () => VALID_AMAP_BODY,
    });
    const result = await Effect.runPromise(
      distanceByAddressAmap(
        { apiKey: 'k', fetch: fakeFetch as never },
        'driving',
        'Beijing',
        'Shanghai',
      ),
    );
    expect(result).toBe(12); // 12345m → 12 km rounded
    expect(fakeFetch).toHaveBeenCalledTimes(1);
  });

  it('AmapRateLimited on infocode 10003 (no retry)', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      json: async () => ({ status: '0', infocode: '10003', info: 'DAILY_QUERY_OVER_LIMIT' }),
    });
    const exit = await Effect.runPromiseExit(
      distanceByAddressAmap({ apiKey: 'k', fetch: fakeFetch as never }, 'driving', 'A', 'B'),
    );
    expect(failureTag(exit)).toBe('AmapRateLimited');
    expect(fakeFetch).toHaveBeenCalledTimes(1); // no retry
  });

  it('retries AmapApiError up to 2 times then surfaces', async () => {
    const fakeFetch = vi.fn().mockRejectedValue(new Error('network'));
    const exit = await Effect.runPromiseExit(
      distanceByAddressAmap({ apiKey: 'k', fetch: fakeFetch as never }, 'driving', 'A', 'B'),
    );
    expect(failureTag(exit)).toBe('AmapApiError');
    expect(fakeFetch).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });
});
