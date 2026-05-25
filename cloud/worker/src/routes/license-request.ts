import { licenseRequestSchema } from '@carbonink-cloud/shared';
import type { Env } from '../index.js';
import { sendLicenseRequestNotification } from '../lib/email.js';
import { checkRateLimit } from '../lib/rate-limit.js';
import { err, json } from '../lib/responses.js';

/**
 * POST /v1/license-request
 *
 * Marketing-site "申请早期试用 / Request early access" endpoint. Used
 * during the pre-paid phase while Stripe is wired but inactive — we
 * still want a single funnel that captures interest and notifies
 * support so a license can be issued manually via the
 * `issue-dev-license` CLI.
 *
 * Why this exists alongside /v1/trial-signup:
 *   - trial-signup is for the **desktop client** to call after install
 *     — it requires a device_id + app_version and issues a JWT
 *     immediately. The user has the app open.
 *   - license-request is for the **marketing site** — the user
 *     hasn't installed yet and may not for days. We just save the
 *     email and notify a human.
 *
 * Trade-off (deliberate): no Cloudflare Turnstile / captcha. Early
 * traffic is too low for spam to be the dominant problem; if it
 * becomes one we'll bolt on Turnstile then. Per-IP rate-limit at
 * 10 / hour catches scripted floods.
 */

const RATE_LIMIT_LICENSE_REQUEST = { max: 10, windowS: 3600 };

export async function handleLicenseRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const raw = await request.json().catch(() => null);
  const parsed = licenseRequestSchema.safeParse(raw);
  if (!parsed.success) return err('BadRequest', parsed.error.message, 400);

  const ip = request.headers.get('CF-Connecting-IP') ?? '0.0.0.0';
  const now = Math.floor(Date.now() / 1000);
  const rl = await checkRateLimit(env.RATE_LIMIT, 'license-request', ip, RATE_LIMIT_LICENSE_REQUEST, now);
  if (!rl.allowed) return err('RateLimited', 'too many requests from this IP', 429);

  const userAgent = request.headers.get('User-Agent')?.slice(0, 200) ?? null;

  // Insert unconditionally (duplicates allowed — see migration 0002
  // comment). The notification email is gated separately so a
  // re-submit doesn't double-mail support.
  await env.DB.prepare(
    `INSERT INTO license_request (email, source, lang, user_agent, ip, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      parsed.data.email,
      parsed.data.source ?? null,
      parsed.data.lang ?? null,
      userAgent,
      ip,
      now,
    )
    .run();

  // Dedup notification: at most one email to support per 24h per
  // requester. Re-submits inside the window land in D1 (we want the
  // signal) but don't re-spam the inbox.
  const dedupKey = `notify:license-request:${parsed.data.email}`;
  const alreadyNotified = await env.RATE_LIMIT.get(dedupKey);
  if (!alreadyNotified) {
    await env.RATE_LIMIT.put(dedupKey, '1', { expirationTtl: 86400 });
    ctx.waitUntil(
      sendLicenseRequestNotification({
        email: env.EMAIL,
        requesterEmail: parsed.data.email,
        source: parsed.data.source ?? 'unknown',
        lang: parsed.data.lang ?? 'unknown',
      }),
    );
  }

  return json({ ok: true });
}
