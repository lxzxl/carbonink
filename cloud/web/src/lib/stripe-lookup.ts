import { type ApiBinding, apiFetch } from './api-fetch.ts';

type Session = {
  id: string;
  customer_details?: { email?: string };
  metadata?: { plan?: string };
};

/**
 * Resolve a Stripe checkout-session ID into a CarbonInk license key.
 *
 * Two hops:
 *   1. Stripe API (external) → email behind the checkout session
 *   2. Our internal `/v1/internal/license-by-email` (via service
 *      binding) → license_key
 *
 * Hop #2 was previously a public-edge self-fetch which hangs ~20 s
 * inside a Cloudflare Worker. The api-binding RPC sidesteps that.
 *
 * Caller (activate.astro SSR) must pass the worker's `env.API`
 * binding. In dev / preview without wrangler it'll be `null`; we
 * surface that as a `null` result so the page renders the
 * "license not found" card cleanly.
 */
export async function lookupLicenseForSession(opts: {
  sessionId: string;
  stripeSecretKey: string;
  api: ApiBinding | null;
}): Promise<{ licenseKey: string; email: string } | null> {
  if (!opts.api) return null;

  const sessionRes = await fetch(`https://api.stripe.com/v1/checkout/sessions/${opts.sessionId}`, {
    headers: { Authorization: `Bearer ${opts.stripeSecretKey}` },
  });
  if (!sessionRes.ok) return null;
  const session = (await sessionRes.json()) as Session;
  const email = session.customer_details?.email;
  if (!email) return null;

  const lookup = await apiFetch(opts.api, {
    path: `/api/v1/internal/license-by-email?email=${encodeURIComponent(email)}`,
    headers: { 'X-Activate-Page': '1' },
  });
  if (!lookup.ok) return null;
  const body = (await lookup.json()) as { license_key: string };
  return { licenseKey: body.license_key, email };
}
