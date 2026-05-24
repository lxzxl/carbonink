import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../src/index.js';
import { TEST_PRIVATE_KEY_HEX } from './_fixtures.js';

function makeReq(body: unknown, ip = '203.0.113.1'): Request {
  return new Request('https://carbonink.xyz/api/v1/trial-signup', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'CF-Connecting-IP': ip,
    },
    body: JSON.stringify(body),
  });
}

async function callTrialSignup(body: unknown, ip?: string) {
  // biome-ignore lint/suspicious/noExplicitAny: test override of env secret
  (env as any).LICENSE_PRIVATE_KEY_HEX = TEST_PRIVATE_KEY_HEX;
  // biome-ignore lint/suspicious/noExplicitAny: test override of env secret
  (env as any).EMAIL = { send: async () => undefined };
  const ctx = createExecutionContext();
  const res = await worker.fetch(makeReq(body, ip), env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

const DAY_S = 86_400;

describe('POST /v1/trial-signup', () => {
  it('fresh email issues 14-day trial with 30-day grace window', async () => {
    const res = await callTrialSignup(
      {
        email: 'fresh@example.com',
        device_id: 'dev_fresh_1',
        app_version: '1.0.0',
      },
      '203.0.113.10',
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ license_key: string; jwt: string }>();
    expect(body.license_key).toMatch(
      /^cbk-[0-9a-hjkmnp-tv-z]{5}-[0-9a-hjkmnp-tv-z]{5}-[0-9a-hjkmnp-tv-z]{5}-[0-9a-hjkmnp-tv-z]{5}$/,
    );
    expect(body.jwt.split('.').length).toBe(3);

    const row = await env.DB.prepare(
      `SELECT l.plan, l.expires_at, l.grace_until, l.issued_at
       FROM license l JOIN customer c ON l.user_id = c.user_id
       WHERE c.email = ?`,
    )
      .bind('fresh@example.com')
      .first<{ plan: string; expires_at: number; grace_until: number; issued_at: number }>();
    expect(row?.plan).toBe('trial@14d');
    expect((row?.expires_at ?? 0) - (row?.issued_at ?? 0)).toBe(14 * DAY_S);
    expect((row?.grace_until ?? 0) - (row?.expires_at ?? 0)).toBe(30 * DAY_S);
  });

  it('returning user >7d old — refreshes expires_at to now + 14d', async () => {
    // First signup
    const first = await callTrialSignup(
      {
        email: 'stale@example.com',
        device_id: 'dev_stale_1',
        app_version: '1.0.0',
      },
      '203.0.113.20',
    );
    expect(first.status).toBe(200);

    const before = await env.DB.prepare(
      `SELECT l.license_id, l.expires_at, l.grace_until
       FROM license l JOIN customer c ON l.user_id = c.user_id
       WHERE c.email = ?`,
    )
      .bind('stale@example.com')
      .first<{ license_id: string; expires_at: number; grace_until: number }>();

    // Rewind issued_at by 8 days to make it stale (>REVOCATION_CHECK_INTERVAL_S = 7d)
    const now = Math.floor(Date.now() / 1000);
    const staleIssued = now - 8 * DAY_S;
    await env.DB.prepare('UPDATE license SET issued_at = ? WHERE license_id = ?')
      .bind(staleIssued, before?.license_id)
      .run();

    // Second signup — should refresh
    const second = await callTrialSignup(
      {
        email: 'stale@example.com',
        device_id: 'dev_stale_2',
        app_version: '1.0.0',
      },
      '203.0.113.21',
    );
    expect(second.status).toBe(200);
    const body = await second.json<{ license_key: string; jwt: string }>();
    expect(body.jwt.split('.').length).toBe(3);

    const after = await env.DB.prepare(
      `SELECT l.expires_at, l.grace_until, l.issued_at
       FROM license l JOIN customer c ON l.user_id = c.user_id
       WHERE c.email = ?`,
    )
      .bind('stale@example.com')
      .first<{ expires_at: number; grace_until: number; issued_at: number }>();
    // issued_at should have been refreshed (no longer the stale 8-days-ago value)
    expect(after?.issued_at).toBeGreaterThan(staleIssued);
    expect((after?.expires_at ?? 0) - (after?.issued_at ?? 0)).toBe(14 * DAY_S);
    expect((after?.grace_until ?? 0) - (after?.expires_at ?? 0)).toBe(30 * DAY_S);
  });

  it('returning user <7d old — does NOT refresh expires_at', async () => {
    const first = await callTrialSignup(
      {
        email: 'recent@example.com',
        device_id: 'dev_recent_1',
        app_version: '1.0.0',
      },
      '203.0.113.30',
    );
    expect(first.status).toBe(200);

    const before = await env.DB.prepare(
      `SELECT l.expires_at, l.issued_at
       FROM license l JOIN customer c ON l.user_id = c.user_id
       WHERE c.email = ?`,
    )
      .bind('recent@example.com')
      .first<{ expires_at: number; issued_at: number }>();

    // Second signup right after — issued_at is fresh, should NOT refresh
    const second = await callTrialSignup(
      {
        email: 'recent@example.com',
        device_id: 'dev_recent_2',
        app_version: '1.0.0',
      },
      '203.0.113.31',
    );
    expect(second.status).toBe(200);

    const after = await env.DB.prepare(
      `SELECT l.expires_at, l.issued_at
       FROM license l JOIN customer c ON l.user_id = c.user_id
       WHERE c.email = ?`,
    )
      .bind('recent@example.com')
      .first<{ expires_at: number; issued_at: number }>();
    expect(after?.expires_at).toBe(before?.expires_at);
    expect(after?.issued_at).toBe(before?.issued_at);
  });

  it('already-paid customer returns 409 BadRequest', async () => {
    // Manually seed a paid customer
    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare('INSERT INTO customer (user_id, email, created_at) VALUES (?, ?, ?)')
      .bind('usr_paid', 'paid@example.com', now)
      .run();
    await env.DB.prepare(
      `INSERT INTO license
       (license_id, user_id, humanized_key, plan, features, devices_max, issued_at, expires_at, grace_until, revoked)
       VALUES (?, ?, ?, 'base@2026-q2', '["inventory"]', 1, ?, ?, ?, 0)`,
    )
      .bind(
        'lic_paid',
        'usr_paid',
        'cbk-paidx-aaaaa-bbbbb-ccccc',
        now,
        now + 365 * DAY_S,
        now + 395 * DAY_S,
      )
      .run();

    const res = await callTrialSignup(
      {
        email: 'paid@example.com',
        device_id: 'dev_paid',
        app_version: '1.0.0',
      },
      '203.0.113.40',
    );
    expect(res.status).toBe(409);
    const body = await res.json<{ error: { _tag: string; message: string } }>();
    expect(body.error._tag).toBe('BadRequest');
    expect(body.error.message).toBe('AlreadyPaid');
  });

  it('bad email returns 400 BadRequest', async () => {
    const res = await callTrialSignup(
      {
        email: 'not-an-email',
        device_id: 'dev_bad',
        app_version: '1.0.0',
      },
      '203.0.113.50',
    );
    expect(res.status).toBe(400);
    const body = await res.json<{ error: { _tag: string } }>();
    expect(body.error._tag).toBe('BadRequest');
  });

  it('6th signup from same IP within 24h returns 429 RateLimited', async () => {
    const ip = '198.51.100.1';
    for (let i = 0; i < 5; i++) {
      const r = await callTrialSignup(
        {
          email: `rl${i}@example.com`,
          device_id: `dev_rl_${i}`,
          app_version: '1.0.0',
        },
        ip,
      );
      expect(r.status).toBe(200);
    }

    const blocked = await callTrialSignup(
      {
        email: 'rl6@example.com',
        device_id: 'dev_rl_6',
        app_version: '1.0.0',
      },
      ip,
    );
    expect(blocked.status).toBe(429);
    const body = await blocked.json<{ error: { _tag: string } }>();
    expect(body.error._tag).toBe('RateLimited');
  });
});
