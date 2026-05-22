import {
  activateRequestSchema,
  normalizeHumanizedKey,
  RATE_LIMIT_ACTIVATE,
  REVOCATION_CHECK_INTERVAL_S,
} from '@carbonbook-cloud/shared';
import type { Env } from '../index.js';
import { buildClaims, signLicenseJwt } from '../lib/jwt.js';
import { getLicenseIdByHumanizedKey, readActive, writeActive } from '../lib/license-store.js';
import { checkRateLimit } from '../lib/rate-limit.js';
import { err, json } from '../lib/responses.js';

export async function handleActivate(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
): Promise<Response> {
  const raw = await request.json().catch(() => null);
  const parsed = activateRequestSchema.safeParse(raw);
  if (!parsed.success) return err('BadRequest', parsed.error.message, 400);

  const normalized = normalizeHumanizedKey(parsed.data.license_key);
  if (!normalized) return err('UnknownKey', 'license key format invalid', 404);

  const now = Math.floor(Date.now() / 1000);

  const rl = await checkRateLimit(env.RATE_LIMIT, 'activate', normalized, RATE_LIMIT_ACTIVATE, now);
  if (!rl.allowed) return err('RateLimited', 'too many activation attempts', 429);

  const licenseId = await getLicenseIdByHumanizedKey(env.HUMANIZED_KEYS, normalized);
  if (!licenseId) return err('UnknownKey', 'license key not found', 404);

  const record = await readActive(env.LICENSE_ACTIVE, licenseId);
  if (!record) return err('UnknownKey', 'license record missing', 404);

  if (record.revoked) return err('RevokedLicense', record.revoked_reason ?? 'revoked', 403);

  const deviceId = parsed.data.device_id;
  if (!record.device_ids.includes(deviceId) && record.device_ids.length >= record.devices_max) {
    return err('DeviceCapReached', `max ${record.devices_max} devices`, 409);
  }
  if (!record.device_ids.includes(deviceId)) record.device_ids.push(deviceId);

  await env.DB.prepare(
    `INSERT OR REPLACE INTO device
     (device_id, license_id, first_seen_at, last_ping_at, app_version, os)
     VALUES (?, ?, COALESCE((SELECT first_seen_at FROM device WHERE device_id=? AND license_id=?), ?), ?, ?, ?)`,
  )
    .bind(
      deviceId,
      licenseId,
      deviceId,
      licenseId,
      now,
      now,
      parsed.data.app_version,
      parsed.data.os,
    )
    .run();

  await writeActive(env.LICENSE_ACTIVE, record);

  const claims = buildClaims({
    licenseId,
    userId: record.user_id,
    plan: record.plan,
    features: record.features,
    devicesMax: record.devices_max,
    issuedAt: record.issued_at,
    expiresAt: record.expires_at,
    graceUntil: record.grace_until,
    nowSeconds: now,
    revocationCheckIntervalS: REVOCATION_CHECK_INTERVAL_S,
  });
  const jwt = await signLicenseJwt(claims, env.LICENSE_PRIVATE_KEY_HEX);
  return json({ jwt, claims });
}
