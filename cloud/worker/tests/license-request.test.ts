import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import worker from '../src/index.js';

/**
 * POST /api/v1/license-request — the marketing-site "申请早期试用" form.
 *
 * Covers four behaviors that matter operationally:
 *   1. Happy path inserts a D1 row AND notifies support.
 *   2. Bad email shape is rejected by zod before any DB/email cost.
 *   3. Per-IP rate-limit (10/hour) stops scripted floods.
 *   4. Per-email 24h dedup keeps subsequent submissions in D1 (we want
 *      the signal) but skips re-notifying support's inbox.
 *
 * We capture the EMAIL.send() calls via a vi.fn stub so we can assert
 * "support got 1 mail" / "support got 0 mails" without parsing fetch
 * mocks — the binding is a Workers `send_email`, not a fetch.
 */

function makeReq(body: unknown, ip = '203.0.113.71'): Request {
  return new Request('https://carbonink.xyz/api/v1/license-request', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'CF-Connecting-IP': ip,
      'User-Agent': 'vitest/test',
    },
    body: JSON.stringify(body),
  });
}

async function callLicenseRequest(body: unknown, ip?: string, sendSpy?: ReturnType<typeof vi.fn>) {
  const spy = sendSpy ?? vi.fn().mockResolvedValue(undefined);
  // biome-ignore lint/suspicious/noExplicitAny: test override of env binding
  (env as any).EMAIL = { send: spy };
  const ctx = createExecutionContext();
  const res = await worker.fetch(makeReq(body, ip), env, ctx);
  await waitOnExecutionContext(ctx);
  return { res, spy };
}

describe('POST /v1/license-request', () => {
  it('valid submission inserts D1 row and notifies support exactly once', async () => {
    const { res, spy } = await callLicenseRequest(
      { email: 'lead-a@example.com', source: 'pricing-page', lang: 'zh-CN' },
      '203.0.113.71',
    );
    expect(res.status).toBe(200);

    const row = await env.DB.prepare(
      'SELECT email, source, lang, ip, user_agent, status FROM license_request WHERE email = ?',
    )
      .bind('lead-a@example.com')
      .first<{
        email: string;
        source: string;
        lang: string;
        ip: string;
        user_agent: string;
        status: string;
      }>();
    expect(row?.email).toBe('lead-a@example.com');
    expect(row?.source).toBe('pricing-page');
    expect(row?.lang).toBe('zh-CN');
    expect(row?.ip).toBe('203.0.113.71');
    expect(row?.user_agent).toBe('vitest/test');
    expect(row?.status).toBe('pending');

    expect(spy).toHaveBeenCalledTimes(1);
    const sent = spy.mock.calls[0]?.[0] as { to: string; subject: string };
    expect(sent.to).toBe('support@carbonink.xyz');
    expect(sent.subject).toContain('lead-a@example.com');
  });

  it('rejects malformed email with 400 before touching D1', async () => {
    const { res, spy } = await callLicenseRequest(
      { email: 'not-an-email', source: 'pricing-page' },
      '203.0.113.72',
    );
    expect(res.status).toBe(400);
    const body = await res.json<{ error: { _tag: string } }>();
    expect(body.error._tag).toBe('BadRequest');
    expect(spy).not.toHaveBeenCalled();

    const cnt = await env.DB.prepare('SELECT COUNT(*) AS c FROM license_request WHERE email = ?')
      .bind('not-an-email')
      .first<{ c: number }>();
    expect(cnt?.c).toBe(0);
  });

  it('11th submission from same IP within window is rate-limited (429)', async () => {
    const ip = '203.0.113.73';
    // 10 distinct emails to keep dedup out of the picture — we're
    // exercising the per-IP limit (10/hour), not the per-email dedup.
    for (let i = 0; i < 10; i++) {
      const { res } = await callLicenseRequest(
        { email: `flood-${i}@example.com`, source: 'pricing-page' },
        ip,
      );
      expect(res.status).toBe(200);
    }
    const { res: blocked, spy } = await callLicenseRequest(
      { email: 'flood-11@example.com', source: 'pricing-page' },
      ip,
    );
    expect(blocked.status).toBe(429);
    const body = await blocked.json<{ error: { _tag: string } }>();
    expect(body.error._tag).toBe('RateLimited');
    // Rate-limited request must not have queued a notification email.
    expect(spy).not.toHaveBeenCalled();
  });

  it('same email re-submits within 24h: D1 row inserted, support not re-notified', async () => {
    const email = 'duplicate@example.com';
    const first = await callLicenseRequest({ email, source: 'pricing-page' }, '203.0.113.74');
    expect(first.res.status).toBe(200);
    expect(first.spy).toHaveBeenCalledTimes(1);

    // Different IP so we don't trip the per-IP limit; same email
    // exercises the per-email dedup KV gate.
    const second = await callLicenseRequest({ email, source: 'home' }, '203.0.113.75');
    expect(second.res.status).toBe(200);
    expect(second.spy).not.toHaveBeenCalled();

    // Both submissions must still land in D1 — the dedup is purely a
    // notification gate, not an insert gate.
    const cnt = await env.DB.prepare('SELECT COUNT(*) AS c FROM license_request WHERE email = ?')
      .bind(email)
      .first<{ c: number }>();
    expect(cnt?.c).toBe(2);
  });
});
