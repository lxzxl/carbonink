import type { Env } from '../index.js';
import { err, json } from '../lib/responses.js';
import { requireSession } from '../lib/session.js';
import { createBillingPortal } from '../lib/stripe.js';

export async function handleAccountDevices(request: Request, env: Env): Promise<Response> {
  const session = await requireSession(request, env.SESSION_PRIVATE_KEY_HEX);
  if (session instanceof Response) return session;

  const rows = await env.DB.prepare(
    `SELECT d.device_id, d.first_seen_at, d.last_ping_at, d.app_version, d.os, d.license_id
     FROM device d
     JOIN license l ON d.license_id = l.license_id
     WHERE l.user_id = ?
     ORDER BY d.first_seen_at ASC`,
  )
    .bind(session.sub)
    .all();
  return json({ devices: rows.results ?? [] });
}

export async function handleBillingPortal(request: Request, env: Env): Promise<Response> {
  const session = await requireSession(request, env.SESSION_PRIVATE_KEY_HEX);
  if (session instanceof Response) return session;

  const url = new URL(request.url);
  const returnUrl = url.searchParams.get('return_url') ?? 'https://account.carbonbook.app/';
  const cust = await env.DB.prepare('SELECT stripe_customer_id FROM customer WHERE user_id = ?')
    .bind(session.sub)
    .first<{ stripe_customer_id: string | null }>();
  if (!cust?.stripe_customer_id) {
    return err('BadRequest', 'no Stripe customer linked', 400);
  }
  const portal = await createBillingPortal({
    secretKey: env.STRIPE_SECRET_KEY,
    stripeCustomerId: cust.stripe_customer_id,
    returnUrl,
  });
  return json({ url: portal.url });
}
