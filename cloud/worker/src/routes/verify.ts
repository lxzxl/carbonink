import {
  RATE_LIMIT_VERIFY,
  REVOCATION_CHECK_INTERVAL_S,
  verifyRequestSchema,
} from '@carbonink-cloud/shared';
import type { Env } from '../index.js';
import { buildClaims, signLicenseJwt } from '../lib/jwt.js';
import { readActive } from '../lib/license-store.js';
import { checkRateLimit } from '../lib/rate-limit.js';
import { err, json } from '../lib/responses.js';

export async function handleVerify(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
): Promise<Response> {
  const raw = await request.json().catch(() => null);
  const parsed = verifyRequestSchema.safeParse(raw);
  if (!parsed.success) return err('BadRequest', parsed.error.message, 400);

  const now = Math.floor(Date.now() / 1000);

  const rl = await checkRateLimit(
    env.RATE_LIMIT,
    'verify',
    parsed.data.device_id,
    RATE_LIMIT_VERIFY,
    now,
  );
  if (!rl.allowed) return err('RateLimited', 'too many verify pings', 429);

  const record = await readActive(env.LICENSE_ACTIVE, parsed.data.license_id);
  if (!record) return err('UnknownKey', 'license not found', 404);

  if (record.revoked) {
    return json({ revoked: true, reason: record.revoked_reason ?? 'revoked' });
  }

  await env.DB.prepare(
    'UPDATE device SET last_ping_at = ?, app_version = ? WHERE device_id = ? AND license_id = ?',
  )
    .bind(now, parsed.data.app_version, parsed.data.device_id, parsed.data.license_id)
    .run();

  const claims = buildClaims({
    licenseId: record.license_id,
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
  return json({ jwt, claims, revoked: false });
}
