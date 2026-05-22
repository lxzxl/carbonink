import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { runRevocationSweep } from '../src/scheduled/revoke-cron.js';

describe('runRevocationSweep', () => {
  it('flips revoked=1 when revoked_at <= now', async () => {
    await env.DB.prepare('INSERT INTO customer (user_id, email, created_at) VALUES (?, ?, ?)')
      .bind('usr_due', 'd@example.com', 1)
      .run();
    await env.DB.prepare(
      `INSERT INTO license (license_id, user_id, humanized_key, plan, features, devices_max, issued_at, expires_at, grace_until, revoked, revoked_at, revoked_reason)
       VALUES ('lic_due', 'usr_due', 'cbk-due11-due22-due33-due44', 'base@2026-q2', '[]', 1, 1, 2, 3, 0, 1000, 'subscription_cancelled')`,
    ).run();
    await env.LICENSE_ACTIVE.put(
      'la:lic_due',
      JSON.stringify({
        license_id: 'lic_due',
        user_id: 'usr_due',
        plan: 'base@2026-q2',
        features: [],
        devices_max: 1,
        device_ids: [],
        issued_at: 1,
        expires_at: 2,
        grace_until: 3,
        revoked: false,
        revoked_at: 1000,
        revoked_reason: 'subscription_cancelled',
        stripe_subscription_id: null,
      }),
    );

    const result = await runRevocationSweep(env as never, 2000);
    expect(result.flipped).toContain('lic_due');

    const row = await env.DB.prepare('SELECT revoked FROM license WHERE license_id=?')
      .bind('lic_due')
      .first<{ revoked: number }>();
    expect(row?.revoked).toBe(1);
    const kvRaw = await env.LICENSE_ACTIVE.get('la:lic_due');
    expect(kvRaw).not.toBeNull();
    const kv = JSON.parse(kvRaw as string);
    expect(kv.revoked).toBe(true);
    const revRaw = await env.REVOCATION_SET.get('list');
    expect(revRaw).not.toBeNull();
    const revSet = JSON.parse(revRaw as string);
    expect(revSet.license_ids).toContain('lic_due');
  });

  it('leaves licenses alone when revoked_at is in the future', async () => {
    await env.DB.prepare('INSERT INTO customer (user_id, email, created_at) VALUES (?, ?, ?)')
      .bind('usr_future', 'f@example.com', 1)
      .run();
    await env.DB.prepare(
      `INSERT INTO license (license_id, user_id, humanized_key, plan, features, devices_max, issued_at, expires_at, grace_until, revoked, revoked_at, revoked_reason)
       VALUES ('lic_future', 'usr_future', 'cbk-fut11-fut22-fut33-fut44', 'base@2026-q2', '[]', 1, 1, 2, 3, 0, 9999999999, 'subscription_cancelled')`,
    ).run();
    const result = await runRevocationSweep(env as never, 2000);
    expect(result.flipped).not.toContain('lic_future');
  });
});
