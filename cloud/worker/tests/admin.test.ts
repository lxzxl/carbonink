import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index.js';
import { signSessionJwt } from '../src/lib/session.js';
import { TEST_PRIVATE_KEY_HEX } from './_fixtures.js';

/**
 * Admin license-request endpoints — the operator-facing surface that
 * can mint licenses, mark requests handled, and re-trigger activation
 * emails. These are the only routes that create new `customer` rows
 * outside of trial-signup, so test coverage is non-negotiable.
 *
 * Auth gate is exercised once per endpoint (401 no cookie, 403 wrong
 * email). State-machine transitions are exercised end-to-end:
 *   - Issue: new-email / trial-upgrade / already-paid-conflict
 *   - Dismiss: pending → dismissed; already-dismissed → 404
 *   - Resend: issued → mail sent; pending → 409
 */

const SESSION_KEY = '7f12345678901234567890123456789012345678901234567890123456789012';
const ADMIN_EMAIL = 'admin@carbonink.xyz';
const DAY_S = 86_400;

beforeEach(() => {
  // biome-ignore lint/suspicious/noExplicitAny: test override of env secrets/vars
  (env as any).SESSION_PRIVATE_KEY_HEX = SESSION_KEY;
  // biome-ignore lint/suspicious/noExplicitAny: test override of env secrets/vars
  (env as any).LICENSE_PRIVATE_KEY_HEX = TEST_PRIVATE_KEY_HEX;
  // biome-ignore lint/suspicious/noExplicitAny: test override of env secrets/vars
  (env as any).ADMIN_EMAIL = ADMIN_EMAIL;
  // biome-ignore lint/suspicious/noExplicitAny: test override of env binding
  (env as any).EMAIL = { send: vi.fn().mockResolvedValue(undefined) };
});

async function adminSessionCookie(email = ADMIN_EMAIL): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const jwt = await signSessionJwt(
    {
      iss: 'carbonink.xyz/account',
      sub: 'usr_admin_test',
      email,
      iat: now,
      exp: now + 3600,
    },
    SESSION_KEY,
  );
  return `session=${jwt}`;
}

