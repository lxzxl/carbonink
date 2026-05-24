import { z } from 'zod';
import type { Env } from '../index.js';
import { sendMagicLinkEmail } from '../lib/email.js';
import { err, json } from '../lib/responses.js';
import { newMagicLinkToken, signSessionJwt } from '../lib/session.js';

const magicLinkReq = z.object({ email: z.string().email() });
const exchangeReq = z.object({ token: z.string().min(1) });

const SESSION_TTL_S = 30 * 86_400;
const MAGIC_LINK_TTL_S = 900;

export async function handleMagicLink(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const raw = await request.json().catch(() => null);
  const parsed = magicLinkReq.safeParse(raw);
  if (!parsed.success) return err('BadRequest', parsed.error.message, 400);

  const customer = await env.DB.prepare('SELECT user_id FROM customer WHERE email = ?')
    .bind(parsed.data.email)
    .first<{ user_id: string }>();
  if (!customer) {
    // Avoid email-enumeration: same response shape either way.
    return json({ sent: true });
  }
  const token = newMagicLinkToken();
  await env.RATE_LIMIT.put(
    `ml:${token}`,
    JSON.stringify({ user_id: customer.user_id, email: parsed.data.email }),
    { expirationTtl: MAGIC_LINK_TTL_S },
  );

  const url = `https://carbonink.xyz/account/login/callback?t=${token}`;
  ctx.waitUntil(
    sendMagicLinkEmail({ email: env.EMAIL, to: parsed.data.email, url, lang: 'en' }),
  );
  return json({ sent: true });
}

export async function handleExchange(request: Request, env: Env): Promise<Response> {
  const raw = await request.json().catch(() => null);
  const parsed = exchangeReq.safeParse(raw);
  if (!parsed.success) return err('BadRequest', parsed.error.message, 400);

  const stored = await env.RATE_LIMIT.get(`ml:${parsed.data.token}`);
  if (!stored) return err('Unauthorized', 'token expired or used', 401);
  await env.RATE_LIMIT.delete(`ml:${parsed.data.token}`); // single-use

  const { user_id, email } = JSON.parse(stored) as { user_id: string; email: string };
  const now = Math.floor(Date.now() / 1000);
  const sessionJwt = await signSessionJwt(
    {
      iss: 'carbonink.xyz/account',
      sub: user_id,
      email,
      iat: now,
      exp: now + SESSION_TTL_S,
    },
    env.SESSION_PRIVATE_KEY_HEX,
  );
  // Single-origin cookie: no Domain attribute needed — every page that
  // reads this session (account portal, API) lives under carbonink.xyz
  // and same-origin requests carry the cookie automatically.
  return new Response(JSON.stringify({ session: sessionJwt }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': `session=${encodeURIComponent(sessionJwt)}; Path=/; Max-Age=${SESSION_TTL_S}; HttpOnly; SameSite=Lax; Secure`,
    },
  });
}
