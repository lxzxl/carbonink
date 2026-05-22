import { z } from 'zod';
import type { Env } from '../index.js';
import { err } from '../lib/responses.js';
import { requireSession } from '../lib/session.js';
import { stripeRequest } from '../lib/stripe.js';

const deleteReq = z.object({ confirm: z.literal('DELETE') });

/**
 * DELETE /v1/account — danger-zone account deletion.
 *
 * D1 has no multi-statement transactions in `.exec()`, so we run sequential
 * `.prepare().run()` calls. If one fails mid-way, dangling rows are possible
 * — the danger zone is rare and a manual cleanup is acceptable.
 */
export async function handleAccountDelete(request: Request, env: Env): Promise<Response> {
  const session = await requireSession(request, env.SESSION_PRIVATE_KEY_HEX);
  if (session instanceof Response) return session;

  const raw = await request.json().catch(() => null);
  const parsed = deleteReq.safeParse(raw);
  if (!parsed.success) return err('BadRequest', 'must POST { confirm: "DELETE" }', 400);

  // Best-effort cancel any live Stripe subscriptions for this user.
  const subs = await env.DB.prepare(
    `SELECT stripe_subscription_id FROM license
     WHERE user_id = ? AND stripe_subscription_id IS NOT NULL AND revoked = 0`,
  )
    .bind(session.sub)
    .all<{ stripe_subscription_id: string }>();
  for (const row of subs.results ?? []) {
    if (!row.stripe_subscription_id) continue;
    try {
      await stripeRequest(
        env.STRIPE_SECRET_KEY,
        `/v1/subscriptions/${row.stripe_subscription_id}`,
        { cancel_at_period_end: 'true' },
      );
    } catch (e) {
      console.error('stripe:cancel-on-delete-failed', e);
    }
  }

  // Wipe associated KV entries first — leftover KV rows are harder to detect
  // than D1 dangling rows.
  const licenses = await env.DB.prepare(
    'SELECT license_id, humanized_key FROM license WHERE user_id = ?',
  )
    .bind(session.sub)
    .all<{ license_id: string; humanized_key: string }>();
  for (const lic of licenses.results ?? []) {
    await env.LICENSE_ACTIVE.delete(`la:${lic.license_id}`);
    await env.HUMANIZED_KEYS.delete(`hk:${lic.humanized_key}`);
  }

  // D1 cascade: devices → licenses → customer.
  await env.DB.prepare(
    'DELETE FROM device WHERE license_id IN (SELECT license_id FROM license WHERE user_id = ?)',
  )
    .bind(session.sub)
    .run();
  await env.DB.prepare('DELETE FROM license WHERE user_id = ?').bind(session.sub).run();
  await env.DB.prepare('DELETE FROM customer WHERE user_id = ?').bind(session.sub).run();

  // Expire the session cookie immediately. Must match the Domain used at
  // Set-Cookie time (.carbonbook.app) or the browser will leave the
  // host-only cookie in place.
  const host = request.headers.get('Host') ?? '';
  const domainAttr =
    host === 'localhost' || host.startsWith('localhost:') ? '' : ' Domain=.carbonbook.app;';
  return new Response(JSON.stringify({ deleted: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': `session=;${domainAttr} Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure`,
    },
  });
}
