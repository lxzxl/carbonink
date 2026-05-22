import { env } from 'cloudflare:test';
import type { LicenseActiveRecord } from '@carbonbook-cloud/shared';

export const TEST_PRIVATE_KEY_HEX =
  '4af3e2f9c1b0a988776655443322110011223344556677889900aabbccddeeff';

export async function seedLicense(
  opts: {
    userId?: string;
    licenseId?: string;
    humanizedKey?: string;
    plan?: string;
    features?: string[];
    devicesMax?: number;
    devices?: string[];
    revoked?: boolean;
    revokedReason?: string;
    expiresAt?: number;
    graceUntil?: number;
  } = {},
): Promise<LicenseActiveRecord> {
  const now = 1_700_000_000;
  const record: LicenseActiveRecord = {
    license_id: opts.licenseId ?? 'lic_test',
    user_id: opts.userId ?? 'usr_test',
    plan: opts.plan ?? 'base@2026-q2',
    features: opts.features ?? ['inventory', 'questionnaire', 'iso14064'],
    devices_max: opts.devicesMax ?? 1,
    device_ids: opts.devices ?? [],
    issued_at: now,
    expires_at: opts.expiresAt ?? now + 365 * 86_400,
    grace_until: opts.graceUntil ?? now + 395 * 86_400,
    revoked: opts.revoked ?? false,
    revoked_at: opts.revoked ? now : null,
    revoked_reason: opts.revokedReason ?? null,
    stripe_subscription_id: null,
  };
  const humanized = opts.humanizedKey ?? 'cbk-aaaaa-bbbbb-ccccc-ddddd';

  await env.DB.prepare(
    'INSERT OR REPLACE INTO customer (user_id, email, created_at) VALUES (?, ?, ?)',
  )
    .bind(record.user_id, `${record.user_id}@example.com`, now)
    .run();
  await env.DB.prepare(
    `INSERT OR REPLACE INTO license
     (license_id, user_id, humanized_key, plan, features, devices_max, issued_at, expires_at, grace_until, revoked, revoked_at, revoked_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      record.license_id,
      record.user_id,
      humanized,
      record.plan,
      JSON.stringify(record.features),
      record.devices_max,
      record.issued_at,
      record.expires_at,
      record.grace_until,
      record.revoked ? 1 : 0,
      record.revoked_at,
      record.revoked_reason,
    )
    .run();

  await env.LICENSE_ACTIVE.put(`la:${record.license_id}`, JSON.stringify(record));
  await env.HUMANIZED_KEYS.put(`hk:${humanized}`, record.license_id);
  return record;
}
