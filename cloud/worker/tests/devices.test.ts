import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../src/index.js';
import { signSessionJwt } from '../src/lib/session.js';

const SESSION_KEY = '7f12345678901234567890123456789012345678901234567890123456789012';

async function authedPost(path: string, userId: string): Promise<Response> {
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
    method: 'POST',
    headers: { Cookie: `session=${jwt}` },
  });
  const ctx = createExecutionContext();
  // biome-ignore lint/suspicious/noExplicitAny: test override of env secret
  (env as any).SESSION_PRIVATE_KEY_HEX = SESSION_KEY;
  const res = await worker.fetch(req, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

describe('POST /v1/devices/:id/deactivate', () => {
  it('removes the device from D1 and updates the KV record', async () => {
    await env.DB.prepare('INSERT INTO customer (user_id, email, created_at) VALUES (?, ?, ?)')
      .bind('usr_dev', 'dev@example.com', 1)
      .run();
    await env.DB.prepare(
      `INSERT INTO license (license_id, user_id, humanized_key, plan, features, devices_max, issued_at, expires_at, grace_until)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind('lic_dev', 'usr_dev', 'cbk-aaaaa-bbbbb-dev01-eeeee', 'base@2026-q2', '[]', 2, 1, 2, 3)
      .run();
    await env.DB.prepare(
      'INSERT INTO device (device_id, license_id, first_seen_at, last_ping_at) VALUES (?, ?, ?, ?)',
    )
      .bind('dev_to_kill', 'lic_dev', 1, 1)
      .run();
    await env.LICENSE_ACTIVE.put(
      'la:lic_dev',
      JSON.stringify({
        license_id: 'lic_dev',
        user_id: 'usr_dev',
        plan: 'base@2026-q2',
        features: [],
        devices_max: 2,
        device_ids: ['dev_to_kill', 'dev_other'],
        issued_at: 1,
        expires_at: 2,
        grace_until: 3,
        revoked: false,
        revoked_at: null,
        revoked_reason: null,
        stripe_subscription_id: null,
      }),
    );

    const res = await authedPost('/v1/devices/dev_to_kill/deactivate', 'usr_dev');
    expect(res.status).toBe(200);

    const row = await env.DB.prepare('SELECT * FROM device WHERE device_id = ?')
      .bind('dev_to_kill')
      .first();
    expect(row).toBeNull();

    const raw = await env.LICENSE_ACTIVE.get('la:lic_dev');
    expect(raw).not.toBeNull();
    const rec = JSON.parse(raw ?? '{}') as { device_ids: string[] };
    expect(rec.device_ids).toEqual(['dev_other']);
  });

  it('returns 404 for a device that does not belong to the user', async () => {
    await env.DB.prepare('INSERT INTO customer (user_id, email, created_at) VALUES (?, ?, ?)')
      .bind('usr_dev_other', 'other@example.com', 1)
      .run();
    const res = await authedPost('/v1/devices/never-existed/deactivate', 'usr_dev_other');
    expect(res.status).toBe(404);
  });

  it('returns 401 without a session cookie', async () => {
    const req = new Request('https://carbonink.xyz/api/v1/devices/anything/deactivate', {
      method: 'POST',
    });
    const ctx = createExecutionContext();
    // biome-ignore lint/suspicious/noExplicitAny: test override of env secret
    (env as any).SESSION_PRIVATE_KEY_HEX = SESSION_KEY;
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });
});
