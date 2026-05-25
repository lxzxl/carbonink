type Session = {
  id: string;
  customer_details?: { email?: string };
  metadata?: { plan?: string };
};

export async function lookupLicenseForSession(opts: {
  sessionId: string;
  stripeSecretKey: string;
  // Absolute base URL for the API surface — caller builds this from
  // `Astro.request.url` so server-side fetch has a valid origin
  // (Worker fetch needs an absolute URL even for same-origin calls).
  apiBaseUrl: string;
}): Promise<{ licenseKey: string; email: string } | null> {
  const sessionRes = await fetch(`https://api.stripe.com/v1/checkout/sessions/${opts.sessionId}`, {
    headers: { Authorization: `Bearer ${opts.stripeSecretKey}` },
  });
  if (!sessionRes.ok) return null;
  const session = (await sessionRes.json()) as Session;
  const email = session.customer_details?.email;
  if (!email) return null;
  const lookupUrl = new URL('/api/v1/internal/license-by-email', opts.apiBaseUrl);
  lookupUrl.searchParams.set('email', email);
  const lookup = await fetch(lookupUrl.toString(), {
    headers: { 'X-Activate-Page': '1' },
  });
  if (!lookup.ok) return null;
  const body = (await lookup.json()) as { license_key: string };
  return { licenseKey: body.license_key, email };
}
