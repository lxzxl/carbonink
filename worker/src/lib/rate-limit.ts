/**
 * Rate limiting via KV counters with TTL.
 *
 * NOT Cloudflare's built-in rate limiting (requires paid plan).
 * Each counter is a KV key `rl:{scope}:{identifier}` with a TTL
 * matching the rate limit window. Value is JSON { count, resetAt }.
 */

type RateLimitConfig = {
  max: number;
  windowS: number;
};

type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: number;
};

type CounterValue = {
  count: number;
  resetAt: number;
};

export async function checkRateLimit(
  kv: KVNamespace,
  scope: string,
  identifier: string,
  config: RateLimitConfig,
  nowSeconds: number,
): Promise<RateLimitResult> {
  const key = `rl:${scope}:${identifier}`;
  const raw = await kv.get(key);
  let counter: CounterValue;

  if (raw) {
    counter = JSON.parse(raw) as CounterValue;
    if (nowSeconds >= counter.resetAt) {
      counter = { count: 0, resetAt: nowSeconds + config.windowS };
    }
  } else {
    counter = { count: 0, resetAt: nowSeconds + config.windowS };
  }

  counter.count += 1;
  const allowed = counter.count <= config.max;

  // KV's minimum expirationTtl is 60s. If the window is about to close
  // (e.g. resetAt - now = 3), passing `8` would 400 with "Invalid
  // expiration_ttl". Clamp to 60; the extra lifetime is harmless because
  // the next read sees the expired window and resets via the branch above.
  const ttlS = Math.max(60, counter.resetAt - nowSeconds + 5);
  await kv.put(key, JSON.stringify(counter), { expirationTtl: ttlS });

  return {
    allowed,
    remaining: Math.max(0, config.max - counter.count),
    resetAt: counter.resetAt,
  };
}
