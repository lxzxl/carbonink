import type { LicenseActiveRecord } from '@carbonink-cloud/shared';
import {
  BASE_FEATURES,
  GRACE_PERIOD_S,
  generateHumanizedKey,
  REVOCATION_CHECK_INTERVAL_S,
} from '@carbonink-cloud/shared';
import type { Env } from '../index.js';
import { requireAdmin } from '../lib/admin-auth.js';
import { sendActivationEmail } from '../lib/email.js';
import { newLicenseId, newUserId } from '../lib/id.js';
import { buildClaims, signLicenseJwt } from '../lib/jwt.js';
import { readActive, writeActive, writeHumanizedKey } from '../lib/license-store.js';
import { err, json } from '../lib/responses.js';

/**
 * Admin endpoints for processing license_request rows.
 *
 *   GET    /v1/admin/license-requests          — list pending (default) / by status
 *   POST   /v1/admin/license-requests/:id/issue   — sign + email a base@2026-q2 license
 *   POST   /v1/admin/license-requests/:id/dismiss — mark handled without issuing
 *
 * All gated by `requireAdmin` (magic-link session + ADMIN_EMAIL var match).
 *
 * Issue behavior — handles three customer states:
 *   1. Brand-new email (no customer row) → create customer + license + active record
 *   2. Existing customer with only a trial@14d license → upgrade in-place
 *   3. Existing customer with a non-trial license → 409 (don't accidentally
 *      double-issue; admin can dismiss the request instead)
 *
 * The license is base@2026-q2 with 90-day expiry — enough runway for an
 * early-access user to evaluate without locking us out of future
 * pricing decisions. Features = full BASE_FEATURES set.
 *
 * No device row is inserted here — the desktop app's first
 * /v1/activate call binds the actual device to the license. Until
 * then `devices_max = 1` and `device_ids = []`.
 */

const EARLY_ACCESS_DURATION_S = 90 * 24 * 60 * 60;
const EARLY_ACCESS_PLAN = 'base@2026-q2';

type RequestRow = {
  id: number;
  email: string;
  source: string | null;
  lang: string | null;
  user_agent: string | null;
  ip: string | null;
  created_at: number;
  status: string;
  issued_license_id: string | null;
  processed_at: number | null;
  processed_by: string | null;
};

export async function handleAdminListRequests(request: Request, env: Env): Promise<Response> {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return admin;

  const url = new URL(request.url);
  const status = url.searchParams.get('status') ?? 'pending';
  const limit = Math.min(Number(url.searchParams.get('limit') ?? '100'), 500);

  // Always order most-recent-first — the admin's interest is "what
  // came in lately?", not "what's been sitting longest?". If we ever
  // want a backlog view it'd be a separate sort param.
  const { results } = await env.DB.prepare(
    `SELECT id, email, source, lang, user_agent, ip, created_at, status,
            issued_license_id, processed_at, processed_by
     FROM license_request
     WHERE status = ?
     ORDER BY created_at DESC
     LIMIT ?`,
  )
    .bind(status, limit)
    .all<RequestRow>();

  return json({ requests: results });
}

