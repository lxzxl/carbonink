import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../src/index.js';
import { seedLicense, TEST_PRIVATE_KEY_HEX } from './_fixtures.js';

function makeReq(body: unknown): Request {
  return new Request('https://carbonink.xyz/api/v1/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function callVerify(body: unknown) {
  // biome-ignore lint/suspicious/noExplicitAny: test override of env secret
  (env as any).LICENSE_PRIVATE_KEY_HEX = TEST_PRIVATE_KEY_HEX;
  const ctx = createExecutionContext();
  const res = await worker.fetch(makeReq(body), env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

describe('POST /v1/verify', () => {
  it('happy path returns fresh JWT + revoked=false and updates last_ping_at', async () => {
    await seedLicense({
      licenseId: 'lic_vhappy',
      userId: 'usr_vhappy',
      humanizedKey: 'cik-vhppy-aaaaa-bbbbb-ccccc',
      devices: ['dev_vhappy'],
    });
    // Pre-seed the device row (verify only UPDATEs).
    await env.DB.prepare(
      'INSERT OR REPLACE INTO device (device_id, license_id, first_seen_at, last_ping_at, app_version, os) VALUES (?, ?, ?, ?, ?, ?)',
    )
      .bind('dev_vhappy', 'lic_vhappy', 1_700_000_000, 1_700_000_000, '0.9.0', 'darwin')
      .run();

    const res = await callVerify({
      license_id: 'lic_vhappy',
      device_id: 'dev_vhappy',
      app_version: '1.0.0',
      os: 'darwin',
    });

    expect(res.status).toBe(200);
    const body = await res.json<{ jwt: string; revoked: boolean }>();
    expect(body.jwt.split('.').length).toBe(3);
    expect(body.revoked).toBe(false);

    const row = await env.DB.prepare(
      'SELECT app_version, last_ping_at FROM device WHERE device_id = ? AND license_id = ?',
    )
      .bind('dev_vhappy', 'lic_vhappy')
      .first<{ app_version: string; last_ping_at: number }>();
    expect(row?.app_version).toBe('1.0.0');
    expect(row?.last_ping_at).toBeGreaterThan(1_700_000_000);
  });

  it('revoked license returns 200 with revoked=true and reason (no JWT)', async () => {
    await seedLicense({
      licenseId: 'lic_vrev',
      userId: 'usr_vrev',
      humanizedKey: 'cik-vrevv-aaaaa-bbbbb-ccccc',
      devices: ['dev_vrev'],
      revoked: true,
      revokedReason: 'chargeback',
    });

    const res = await callVerify({
      license_id: 'lic_vrev',
      device_id: 'dev_vrev',
      app_version: '1.0.0',
      os: 'darwin',
    });

    expect(res.status).toBe(200);
    const body = await res.json<{ revoked: boolean; reason: string; jwt?: string }>();
    expect(body.revoked).toBe(true);
    expect(body.reason).toBe('chargeback');
    expect(body.jwt).toBeUndefined();
  });

  it('unknown license_id returns 404 UnknownKey', async () => {
    const res = await callVerify({
      license_id: 'lic_does_not_exist',
      device_id: 'dev_void',
      app_version: '1.0.0',
      os: 'darwin',
    });
    expect(res.status).toBe(404);
    const body = await res.json<{ error: { _tag: string } }>();
    expect(body.error._tag).toBe('UnknownKey');
  });

  it('7th rapid verify on the same device returns 429 RateLimited', async () => {
    await seedLicense({
      licenseId: 'lic_vrl',
      userId: 'usr_vrl',
      humanizedKey: 'cik-vrlll-aaaaa-bbbbb-ccccc',
      devices: ['dev_vrl'],
    });
    await env.DB.prepare(
      'INSERT OR REPLACE INTO device (device_id, license_id, first_seen_at, last_ping_at, app_version, os) VALUES (?, ?, ?, ?, ?, ?)',
    )
      .bind('dev_vrl', 'lic_vrl', 1_700_000_000, 1_700_000_000, '1.0.0', 'darwin')
      .run();

    for (let i = 0; i < 6; i++) {
      const r = await callVerify({
        license_id: 'lic_vrl',
        device_id: 'dev_vrl',
        app_version: '1.0.0',
        os: 'darwin',
      });
      expect(r.status).toBe(200);
    }

    const blocked = await callVerify({
      license_id: 'lic_vrl',
      device_id: 'dev_vrl',
      app_version: '1.0.0',
      os: 'darwin',
    });
    expect(blocked.status).toBe(429);
    const body = await blocked.json<{ error: { _tag: string } }>();
    expect(body.error._tag).toBe('RateLimited');
  });
});
