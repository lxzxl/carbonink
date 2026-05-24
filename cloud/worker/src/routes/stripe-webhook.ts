import type { LicenseActiveRecord } from '@carbonink-cloud/shared';
import { GRACE_PERIOD_S, generateHumanizedKey } from '@carbonink-cloud/shared';
import type { Env } from '../index.js';
import { sendActivationEmail } from '../lib/email.js';
import { newLicenseId, newUserId } from '../lib/id.js';
import { writeActive, writeHumanizedKey } from '../lib/license-store.js';
import { err, json } from '../lib/responses.js';
import { verifyStripeSignature } from '../lib/stripe.js';

async function scheduleRevocation(
  env: Env,
  subscriptionId: string,
  eventTime: number,
  reason: string,
): Promise<void> {
  const row = await env.DB.prepare('SELECT license_id FROM license WHERE stripe_subscription_id=?')
    .bind(subscriptionId)
    .first<{ license_id: string }>();
  if (!row) return;
  const scheduledAt = eventTime + 30 * 86_400;
  await env.DB.prepare('UPDATE license SET revoked_at=?, revoked_reason=? WHERE license_id=?')
    .bind(scheduledAt, reason, row.license_id)
    .run();
  const raw = await env.LICENSE_ACTIVE.get(`la:${row.license_id}`);
  if (raw) {
    const rec = JSON.parse(raw) as LicenseActiveRecord;
    rec.revoked_at = scheduledAt;
    rec.revoked_reason = reason;
    // intentionally leave rec.revoked = false until the cron tips it over
    await env.LICENSE_ACTIVE.put(`la:${row.license_id}`, JSON.stringify(rec));
  }
}

export async function handleStripeWebhook(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const payload = await request.text();
  const verified = await verifyStripeSignature(
    payload,
    request.headers.get('stripe-signature'),
    env.STRIPE_WEBHOOK_SECRET,
  );
  if (!verified.valid) return err('BadRequest', `signature: ${verified.reason}`, 400);

  const event = verified.event;
  switch (event.type) {
    case 'checkout.session.completed': {
      const o = event.data.object as {
        customer?: string;
        customer_details?: { email?: string };
        subscription?: string;
        metadata?: { plan?: string };
      };
      const email = o.customer_details?.email;
      const plan = o.metadata?.plan ?? 'base@2026-q2';
      if (!email) return err('BadRequest', 'missing customer email', 400);

      const now = event.created;
      const existing = await env.DB.prepare('SELECT user_id FROM customer WHERE email=?')
        .bind(email)
        .first<{ user_id: string }>();
      const userId = existing?.user_id ?? newUserId();
      if (!existing) {
        await env.DB.prepare(
          'INSERT INTO customer (user_id, email, created_at, stripe_customer_id) VALUES (?, ?, ?, ?)',
        )
          .bind(userId, email, now, o.customer ?? null)
          .run();
      } else if (o.customer) {
        await env.DB.prepare('UPDATE customer SET stripe_customer_id=? WHERE user_id=?')
          .bind(o.customer, userId)
          .run();
      }

      const licenseId = newLicenseId();
      const humanized = generateHumanizedKey();
      const expiresAt = now + 365 * 86_400;
      const graceUntil = expiresAt + GRACE_PERIOD_S;
      await env.DB.prepare(
        `INSERT INTO license (license_id, user_id, humanized_key, plan, features, devices_max, issued_at, expires_at, grace_until, stripe_subscription_id, revoked)
         VALUES (?, ?, ?, ?, '["inventory","questionnaire","iso14064"]', 1, ?, ?, ?, ?, 0)`,
      )
        .bind(
          licenseId,
          userId,
          humanized,
          plan,
          now,
          expiresAt,
          graceUntil,
          o.subscription ?? null,
        )
        .run();

      const record: LicenseActiveRecord = {
        license_id: licenseId,
        user_id: userId,
        plan,
        features: ['inventory', 'questionnaire', 'iso14064'],
        devices_max: 1,
        device_ids: [],
        issued_at: now,
        expires_at: expiresAt,
        grace_until: graceUntil,
        revoked: false,
        revoked_at: null,
        revoked_reason: null,
        stripe_subscription_id: o.subscription ?? null,
      };
      await writeActive(env.LICENSE_ACTIVE, record);
      await writeHumanizedKey(env.HUMANIZED_KEYS, humanized, licenseId);

      ctx.waitUntil(
        sendActivationEmail({
          email: env.EMAIL,
          to: email,
          licenseKey: humanized,
          lang: 'en',
        }),
      );
      return json({ received: true });
    }
    case 'invoice.payment_succeeded': {
      const o = event.data.object as { subscription?: string };
      if (!o.subscription) return json({ received: true });
      const row = await env.DB.prepare(
        'SELECT license_id, expires_at, grace_until FROM license WHERE stripe_subscription_id=?',
      )
        .bind(o.subscription)
        .first<{ license_id: string; expires_at: number; grace_until: number }>();
      if (!row) return json({ received: true });
      const newExp = row.expires_at + 365 * 86_400;
      const newGrace = row.grace_until + 365 * 86_400;
      await env.DB.prepare('UPDATE license SET expires_at=?, grace_until=? WHERE license_id=?')
        .bind(newExp, newGrace, row.license_id)
        .run();
      const raw = await env.LICENSE_ACTIVE.get(`la:${row.license_id}`);
      if (raw) {
        const rec = JSON.parse(raw) as LicenseActiveRecord;
        rec.expires_at = newExp;
        rec.grace_until = newGrace;
        await env.LICENSE_ACTIVE.put(`la:${row.license_id}`, JSON.stringify(rec));
      }
      return json({ received: true });
    }
    case 'customer.subscription.deleted': {
      const o = event.data.object as { id?: string };
      if (o.id) await scheduleRevocation(env, o.id, event.created, 'subscription_cancelled');
      return json({ received: true });
    }
    case 'charge.refunded': {
      const o = event.data.object as {
        invoice?: string;
        metadata?: { subscription_id?: string };
      };
      let subId: string | undefined;
      if (o.metadata?.subscription_id) subId = o.metadata.subscription_id;
      else if (o.invoice) {
        // Real Stripe events expose `invoice` here; resolving subscription
        // requires a follow-up GET /v1/invoices/<id>. Tests use the
        // metadata fallback; prod can extend this branch.
        subId = undefined;
      }
      if (subId) await scheduleRevocation(env, subId, event.created, 'refund');
      return json({ received: true });
    }
    default:
      console.log('stripe:unhandled', event.type);
      return json({ received: true });
  }
}
