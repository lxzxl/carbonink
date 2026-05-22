import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../src/index.js';

const SESSION_KEY = '7f12345678901234567890123456789012345678901234567890123456789012';

async function call(path: string, body: unknown): Promise<Response> {
  const req = new Request(`https://api.carbonbook.app${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const ctx = createExecutionContext();
  // biome-ignore lint/suspicious/noExplicitAny: test override of env secrets
  (env as any).SESSION_PRIVATE_KEY_HEX = SESSION_KEY;
  // biome-ignore lint/suspicious/noExplicitAny: test override of env secrets
  (env as any).RESEND_API_KEY = 'test_re_key';
  const res = await worker.fetch(req, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

describe('POST /v1/auth/magic-link + /v1/auth/exchange', () => {
  it('magic-link returns 200 even for unknown emails (no enumeration)', async () => {
    const res = await call('/v1/auth/magic-link', { email: 'nobody-auth-test@example.com' });
    expect(res.status).toBe(200);
    const body = await res.json<{ sent: boolean }>();
    expect(body.sent).toBe(true);
  });

  it('full flow: magic-link → exchange → session cookie set', async () => {
    await env.DB.prepare('INSERT INTO customer (user_id, email, created_at) VALUES (?, ?, ?)')
      .bind('usr_auth_flow', 'auth-flow@example.com', 1)
      .run();
    const res = await call('/v1/auth/magic-link', { email: 'auth-flow@example.com' });
    expect(res.status).toBe(200);

    // The email is sent via ctx.waitUntil; the token lives in KV.
    const { keys } = await env.RATE_LIMIT.list({ prefix: 'ml:' });
    expect(keys.length).toBeGreaterThanOrEqual(1);
    const last = keys[keys.length - 1];
    if (!last) throw new Error('expected at least one ml:* key');
    const token = last.name.slice('ml:'.length);

    const exch = await call('/v1/auth/exchange', { token });
    expect(exch.status).toBe(200);
    const setCookie = exch.headers.get('Set-Cookie');
    expect(setCookie).toMatch(/^session=/);
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Lax/);
    expect(setCookie).toMatch(/Secure/);
    const body = await exch.json<{ session: string }>();
    expect(body.session.split('.').length).toBe(3);
  });

  it('exchange consumes the token (single-use)', async () => {
    await env.DB.prepare('INSERT INTO customer (user_id, email, created_at) VALUES (?, ?, ?)')
      .bind('usr_auth_single', 'single-use@example.com', 1)
      .run();
    await call('/v1/auth/magic-link', { email: 'single-use@example.com' });
    const { keys } = await env.RATE_LIMIT.list({ prefix: 'ml:' });
    const last = keys[keys.length - 1];
    if (!last) throw new Error('expected at least one ml:* key');
    const token = last.name.slice('ml:'.length);

    const first = await call('/v1/auth/exchange', { token });
    expect(first.status).toBe(200);
    const second = await call('/v1/auth/exchange', { token });
    expect(second.status).toBe(401);
  });

  it('exchange of unknown token returns 401', async () => {
    const res = await call('/v1/auth/exchange', { token: 'never-existed-token' });
    expect(res.status).toBe(401);
  });

  it('bad email returns 400', async () => {
    const res = await call('/v1/auth/magic-link', { email: 'not-an-email' });
    expect(res.status).toBe(400);
  });
});
