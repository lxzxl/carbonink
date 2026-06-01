import { z } from 'zod';
import type { Env } from '../index.js';
import { err, json } from '../lib/responses.js';
import { createCheckoutSession } from '../lib/stripe.js';

const checkoutSessionRequest = z.object({
  plan: z.enum(['base@2026-q2']),
  email: z.string().email().optional(),
  // Locale of the buyer's session — prefixes the post-checkout
  // activate / cancel URLs with /zh/ for Chinese. Optional → English.
  lang: z.enum(['zh-CN', 'en']).optional(),
});

const PLAN_TO_PRICE_ENV: Record<string, keyof Env> = {
  'base@2026-q2': 'STRIPE_PRICE_BASE_2026Q2',
};

export async function handleCheckoutSession(request: Request, env: Env): Promise<Response> {
  const raw = await request.json().catch(() => null);
  const parsed = checkoutSessionRequest.safeParse(raw);
  if (!parsed.success) return err('BadRequest', parsed.error.message, 400);

  const priceEnv = PLAN_TO_PRICE_ENV[parsed.data.plan];
  if (!priceEnv) return err('BadRequest', 'unknown plan', 400);
  const priceId = (env as unknown as Record<string, string>)[priceEnv];
  if (!priceId) return err('Internal', 'price not configured for plan', 500);

  const prefix = (parsed.data.lang ?? 'en') === 'zh-CN' ? '/zh' : '';
  const session = await createCheckoutSession({
    secretKey: env.STRIPE_SECRET_KEY,
    priceId,
    plan: parsed.data.plan,
    tier: 'base',
    successUrl: `https://carbonink.xyz${prefix}/activate?session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `https://carbonink.xyz${prefix}/pricing?cancelled=1`,
    customerEmail: parsed.data.email,
  });
  return json({ checkout_url: session.url });
}