export async function handleAdminIssue(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  requestId: number,
): Promise<Response> {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return admin;

  const row = await env.DB.prepare('SELECT * FROM license_request WHERE id = ?')
    .bind(requestId)
    .first<RequestRow>();
  if (!row) return err('NotFound', 'license_request not found', 404);
  if (row.status !== 'pending') {
    return err('BadRequest', `license_request already ${row.status}`, 409);
  }

  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + EARLY_ACCESS_DURATION_S;
  const graceUntil = expiresAt + GRACE_PERIOD_S;
  const features = [...BASE_FEATURES];

  // Look up existing customer/license for this email — early-access
  // users may have already trialled via the desktop app.
  const existing = await env.DB.prepare(
    `SELECT l.license_id, l.humanized_key, l.plan, c.user_id
     FROM license l JOIN customer c ON l.user_id = c.user_id
     WHERE c.email = ?`,
  )
    .bind(row.email)
    .first<{ license_id: string; humanized_key: string; plan: string; user_id: string }>();

  let licenseId: string;
  let humanized: string;
  let userId: string;
  let activeRecord: LicenseActiveRecord;

  if (existing) {
    if (existing.plan !== 'trial@14d') {
      // Already on a paid/issued plan — refuse rather than risk
      // accidentally extending. Admin can dismiss this request.
      return err('Conflict', `customer already on plan ${existing.plan}`, 409);
    }
    // Upgrade trial → base@2026-q2 in place. Reuse license_id + key
    // so the user's existing activation (if any) keeps working.
    licenseId = existing.license_id;
    humanized = existing.humanized_key;
    userId = existing.user_id;

    await env.DB.prepare(
      `UPDATE license SET plan = ?, features = ?, issued_at = ?, expires_at = ?, grace_until = ?
       WHERE license_id = ?`,
    )
      .bind(
        EARLY_ACCESS_PLAN,
        JSON.stringify(features),
        now,
        expiresAt,
        graceUntil,
        licenseId,
      )
      .run();

    const prior = await readActive(env.LICENSE_ACTIVE, licenseId);
    activeRecord = {
      license_id: licenseId,
      user_id: userId,
      plan: EARLY_ACCESS_PLAN,
      features,
      devices_max: 1,
      device_ids: prior?.device_ids ?? [],
      issued_at: now,
      expires_at: expiresAt,
      grace_until: graceUntil,
      revoked: false,
      revoked_at: null,
      revoked_reason: null,
      stripe_subscription_id: null,
    };
  } else {
    // Brand-new email → create customer + license rows.
    userId = newUserId();
    licenseId = newLicenseId();
    humanized = generateHumanizedKey();

    await env.DB.prepare(
      'INSERT INTO customer (user_id, email, country, created_at) VALUES (?, ?, ?, ?)',
    )
      .bind(userId, row.email, null, now)
      .run();

    await env.DB.prepare(
      `INSERT INTO license
       (license_id, user_id, humanized_key, plan, features, devices_max,
        issued_at, expires_at, grace_until, revoked)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, 0)`,
    )
      .bind(
        licenseId,
        userId,
        humanized,
        EARLY_ACCESS_PLAN,
        JSON.stringify(features),
        now,
        expiresAt,
        graceUntil,
      )
      .run();

    activeRecord = {
      license_id: licenseId,
      user_id: userId,
      plan: EARLY_ACCESS_PLAN,
      features,
      devices_max: 1,
      device_ids: [],
      issued_at: now,
      expires_at: expiresAt,
      grace_until: graceUntil,
      revoked: false,
      revoked_at: null,
      revoked_reason: null,
      stripe_subscription_id: null,
    };
  }

  await writeActive(env.LICENSE_ACTIVE, activeRecord);
  await writeHumanizedKey(env.HUMANIZED_KEYS, humanized, licenseId);

  // Issue JWT — kept consistent with trial-signup's claim shape so the
  // desktop app's verifier doesn't need any branching.
  const claims = buildClaims({
    licenseId,
    userId,
    plan: EARLY_ACCESS_PLAN,
    features,
    devicesMax: 1,
    issuedAt: now,
    expiresAt,
    graceUntil,
    nowSeconds: now,
    revocationCheckIntervalS: REVOCATION_CHECK_INTERVAL_S,
  });
  await signLicenseJwt(claims, env.LICENSE_PRIVATE_KEY_HEX);

  // Mark the request handled BEFORE sending the email — if email
  // send fails we still don't want the admin re-issuing on the next
  // page load. The email itself is fire-and-forget via waitUntil;
  // its safe-send swallows errors so a delivery failure won't surface
  // here either. Admin can manually resend by re-running issue-license
  // CLI with the same email if needed.
  await env.DB.prepare(
    `UPDATE license_request
     SET status = 'issued', issued_license_id = ?, processed_at = ?, processed_by = ?
     WHERE id = ?`,
  )
    .bind(licenseId, now, admin, requestId)
    .run();

  ctx.waitUntil(
    sendActivationEmail({
      email: env.EMAIL,
      to: row.email,
      licenseKey: humanized,
      lang: row.lang === 'zh-CN' ? 'zh-CN' : 'en',
    }),
  );

  return json({ ok: true, license_id: licenseId, license_key: humanized });
}

export async function handleAdminDismiss(
  request: Request,
  env: Env,
  requestId: number,
): Promise<Response> {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return admin;

  const now = Math.floor(Date.now() / 1000);
  const result = await env.DB.prepare(
    `UPDATE license_request
     SET status = 'dismissed', processed_at = ?, processed_by = ?
     WHERE id = ? AND status = 'pending'`,
  )
    .bind(now, admin, requestId)
    .run();

  if (result.meta.changes === 0) {
    return err('NotFound', 'license_request not pending', 404);
  }
  return json({ ok: true });
}
