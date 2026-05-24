import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../src/index.js';
import { TEST_PRIVATE_KEY_HEX } from './_fixtures.js';

const TEST_ENV = {
  LICENSE_PRIVATE_KEY_HEX: TEST_PRIVATE_KEY_HEX,
  SESSION_PRIVATE_KEY_HEX: TEST_PRIVATE_KEY_HEX,
  RESEND_API_KEY: 'test_re_key',
};

async function call(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  const req = new Request(`https://carbonink.xyz/api${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'CF-Connecting-IP': '198.51.100.42',
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const ctx = createExecutionContext();
  const res = await worker.fetch(req, { ...env, ...TEST_ENV } as never, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

describe('e2e: trial → activate → verify', () => {
  it('completes the full happy path', async () => {
    // 1. Trial signup
    const trialRes = await call('/v1/trial-signup', {
      email: 'e2e@example.com',
      device_id: 'dev_e2e',
      app_version: '0.5.0',
    });
    expect(trialRes.status).toBe(200);
    const trial = await trialRes.json<{ license_key: string; jwt: string }>();
    expect(trial.license_key).toMatch(/^cbk-/);

    // 2. Activate with the key
    const activateRes = await call('/v1/activate', {
      license_key: trial.license_key,
      device_id: 'dev_e2e',
      app_version: '0.5.0',
      os: 'darwin',
    });
    expect(activateRes.status).toBe(200);
    const activate = await activateRes.json<{ jwt: string; claims: { license_id: string } }>();
    const licenseId = activate.claims.license_id;

    // 3. Verify
    const verifyRes = await call('/v1/verify', {
      license_id: licenseId,
      device_id: 'dev_e2e',
      app_version: '0.5.0',
      os: 'darwin',
    });
    expect(verifyRes.status).toBe(200);
    const verify = await verifyRes.json<{ jwt: string; revoked: boolean }>();
    expect(verify.revoked).toBe(false);
    expect(verify.jwt.split('.').length).toBe(3);

    // 4. Verify D1 state
    const customer = await env.DB.prepare('SELECT user_id FROM customer WHERE email = ?')
      .bind('e2e@example.com')
      .first();
    expect(customer).toBeTruthy();
    const license = await env.DB.prepare('SELECT plan FROM license WHERE license_id = ?')
      .bind(licenseId)
      .first<{ plan: string }>();
    expect(license?.plan).toBe('trial@14d');
    const device = await env.DB.prepare(
      'SELECT app_version FROM device WHERE device_id = ? AND license_id = ?',
    )
      .bind('dev_e2e', licenseId)
      .first<{ app_version: string }>();
    expect(device?.app_version).toBe('0.5.0');

    // 5. Verify KV state
    const active = await env.LICENSE_ACTIVE.get(`la:${licenseId}`);
    expect(active).toBeTruthy();
    const humanized = await env.HUMANIZED_KEYS.get(`hk:${trial.license_key}`);
    expect(humanized).toBe(licenseId);
  });
});
