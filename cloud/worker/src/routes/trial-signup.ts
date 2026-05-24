import type { LicenseActiveRecord } from '@carbonink-cloud/shared';
import {
  GRACE_PERIOD_S,
  generateHumanizedKey,
  RATE_LIMIT_TRIAL,
  REVOCATION_CHECK_INTERVAL_S,
  TRIAL_DURATION_S,
  trialSignupRequestSchema,
} from '@carbonink-cloud/shared';
import type { Env } from '../index.js';
import { sendActivationEmail } from '../lib/email.js';
import { newLicenseId, newUserId } from '../lib/id.js';
import { buildClaims, signLicenseJwt } from '../lib/jwt.js';
import { readActive, writeActive, writeHumanizedKey } from '../lib/license-store.js';
import { checkRateLimit } from '../lib/rate-limit.js';
import { err, json } from '../lib/responses.js';

function pickLang(request: Request): 'zh-CN' | 'en' {
  const al = request.headers.get('Accept-Language') ?? '';
  return al.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}

export async function handleTrialSignup(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const raw = await request.json().catch(() => null);
  const parsed = trialSignupRequestSchema.safeParse(raw);
  if (!parsed.success) return err('BadRequest', parsed.error.message, 400);

  const ip = request.headers.get('CF-Connecting-IP') ?? '0.0.0.0';
  const now = Math.floor(Date.now() / 1000);
  const rl = await checkRateLimit(env.RATE_LIMIT, 'trial', ip, RATE_LIMIT_TRIAL, now);
  if (!rl.allowed) return err('RateLimited', 'too many trial signups from this IP', 429);

  const existing = await env.DB.prepare(
    `SELECT l.license_id, l.humanized_key, l.plan, l.issued_at
     FROM license l JOIN customer c ON l.user_id = c.user_id
     WHERE c.email = ?`,
  )
    .bind(parsed.data.email)
    .first<{ license_id: string; humanized_key: string; plan: string; issued_at: number }>();

  if (existing) {
    if (existing.plan !== 'trial@14d') {
      return err('BadRequest', 'AlreadyPaid', 409);
    }
    const record = await readActive(env.LICENSE_ACTIVE, existing.license_id);
    if (!record) return err('Internal', 'license KV out of sync', 500);

    const stale = now - existing.issued_at > REVOCATION_CHECK_INTERVAL_S;
    if (stale) {
      const newExp = now + TRIAL_DURATION_S;
      const newGrace = newExp + GRACE_PERIOD_S;
      record.expires_at = newExp;
      record.grace_until = newGrace;
      record.issued_at = now;
      await env.DB.prepare(
        'UPDATE license SET issued_at=?, expires_at=?, grace_until=? WHERE license_id=?',
      )
        .bind(now, newExp, newGrace, existing.license_id)
        .run();
      await writeActive(env.LICENSE_ACTIVE, record);
    }

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
    return json({ license_key: existing.humanized_key, jwt });
  }

  const userId = newUserId();
  const licenseId = newLicenseId();
  const humanized = generateHumanizedKey();
  const expiresAt = now + TRIAL_DURATION_S;
  const graceUntil = expiresAt + GRACE_PERIOD_S;

  await env.DB.prepare(
    'INSERT INTO customer (user_id, email, country, created_at) VALUES (?, ?, ?, ?)',
  )
    .bind(userId, parsed.data.email, parsed.data.country_hint ?? null, now)
    .run();

  await env.DB.prepare(
    `INSERT INTO license
     (license_id, user_id, humanized_key, plan, features, devices_max, issued_at, expires_at, grace_until, revoked)
     VALUES (?, ?, ?, 'trial@14d', '["inventory","questionnaire","iso14064"]', 1, ?, ?, ?, 0)`,
  )
    .bind(licenseId, userId, humanized, now, expiresAt, graceUntil)
    .run();

  await env.DB.prepare(
    'INSERT INTO device (device_id, license_id, first_seen_at, last_ping_at, app_version) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(parsed.data.device_id, licenseId, now, now, parsed.data.app_version)
    .run();

  const record: LicenseActiveRecord = {
    license_id: licenseId,
    user_id: userId,
    plan: 'trial@14d',
    features: ['inventory', 'questionnaire', 'iso14064'],
    devices_max: 1,
    device_ids: [parsed.data.device_id],
    issued_at: now,
    expires_at: expiresAt,
    grace_until: graceUntil,
    revoked: false,
    revoked_at: null,
    revoked_reason: null,
    stripe_subscription_id: null,
  };
  await writeActive(env.LICENSE_ACTIVE, record);
  await writeHumanizedKey(env.HUMANIZED_KEYS, humanized, licenseId);

  const claims = buildClaims({
    licenseId,
    userId,
    plan: record.plan,
    features: record.features,
    devicesMax: record.devices_max,
    issuedAt: now,
    expiresAt,
    graceUntil,
    nowSeconds: now,
    revocationCheckIntervalS: REVOCATION_CHECK_INTERVAL_S,
  });
  const jwt = await signLicenseJwt(claims, env.LICENSE_PRIVATE_KEY_HEX);

  ctx.waitUntil(
    sendActivationEmail({
      email: env.EMAIL,
      to: parsed.data.email,
      licenseKey: humanized,
      lang: pickLang(request),
    }),
  );

  return json({ license_key: humanized, jwt });
}