async function call(
  method: 'GET' | 'POST',
  path: string,
  opts: { cookie?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.cookie) headers.Cookie = opts.cookie;
  const req = new Request(`https://carbonink.xyz/api${path}`, { method, headers });
  const ctx = createExecutionContext();
  const res = await worker.fetch(req, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

async function seedLicenseRequest(opts: {
  email: string;
  status?: 'pending' | 'issued' | 'dismissed';
  issuedLicenseId?: string | null;
  lang?: string | null;
  source?: string | null;
  createdAt?: number;
}): Promise<number> {
  const now = opts.createdAt ?? Math.floor(Date.now() / 1000);
  const result = await env.DB.prepare(
    `INSERT INTO license_request
       (email, source, lang, user_agent, ip, created_at, status, issued_license_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      opts.email,
      opts.source ?? 'pricing-page',
      opts.lang ?? 'zh-CN',
      'vitest/test',
      '203.0.113.99',
      now,
      opts.status ?? 'pending',
      opts.issuedLicenseId ?? null,
    )
    .run();
  // D1 returns last_row_id in meta
  return Number(result.meta.last_row_id ?? 0);
}

// ───────────────────────────── LIST ─────────────────────────────

describe('GET /v1/admin/license-requests (auth + filter)', () => {
  it('401 without session cookie', async () => {
    const res = await call('GET', '/v1/admin/license-requests');
    expect(res.status).toBe(401);
  });

  it('403 when session belongs to a non-admin', async () => {
    const cookie = await adminSessionCookie('someone-else@example.com');
    const res = await call('GET', '/v1/admin/license-requests', { cookie });
    expect(res.status).toBe(403);
  });

  it('lists only pending by default, most-recent first', async () => {
    const t = Math.floor(Date.now() / 1000);
    await seedLicenseRequest({ email: 'pending-old@example.com', createdAt: t - 100 });
    await seedLicenseRequest({ email: 'pending-new@example.com', createdAt: t });
    await seedLicenseRequest({ email: 'issued-x@example.com', status: 'issued' });

    const cookie = await adminSessionCookie();
    const res = await call('GET', '/v1/admin/license-requests', { cookie });
    expect(res.status).toBe(200);
    const body = await res.json<{ requests: Array<{ email: string; status: string }> }>();
    const emails = body.requests.filter((r) => r.email.startsWith('pending-')).map((r) => r.email);
    // newest first
    expect(emails[0]).toBe('pending-new@example.com');
    expect(emails[1]).toBe('pending-old@example.com');
    // no issued rows leak in
    expect(body.requests.find((r) => r.email === 'issued-x@example.com')).toBeUndefined();
  });

  it('?status=issued returns only issued rows', async () => {
    await seedLicenseRequest({ email: 'filter-pending@example.com' });
    await seedLicenseRequest({
      email: 'filter-issued@example.com',
      status: 'issued',
      issuedLicenseId: 'lic_filter',
    });

    const cookie = await adminSessionCookie();
    const res = await call('GET', '/v1/admin/license-requests?status=issued', { cookie });
    expect(res.status).toBe(200);
    const body = await res.json<{ requests: Array<{ email: string; status: string }> }>();
    const emails = body.requests.filter((r) => r.email.startsWith('filter-')).map((r) => r.email);
    expect(emails).toContain('filter-issued@example.com');
    expect(emails).not.toContain('filter-pending@example.com');
  });
});

// ───────────────────────────── ISSUE ────────────────────────────

describe('POST /v1/admin/license-requests/:id/issue', () => {
  it('401 without session', async () => {
    const id = await seedLicenseRequest({ email: 'issue-noauth@example.com' });
    const res = await call('POST', `/v1/admin/license-requests/${id}/issue`);
    expect(res.status).toBe(401);
  });

  it('404 when request id does not exist', async () => {
    const cookie = await adminSessionCookie();
    const res = await call('POST', '/v1/admin/license-requests/9999999/issue', { cookie });
    expect(res.status).toBe(404);
  });

  it('409 when license_request is not pending', async () => {
    const id = await seedLicenseRequest({
      email: 'already-issued@example.com',
      status: 'issued',
      issuedLicenseId: 'lic_already',
    });
    const cookie = await adminSessionCookie();
    const res = await call('POST', `/v1/admin/license-requests/${id}/issue`, { cookie });
    expect(res.status).toBe(409);
  });

  it('new email: creates customer + license, marks request issued, mails activation', async () => {
    const id = await seedLicenseRequest({ email: 'brand-new@example.com', lang: 'zh-CN' });
    const cookie = await adminSessionCookie();
    const res = await call('POST', `/v1/admin/license-requests/${id}/issue`, { cookie });
    expect(res.status).toBe(200);
    const body = await res.json<{ license_id: string; license_key: string }>();
    expect(body.license_id).toBeTruthy();
    expect(body.license_key).toMatch(/^cik-/);

    const customer = await env.DB.prepare('SELECT user_id FROM customer WHERE email = ?')
      .bind('brand-new@example.com')
      .first<{ user_id: string }>();
    expect(customer?.user_id).toBeTruthy();

    const lic = await env.DB.prepare(
      'SELECT plan, expires_at, issued_at FROM license WHERE license_id = ?',
    )
      .bind(body.license_id)
      .first<{ plan: string; expires_at: number; issued_at: number }>();
    expect(lic?.plan).toBe('base@2026-q2');
    expect((lic?.expires_at ?? 0) - (lic?.issued_at ?? 0)).toBe(90 * DAY_S);

    const reqRow = await env.DB.prepare(
      'SELECT status, issued_license_id, processed_by FROM license_request WHERE id = ?',
    )
      .bind(id)
      .first<{ status: string; issued_license_id: string; processed_by: string }>();
    expect(reqRow?.status).toBe('issued');
    expect(reqRow?.issued_license_id).toBe(body.license_id);
    expect(reqRow?.processed_by).toBe(ADMIN_EMAIL);

    // Active record is persisted to KV — the desktop /activate call
    // will look this up by humanized_key → license_id.
    const activeRaw = await env.LICENSE_ACTIVE.get(`la:${body.license_id}`);
    expect(activeRaw).toBeTruthy();
    const hkLookup = await env.HUMANIZED_KEYS.get(`hk:${body.license_key}`);
    expect(hkLookup).toBe(body.license_id);

    // Activation email queued.
    const sendSpy = (env as unknown as { EMAIL: { send: ReturnType<typeof vi.fn> } }).EMAIL.send;
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy.mock.calls[0]?.[0].to).toBe('brand-new@example.com');
  });

  it('existing trial customer: upgrades plan in place (reuses license_id)', async () => {
    // Seed a trial customer + license — matches what trial-signup would
    // have created on the desktop side.
    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare('INSERT INTO customer (user_id, email, created_at) VALUES (?, ?, ?)')
      .bind('usr_trial_upgrade', 'trial-up@example.com', now)
      .run();
    await env.DB.prepare(
      `INSERT INTO license
         (license_id, user_id, humanized_key, plan, features, devices_max,
          issued_at, expires_at, grace_until, revoked)
       VALUES (?, ?, ?, 'trial@14d', '["inventory"]', 1, ?, ?, ?, 0)`,
    )
      .bind(
        'lic_trial_upgrade',
        'usr_trial_upgrade',
        'cik-trial-upgrd-zzzzz-yyyyy',
        now,
        now + 14 * DAY_S,
        now + 44 * DAY_S,
      )
      .run();

    const id = await seedLicenseRequest({ email: 'trial-up@example.com' });
    const cookie = await adminSessionCookie();
    const res = await call('POST', `/v1/admin/license-requests/${id}/issue`, { cookie });
    expect(res.status).toBe(200);
    const body = await res.json<{ license_id: string }>();
    // Same license_id reused — the desktop activation keeps working.
    expect(body.license_id).toBe('lic_trial_upgrade');

    const lic = await env.DB.prepare(
      'SELECT plan, expires_at, issued_at FROM license WHERE license_id = ?',
    )
      .bind('lic_trial_upgrade')
      .first<{ plan: string; expires_at: number; issued_at: number }>();
    expect(lic?.plan).toBe('base@2026-q2');
    expect((lic?.expires_at ?? 0) - (lic?.issued_at ?? 0)).toBe(90 * DAY_S);
  });

  it('existing non-trial customer: refuses with 409 (avoid double-issue)', async () => {
    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare('INSERT INTO customer (user_id, email, created_at) VALUES (?, ?, ?)')
      .bind('usr_already_paid', 'paid-up@example.com', now)
      .run();
    await env.DB.prepare(
      `INSERT INTO license
         (license_id, user_id, humanized_key, plan, features, devices_max,
          issued_at, expires_at, grace_until, revoked)
       VALUES (?, ?, ?, 'base@2026-q2', '["inventory"]', 1, ?, ?, ?, 0)`,
    )
      .bind(
        'lic_already_paid',
        'usr_already_paid',
        'cik-paidup-aaaaa-bbbbb-ccccc',
        now,
        now + 365 * DAY_S,
        now + 395 * DAY_S,
      )
      .run();

    const id = await seedLicenseRequest({ email: 'paid-up@example.com' });
    const cookie = await adminSessionCookie();
    const res = await call('POST', `/v1/admin/license-requests/${id}/issue`, { cookie });
    expect(res.status).toBe(409);

    // license_request must NOT have been marked issued — the admin
    // needs to dismiss it manually instead of silently flipping state.
    const row = await env.DB.prepare('SELECT status FROM license_request WHERE id = ?')
      .bind(id)
      .first<{ status: string }>();
    expect(row?.status).toBe('pending');
  });
});

// ───────────────────────────── DISMISS ──────────────────────────

describe('POST /v1/admin/license-requests/:id/dismiss', () => {
  it('401 without session', async () => {
    const id = await seedLicenseRequest({ email: 'dismiss-noauth@example.com' });
    const res = await call('POST', `/v1/admin/license-requests/${id}/dismiss`);
    expect(res.status).toBe(401);
  });

  it('flips pending → dismissed with processed_at + processed_by', async () => {
    const id = await seedLicenseRequest({ email: 'dismiss-me@example.com' });
    const cookie = await adminSessionCookie();
    const res = await call('POST', `/v1/admin/license-requests/${id}/dismiss`, { cookie });
    expect(res.status).toBe(200);

    const row = await env.DB.prepare(
      'SELECT status, processed_at, processed_by FROM license_request WHERE id = ?',
    )
      .bind(id)
      .first<{ status: string; processed_at: number; processed_by: string }>();
    expect(row?.status).toBe('dismissed');
    expect(row?.processed_at).toBeGreaterThan(0);
    expect(row?.processed_by).toBe(ADMIN_EMAIL);
  });

  it('404 when the row is not pending (already dismissed or issued)', async () => {
    const id = await seedLicenseRequest({
      email: 'already-dismissed@example.com',
      status: 'dismissed',
    });
    const cookie = await adminSessionCookie();
    const res = await call('POST', `/v1/admin/license-requests/${id}/dismiss`, { cookie });
    expect(res.status).toBe(404);
  });
});

// ───────────────────────────── RESEND ───────────────────────────

describe('POST /v1/admin/license-requests/:id/resend', () => {
  it('401 without session', async () => {
    const res = await call('POST', '/v1/admin/license-requests/1/resend');
    expect(res.status).toBe(401);
  });

  it('404 when the row has no JOIN-able license (still pending)', async () => {
    // No issued_license_id → the JOIN to `license` returns no row →
    // we surface 404 because there's nothing to resend.
    const id = await seedLicenseRequest({ email: 'resend-pending@example.com' });
    const cookie = await adminSessionCookie();
    const res = await call('POST', `/v1/admin/license-requests/${id}/resend`, { cookie });
    expect(res.status).toBe(404);
  });

  it('issued row: re-fires activation email with the original humanized key', async () => {
    // Seed a customer + license, then a license_request that points to it.
    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare('INSERT INTO customer (user_id, email, created_at) VALUES (?, ?, ?)')
      .bind('usr_resend', 'resend@example.com', now)
      .run();
    await env.DB.prepare(
      `INSERT INTO license
         (license_id, user_id, humanized_key, plan, features, devices_max,
          issued_at, expires_at, grace_until, revoked)
       VALUES (?, ?, ?, 'base@2026-q2', '["inventory"]', 1, ?, ?, ?, 0)`,
    )
      .bind(
        'lic_resend',
        'usr_resend',
        'cik-resend-rrrrr-sssss-ttttt',
        now,
        now + 90 * DAY_S,
        now + 120 * DAY_S,
      )
      .run();
    const id = await seedLicenseRequest({
      email: 'resend@example.com',
      status: 'issued',
      issuedLicenseId: 'lic_resend',
      lang: 'en',
    });

    const cookie = await adminSessionCookie();
    const res = await call('POST', `/v1/admin/license-requests/${id}/resend`, { cookie });
    expect(res.status).toBe(200);

    const sendSpy = (env as unknown as { EMAIL: { send: ReturnType<typeof vi.fn> } }).EMAIL.send;
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const msg = sendSpy.mock.calls[0]?.[0] as { to: string; subject: string; text: string };
    expect(msg.to).toBe('resend@example.com');
    // English lang from the original request — verifies we don't
    // default zh-CN regardless of the requester's stored lang.
    expect(msg.subject).toBe('Your CarbonInk activation key');
    expect(msg.text).toContain('cik-resend-rrrrr-sssss-ttttt');
  });
});
