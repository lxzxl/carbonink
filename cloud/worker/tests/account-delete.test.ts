import { createExecutionContext, env, fetchMock, waitOnExecutionContext } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import worker from '../src/index.js';
import { signSessionJwt } from '../src/lib/session.js';

const SESSION_KEY = '7f12345678901234567890123456789012345678901234567890123456789012';

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

async function authedDelete(body: unknown, userId: string): Promise<Response> {
  const now = Math.floor(Date.now() / 1000);
  const jwt = await signSessionJwt(
    {
      iss: 'carbonbook.app/account',
      sub: userId,
      email: `${userId}@example.com`,
      iat: now,
      exp: now + 3600,
    },
    SESSION_KEY,
  );
  const req = new Request('https://api.carbonbook.app/v1/account', {
    method: 'DELETE',
    headers: { Cookie: `session=${jwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const ctx = createExecutionContext();
  // biome-ignore lint/suspicious/noExplicitAny: test override of env secret
  (env as any).SESSION_PRIVATE_KEY_HEX = SESSION_KEY;
  // biome-ignore lint/suspicious/noExplicitAny: test override of env secret
  (env as any).STRIPE_SECRET_KEY = 'sk_test_delete';
  const res = await worker.fetch(req, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

describe('DELETE /v1/account', () => {
  it('requires confirm="DELETE" — rejects other values with 400', async () => {
    const res = await authedDelete({ confirm: 'no' }, 'usr_del_bad');
    expect(res.status).toBe(400);
  });

  it('removes D1 + KV rows, expires the session cookie, returns 200', async () => {
    await env.DB.prepare('INSERT INTO customer (user_id, email, created_at) VALUES (?, ?, ?)')
      .bind('usr_del2', 'd2@example.com', 1)
      .run();
    await env.DB.prepare(
      `INSERT INTO license (license_id, user_id, humanized_key, plan, features, devices_max, issued_at, expires_at, grace_until)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind('lic_del2', 'usr_del2', 'cbk-del11-del22-del33-del44', 'base@2026-q2', '[]', 1, 1, 2, 3)
      .run();
    await env.DB.prepare(
      'INSERT INTO device (device_id, license_id, first_seen_at, last_ping_at) VALUES (?, ?, ?, ?)',
    )
      .bind('dev_del2_a', 'lic_del2', 1, 1)
      .run();
    await env.LICENSE_ACTIVE.put('la:lic_del2', '{"license_id":"lic_del2"}');
    await env.HUMANIZED_KEYS.put('hk:cbk-del11-del22-del33-del44', 'lic_del2');

    const res = await authedDelete({ confirm: 'DELETE' }, 'usr_del2');
    expect(res.status).toBe(200);
    expect(res.headers.get('Set-Cookie')).toMatch(/session=;.*Max-Age=0/);

    const customer = await env.DB.prepare('SELECT * FROM customer WHERE user_id=?')
      .bind('usr_del2')
      .first();
    expect(customer).toBeNull();
    const license = await env.DB.prepare('SELECT * FROM license WHERE license_id=?')
      .bind('lic_del2')
      .first();
    expect(license).toBeNull();
    const device = await env.DB.prepare('SELECT * FROM device WHERE device_id=?')
      .bind('dev_del2_a')
      .first();
    expect(device).toBeNull();
    expect(await env.LICENSE_ACTIVE.get('la:lic_del2')).toBeNull();
    expect(await env.HUMANIZED_KEYS.get('hk:cbk-del11-del22-del33-del44')).toBeNull();
  });

  it('cancels live Stripe subscriptions best-effort, succeeds even if Stripe fails', async () => {
    await env.DB.prepare('INSERT INTO customer (user_id, email, created_at) VALUES (?, ?, ?)')
      .bind('usr_del_sub', 'subdel@example.com', 1)
      .run();
    await env.DB.prepare(
      `INSERT INTO license (license_id, user_id, humanized_key, plan, features, devices_max, issued_at, expires_at, grace_until, stripe_subscription_id, revoked)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        'lic_del_sub',
        'usr_del_sub',
        'cbk-subs1-subs2-subs3-subs4',
        'base@2026-q2',
        '[]',
        1,
        1,
        2,
        3,
        'sub_live_123',
        0,
      )
      .run();

    // Stripe returns 500 — we still expect 200 from /v1/account (best-effort).
    fetchMock
      .get('https://api.stripe.com')
      .intercept({ path: '/v1/subscriptions/sub_live_123', method: 'POST' })
      .reply(500, { error: 'internal' });

    const res = await authedDelete({ confirm: 'DELETE' }, 'usr_del_sub');
    expect(res.status).toBe(200);

    const stillThere = await env.DB.prepare('SELECT * FROM customer WHERE user_id=?')
      .bind('usr_del_sub')
      .first();
    expect(stillThere).toBeNull();
  });

  it('returns 401 without a session cookie', async () => {
    const req = new Request('https://api.carbonbook.app/v1/account', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: 'DELETE' }),
    });
    const ctx = createExecutionContext();
    // biome-ignore lint/suspicious/noExplicitAny: test override of env secret
    (env as any).SESSION_PRIVATE_KEY_HEX = SESSION_KEY;
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });
});
