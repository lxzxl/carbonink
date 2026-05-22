/**
 * Stripe HMAC-SHA256 signature verification.
 * Stripe ships the signature as: `t=<unix>,v1=<hex>` (we ignore v0).
 * Constant-time comparison is critical here.
 */
type VerifyResult = { valid: true; event: StripeEvent } | { valid: false; reason: string };

export type StripeEvent = {
  id: string;
  type: string;
  created: number;
  data: { object: Record<string, unknown> };
};

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function toHex(bytes: ArrayBuffer): string {
  const arr = new Uint8Array(bytes);
  let s = '';
  for (const b of arr) s += b.toString(16).padStart(2, '0');
  return s;
}

export async function verifyStripeSignature(
  payload: string,
  sigHeader: string | null,
  secret: string,
  toleranceS = 300,
): Promise<VerifyResult> {
  if (!sigHeader) return { valid: false, reason: 'missing-signature' };
  const parts = Object.fromEntries(
    sigHeader.split(',').map((kv) => {
      const [k, v] = kv.split('=', 2);
      return [k ?? '', v ?? ''];
    }),
  ) as { t?: string; v1?: string };
  if (!parts.t || !parts.v1) return { valid: false, reason: 'malformed-signature' };

  const signedPayload = `${parts.t}.${payload}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const macBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedPayload));
  const expected = toHex(macBuf);
  if (!timingSafeEqualHex(expected, parts.v1)) {
    return { valid: false, reason: 'signature-mismatch' };
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(parts.t)) > toleranceS) {
    return { valid: false, reason: 'timestamp-out-of-tolerance' };
  }

  const event = JSON.parse(payload) as StripeEvent;
  return { valid: true, event };
}

/**
 * Form-encoded POST to Stripe REST. The Checkout endpoint accepts nested
 * keys via bracket notation (`metadata[plan]=...`); the helper flattens
 * objects recursively to match.
 */
function flatten(obj: Record<string, unknown>, prefix = ''): string[][] {
  const pairs: string[][] = [];
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v === undefined || v === null) continue;
    if (typeof v === 'object' && !Array.isArray(v)) {
      pairs.push(...flatten(v as Record<string, unknown>, key));
    } else {
      pairs.push([key, String(v)]);
    }
  }
  return pairs;
}

export async function stripeRequest<T>(
  secretKey: string,
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const params = new URLSearchParams();
  for (const [k, v] of flatten(body)) params.append(k, v);
  const res = await fetch(`https://api.stripe.com${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`stripe ${path} ${res.status}: ${text}`);
  }
  return res.json<T>();
}

export type CheckoutSession = {
  id: string;
  url: string;
};

export async function createCheckoutSession(opts: {
  secretKey: string;
  priceId: string;
  plan: string;
  tier: string;
  successUrl: string;
  cancelUrl: string;
  customerEmail?: string;
}): Promise<CheckoutSession> {
  return stripeRequest<CheckoutSession>(opts.secretKey, '/v1/checkout/sessions', {
    mode: 'subscription',
    'line_items[0][price]': opts.priceId,
    'line_items[0][quantity]': 1,
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
    customer_email: opts.customerEmail,
    metadata: { plan: opts.plan, tier: opts.tier },
  } as Record<string, unknown>);
}

export type BillingPortalSession = { id: string; url: string };

export async function createBillingPortal(opts: {
  secretKey: string;
  stripeCustomerId: string;
  returnUrl: string;
}): Promise<BillingPortalSession> {
  return stripeRequest<BillingPortalSession>(opts.secretKey, '/v1/billing_portal/sessions', {
    customer: opts.stripeCustomerId,
    return_url: opts.returnUrl,
  });
}
