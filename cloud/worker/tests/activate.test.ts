import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../src/index.js';
import { seedLicense, TEST_PRIVATE_KEY_HEX } from './_fixtures.js';

function makeReq(body: unknown): Request {
  return new Request('https://carbonink.xyz/api/v1/activate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function callActivate(body: unknown) {
  // biome-ignore lint/suspicious/noExplicitAny: test override of env secret
  (env as any).LICENSE_PRIVATE_KEY_HEX = TEST_PRIVATE_KEY_HEX;
  const ctx = createExecutionContext();
  const res = await worker.fetch(makeReq(body), env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

describe('POST /v1/activate', () => {
  it('happy path returns JWT + claims and records the device', async () => {
    await seedLicense({
      licenseId: 'lic_happy',
      userId: 'usr_happy',
      humanizedKey: 'cbk-happy-aaaaa-bbbbb-ccccc',
    });

    const res = await callActivate({
      license_key: 'cbk-happy-aaaaa-bbbbb-ccccc',
      device_id: 'dev_happy_1',
      app_version: '1.0.0',
      os: 'darwin',
    });

    expect(res.status).toBe(200);
    const body = await res.json<{ jwt: string; claims: { license_id: string } }>();
    expect(body.jwt.split('.').length).toBe(3);
    expect(body.claims.license_id).toBe('lic_happy');

    const dev = await env.DB.prepare('SELECT * FROM device WHERE device_id = ? AND license_id = ?')
      .bind('dev_happy_1', 'lic_happy')
      .first();
    expect(dev).toBeTruthy();
  });

  it('unknown license key returns 404 UnknownKey', async () => {
    const res = await callActivate({
      license_key: 'cbk-zzzzz-zzzzz-zzzzz-zzzzz',
      device_id: 'dev_unknown',
      app_version: '1.0.0',
      os: 'darwin',
    });
    expect(res.status).toBe(404);
    const body = await res.json<{ error: { _tag: string } }>();
    expect(body.error._tag).toBe('UnknownKey');
  });

  it('revoked license returns 403 RevokedLicense with reason', async () => {
    await seedLicense({
      licenseId: 'lic_revoked',
      userId: 'usr_revoked',
      humanizedKey: 'cbk-rvkkk-aaaaa-bbbbb-ccccc',
      revoked: true,
      revokedReason: 'refund_issued',
    });

    const res = await callActivate({
      license_key: 'cbk-rvkkk-aaaaa-bbbbb-ccccc',
      device_id: 'dev_revoked_1',
      app_version: '1.0.0',
      os: 'darwin',
    });

    expect(res.status).toBe(403);
    const body = await res.json<{ error: { _tag: string; message: string } }>();
    expect(body.error._tag).toBe('RevokedLicense');
    expect(body.error.message).toBe('refund_issued');
  });

  it('exceeding device cap returns 409 DeviceCapReached', async () => {
    await seedLicense({
      licenseId: 'lic_cap',
      userId: 'usr_cap',
      humanizedKey: 'cbk-capxx-aaaaa-bbbbb-ccccc',
      devicesMax: 1,
      devices: ['dev_existing'],
    });

    const res = await callActivate({
      license_key: 'cbk-capxx-aaaaa-bbbbb-ccccc',
      device_id: 'dev_new',
      app_version: '1.0.0',
      os: 'darwin',
    });

    expect(res.status).toBe(409);
    const body = await res.json<{ error: { _tag: string } }>();
    expect(body.error._tag).toBe('DeviceCapReached');
  });

  it('re-activation of an already-registered device is idempotent', async () => {
    await seedLicense({
      licenseId: 'lic_idem',
      userId: 'usr_idem',
      humanizedKey: 'cbk-demmm-aaaaa-bbbbb-ccccc',
      devicesMax: 1,
      devices: ['dev_idem'],
    });

    const res = await callActivate({
      license_key: 'cbk-demmm-aaaaa-bbbbb-ccccc',
      device_id: 'dev_idem',
      app_version: '1.0.1',
      os: 'darwin',
    });

    expect(res.status).toBe(200);
    const active = await env.LICENSE_ACTIVE.get('la:lic_idem');
    expect(active).toBeTruthy();
    const record = JSON.parse(active as string) as { device_ids: string[] };
    expect(record.device_ids).toEqual(['dev_idem']);
  });

  it('11th rapid activation on the same key returns 429 RateLimited', async () => {
    await seedLicense({
      licenseId: 'lic_rl',
      userId: 'usr_rl',
      humanizedKey: 'cbk-rrrrr-aaaaa-bbbbb-ccccc',
      devicesMax: 99,
    });

    for (let i = 0; i < 10; i++) {
      const r = await callActivate({
        license_key: 'cbk-rrrrr-aaaaa-bbbbb-ccccc',
        device_id: `dev_rl_${i}`,
        app_version: '1.0.0',
        os: 'darwin',
      });
      expect(r.status).toBe(200);
    }

    const blocked = await callActivate({
      license_key: 'cbk-rrrrr-aaaaa-bbbbb-ccccc',
      device_id: 'dev_rl_11',
      app_version: '1.0.0',
      os: 'darwin',
    });
    expect(blocked.status).toBe(429);
    const body = await blocked.json<{ error: { _tag: string } }>();
    expect(body.error._tag).toBe('RateLimited');
  });
});
