import { createExecutionContext, env, fetchMock, waitOnExecutionContext } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import worker from '../src/index.js';
import { signSessionJwt } from '../src/lib/session.js';

const SESSION_KEY = '7f12345678901234567890123456789012345678901234567890123456789012';

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

async function authedGet(path: string, userId: string): Promise<Response> {
  const now = Math.floor(Date.now() / 1000);
  const jwt = await signSessionJwt(
    {
      iss: 'carbonink.xyz/account',
      sub: userId,
      email: `${userId}@example.com`,
      iat: now,
      exp: now + 3600,
    },
    SESSION_KEY,
  );
  const req = new Request(`https://carbonink.xyz/api${path}`, {
    headers: { Cookie: `session=${jwt}` },
  });
  const ctx = createExecutionContext();
  // biome-ignore lint/suspicious/noExplicitAny: test override of env secrets
  (env as any).SESSION_PRIVATE_KEY_HEX = SESSION_KEY;
  // biome-ignore lint/suspicious/noExplicitAny: test override of env secrets
  (env as any).STRIPE_SECRET_KEY = 'sk_test_account';
  const res = await worker.fetch(req, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

describe('GET /v1/account/devices', () => {
  it('returns the user devices joined via license.user_id', async () => {
    await env.DB.prepare('INSERT INTO customer (user_id, email, created_at) VALUES (?, ?, ?)')
      .bind('usr_acct', 'acct@example.com', 1)
      .run();
    await env.DB.prepare(
      `INSERT INTO license (license_id, user_id, humanized_key, plan, features, devices_max, issued_at, expires_at, grace_until)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind('lic_acct', 'usr_acct', 'cbk-aaaaa-bbbbb-acct1-ddddd', 'base@2026-q2', '[]', 2, 1, 2, 3)
      .run();
    await env.DB.prepare(
      `INSERT INTO device (device_id, license_id, first_seen_at, last_ping_at, app_version, os)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind('dev_acct_a', 'lic_acct', 1, 1, '1.0.0', 'macOS')
      .run();

    const res = await authedGet('/v1/account/devices', 'usr_acct');
    expect(res.status).toBe(200);
    const body = await res.json<{
      devices: Array<{ device_id: string; license_id: string; os: string; app_version: string }>;
    }>();
    expect(body.devices.length).toBe(1);
    expect(body.devices[0]?.device_id).toBe('dev_acct_a');
    expect(body.devices[0]?.license_id).toBe('lic_acct');
    expect(body.devices[0]?.os).toBe('macOS');
  });

  it('returns 401 without a session cookie', async () => {
    const req = new Request('https://carbonink.xyz/api/v1/account/devices');
    const ctx = createExecutionContext();
    // biome-ignore lint/suspicious/noExplicitAny: test override of env secret
    (env as any).SESSION_PRIVATE_KEY_HEX = SESSION_KEY;
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });

  it('returns empty list when user has no devices', async () => {
    await env.DB.prepare('INSERT INTO customer (user_id, email, created_at) VALUES (?, ?, ?)')
      .bind('usr_acct_empty', 'empty@example.com', 1)
      .run();
    const res = await authedGet('/v1/account/devices', 'usr_acct_empty');
    expect(res.status).toBe(200);
    const body = await res.json<{ devices: unknown[] }>();
    expect(body.devices).toEqual([]);
  });
});

describe('GET /v1/account/billing-portal', () => {
  it('returns 400 when customer has no Stripe customer linked', async () => {
    await env.DB.prepare(
      'INSERT INTO customer (user_id, email, stripe_customer_id, created_at) VALUES (?, ?, ?, ?)',
    )
      .bind('usr_no_stripe', 'no-stripe@example.com', null, 1)
      .run();
    const res = await authedGet('/v1/account/billing-portal', 'usr_no_stripe');
    expect(res.status).toBe(400);
  });

  it('returns the Stripe Customer Portal URL', async () => {
    await env.DB.prepare(
      'INSERT INTO customer (user_id, email, stripe_customer_id, created_at) VALUES (?, ?, ?, ?)',
    )
      .bind('usr_with_stripe', 'with-stripe@example.com', 'cus_test_123', 1)
      .run();
    fetchMock
      .get('https://api.stripe.com')
      .intercept({ path: '/v1/billing_portal/sessions', method: 'POST' })
      .reply(200, { id: 'bps_test_x', url: 'https://billing.stripe.com/p/session/test' });

    const res = await authedGet('/v1/account/billing-portal', 'usr_with_stripe');
    expect(res.status).toBe(200);
    const body = await res.json<{ url: string }>();
    expect(body.url).toBe('https://billing.stripe.com/p/session/test');
  });
});
