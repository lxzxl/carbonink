type Session = {
  id: string;
  customer_details?: { email?: string };
  metadata?: { plan?: string };
};

export async function lookupLicenseForSession(opts: {
  sessionId: string;
  stripeSecretKey: string;
  apiOrigin: string;
}): Promise<{ licenseKey: string; email: string } | null> {
  const sessionRes = await fetch(`https://api.stripe.com/v1/checkout/sessions/${opts.sessionId}`, {
    headers: { Authorization: `Bearer ${opts.stripeSecretKey}` },
  });
  if (!sessionRes.ok) return null;
  const session = (await sessionRes.json()) as Session;
  const email = session.customer_details?.email;
  if (!email) return null;
  const lookup = await fetch(
    `${opts.apiOrigin}/v1/internal/license-by-email?email=${encodeURIComponent(email)}`,
    {
      headers: { 'X-Activate-Page': '1' },
    },
  );
  if (!lookup.ok) return null;
  const body = (await lookup.json()) as { license_key: string };
  return { licenseKey: body.license_key, email };
}
