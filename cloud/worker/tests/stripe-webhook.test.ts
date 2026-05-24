import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import type { LicenseActiveRecord } from '@carbonink-cloud/shared';
import { describe, expect, it } from 'vitest';
import worker from '../src/index.js';

const SECRET = 'whsec_test_secret';
const TEST_PRIVATE_KEY_HEX = '4af3e2f9c1b0a988776655443322110011223344556677889900aabbccddeeff';

async function sign(payload: string, ts: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const macBuf = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${ts}.${payload}`),
  );
  const arr = new Uint8Array(macBuf);
  let hex = '';
  for (const b of arr) hex += b.toString(16).padStart(2, '0');
  return `t=${ts},v1=${hex}`;
}

async function postEvent(eventObj: unknown): Promise<Response> {
  const payload = JSON.stringify(eventObj);
  const ts = Math.floor(Date.now() / 1000);
  const sig = await sign(payload, ts);
  const req = new Request('https://carbonink.xyz/api/v1/stripe-webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'stripe-signature': sig },
    body: payload,
  });
  const ctx = createExecutionContext();
  const res = await worker.fetch(
    req,
    {
      ...env,
      STRIPE_WEBHOOK_SECRET: SECRET,
      RESEND_API_KEY: 'test',
      LICENSE_PRIVATE_KEY_HEX: TEST_PRIVATE_KEY_HEX,
    },
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

describe('POST /v1/stripe-webhook signature verification', () => {
  it('rejects requests without a signature with 400', async () => {
    const req = new Request('https://carbonink.xyz/api/v1/stripe-webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, { ...env, STRIPE_WEBHOOK_SECRET: SECRET } as never, ctx);
    expect(res.status).toBe(400);
  });

  it('accepts a correctly-signed payload', async () => {
    const res = await postEvent({
      id: 'evt_1',
      type: 'unhandled.event',
      created: Math.floor(Date.now() / 1000),
      data: { object: {} },
    });
    expect(res.status).toBe(200);
  });
});

describe('POST /v1/stripe-webhook event handlers', () => {
  it('checkout.session.completed creates customer + license + KV entries', async () => {
    const res = await postEvent({
      id: 'evt_checkout',
      type: 'checkout.session.completed',
      created: 1_700_000_000,
      data: {
        object: {
          id: 'cs_test_done',
          customer: 'cus_42',
          customer_details: { email: 'buyer@example.com' },
          subscription: 'sub_42',
          metadata: { plan: 'base@2026-q2', tier: 'base' },
        },
      },
    });
    expect(res.status).toBe(200);

    const row = await env.DB.prepare('SELECT plan FROM license WHERE stripe_subscription_id=?')
      .bind('sub_42')
      .first<{ plan: string }>();
    expect(row?.plan).toBe('base@2026-q2');
  });

  it('invoice.payment_succeeded bumps expires_at by ~1 year', async () => {
    await env.DB.prepare('INSERT INTO customer (user_id, email, created_at) VALUES (?, ?, ?)')
      .bind('usr_renew', 'r@example.com', 1_700_000_000)
      .run();
    await env.DB.prepare(
      `INSERT INTO license (license_id, user_id, humanized_key, plan, features, devices_max, issued_at, expires_at, grace_until, stripe_subscription_id, revoked)
       VALUES ('lic_renew', 'usr_renew', 'cbk-renew1-renew2-renew3-renew4', 'base@2026-q2', '["inventory"]', 1, 1700000000, 1731536000, 1734128000, 'sub_renew', 0)`,
    ).run();
    await env.LICENSE_ACTIVE.put(
      'la:lic_renew',
      JSON.stringify({
        license_id: 'lic_renew',
        user_id: 'usr_renew',
        plan: 'base@2026-q2',
        features: ['inventory'],
        devices_max: 1,
        device_ids: [],
        issued_at: 1_700_000_000,
        expires_at: 1_731_536_000,
        grace_until: 1_734_128_000,
        revoked: false,
        revoked_at: null,
        revoked_reason: null,
        stripe_subscription_id: 'sub_renew',
      }),
    );

    const res = await postEvent({
      id: 'evt_inv',
      type: 'invoice.payment_succeeded',
      created: 1_731_500_000,
      data: { object: { subscription: 'sub_renew' } },
    });
    expect(res.status).toBe(200);
    const row = await env.DB.prepare('SELECT expires_at FROM license WHERE license_id=?')
      .bind('lic_renew')
      .first<{ expires_at: number }>();
    expect(row?.expires_at).toBe(1_731_536_000 + 365 * 86_400);
  });

  it('customer.subscription.deleted schedules revocation in 30 days (does not flip revoked yet)', async () => {
    await env.DB.prepare('INSERT INTO customer (user_id, email, created_at) VALUES (?, ?, ?)')
      .bind('usr_cancel', 'c@example.com', 1_700_000_000)
      .run();
    await env.DB.prepare(
      `INSERT INTO license (license_id, user_id, humanized_key, plan, features, devices_max, issued_at, expires_at, grace_until, stripe_subscription_id, revoked)
       VALUES ('lic_cancel', 'usr_cancel', 'cbk-canc1-canc2-canc3-canc4', 'base@2026-q2', '["inventory"]', 1, 1700000000, 1731536000, 1734128000, 'sub_cancel', 0)`,
    ).run();
    await env.LICENSE_ACTIVE.put(
      'la:lic_cancel',
      JSON.stringify({
        license_id: 'lic_cancel',
        user_id: 'usr_cancel',
        plan: 'base@2026-q2',
        features: ['inventory'],
        devices_max: 1,
        device_ids: [],
        issued_at: 1_700_000_000,
        expires_at: 1_731_536_000,
        grace_until: 1_734_128_000,
        revoked: false,
        revoked_at: null,
        revoked_reason: null,
        stripe_subscription_id: 'sub_cancel',
      }),
    );

    const eventTime = 1_731_000_000;
    const res = await postEvent({
      id: 'evt_cancel',
      type: 'customer.subscription.deleted',
      created: eventTime,
      data: { object: { id: 'sub_cancel' } },
    });
    expect(res.status).toBe(200);

    const row = await env.DB.prepare(
      'SELECT revoked, revoked_at, revoked_reason FROM license WHERE license_id=?',
    )
      .bind('lic_cancel')
      .first<{ revoked: number; revoked_at: number; revoked_reason: string }>();
    expect(row?.revoked).toBe(0);
    expect(row?.revoked_at).toBe(eventTime + 30 * 86_400);
    expect(row?.revoked_reason).toBe('subscription_cancelled');
    const raw = await env.LICENSE_ACTIVE.get('la:lic_cancel');
    expect(raw).not.toBeNull();
    const kv = JSON.parse(raw as string) as LicenseActiveRecord;
    expect(kv.revoked).toBe(false);
  });

  it('charge.refunded schedules revocation in 30 days with reason=refund', async () => {
    await env.DB.prepare('INSERT INTO customer (user_id, email, created_at) VALUES (?, ?, ?)')
      .bind('usr_ref', 'ref@example.com', 1_700_000_000)
      .run();
    await env.DB.prepare(
      `INSERT INTO license (license_id, user_id, humanized_key, plan, features, devices_max, issued_at, expires_at, grace_until, stripe_subscription_id, revoked)
       VALUES ('lic_ref', 'usr_ref', 'cbk-ref1a-ref2b-ref3c-ref4d', 'base@2026-q2', '["inventory"]', 1, 1700000000, 1731536000, 1734128000, 'sub_ref', 0)`,
    ).run();
    const eventTime = 1_731_100_000;
    const res = await postEvent({
      id: 'evt_ref',
      type: 'charge.refunded',
      created: eventTime,
      data: { object: { id: 'ch_x', metadata: { subscription_id: 'sub_ref' } } },
    });
    expect(res.status).toBe(200);
    const row = await env.DB.prepare(
      'SELECT revoked_at, revoked_reason FROM license WHERE license_id=?',
    )
      .bind('lic_ref')
      .first<{ revoked_at: number; revoked_reason: string }>();
    expect(row?.revoked_at).toBe(eventTime + 30 * 86_400);
    expect(row?.revoked_reason).toBe('refund');
  });

  it('unknown event types return 200 (no error)', async () => {
    const res = await postEvent({
      id: 'evt_unknown',
      type: 'invoice.upcoming',
      created: Math.floor(Date.now() / 1000),
      data: { object: {} },
    });
    expect(res.status).toBe(200);
  });
});
