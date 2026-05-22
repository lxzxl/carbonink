import { createExecutionContext, env, fetchMock, waitOnExecutionContext } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import worker from '../src/index.js';

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

async function call(body: unknown): Promise<Response> {
  const req = new Request('https://api.carbonbook.app/v1/checkout-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const ctx = createExecutionContext();
  const res = await worker.fetch(
    req,
    { ...env, STRIPE_SECRET_KEY: 'sk_test_xxx', STRIPE_PRICE_BASE_2026Q2: 'price_base_q2' },
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

describe('POST /v1/checkout-session', () => {
  it('creates a Checkout Session and returns its URL', async () => {
    fetchMock
      .get('https://api.stripe.com')
      .intercept({ path: '/v1/checkout/sessions', method: 'POST' })
      .reply(200, { id: 'cs_test_123', url: 'https://checkout.stripe.com/c/pay/cs_test_123' });

    const res = await call({ plan: 'base@2026-q2', email: 'b@example.com' });
    expect(res.status).toBe(200);
    const body = await res.json<{ checkout_url: string }>();
    expect(body.checkout_url).toContain('checkout.stripe.com');
  });

  it('rejects unknown plans with 400', async () => {
    const res = await call({ plan: 'mystery-plan' });
    expect(res.status).toBe(400);
  });
});
