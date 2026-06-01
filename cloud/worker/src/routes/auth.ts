import { z } from 'zod';
import type { Env } from '../index.js';
import { sendMagicLinkEmail } from '../lib/email.js';
import { newUserId } from '../lib/id.js';
import { err, json } from '../lib/responses.js';
import { newMagicLinkToken, signSessionJwt } from '../lib/session.js';

const magicLinkReq = z.object({
  email: z.string().email(),
  // Locale of the page the request came from — selects the callback
  // URL prefix (/zh/ for Chinese) and the email language. Optional;
  // older clients / direct API callers default to English.
  lang: z.enum(['zh-CN', 'en']).optional(),
});
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

  let customer = await env.DB.prepare('SELECT user_id FROM customer WHERE email = ?')
    .bind(parsed.data.email)
    .first<{ user_id: string }>();

  // Admin bootstrap — the project owner never goes through
  // trial-signup or admin-issue, so on first login the customer
  // row doesn't exist yet. Auto-provision it iff the email matches
  // env.ADMIN_EMAIL. For any other email we keep the silent
  // enumeration-resistant path: customers must exist to receive
  // magic links.
  if (!customer && env.ADMIN_EMAIL && parsed.data.email === env.ADMIN_EMAIL) {
    const adminUserId = newUserId();
    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      'INSERT INTO customer (user_id, email, country, created_at) VALUES (?, ?, ?, ?)',
    )
      .bind(adminUserId, parsed.data.email, null, now)
      .run();
    customer = { user_id: adminUserId };
  }

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

  const lang = parsed.data.lang ?? 'en';
  const prefix = lang === 'zh-CN' ? '/zh' : '';
  const url = `https://carbonink.xyz${prefix}/account/login/callback?t=${token}`;
  ctx.waitUntil(
    sendMagicLinkEmail({ email: env.EMAIL, to: parsed.data.email, url, lang }),
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
