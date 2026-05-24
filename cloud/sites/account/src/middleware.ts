import { defineMiddleware } from 'astro:middleware';

/**
 * Session middleware for the account portal at carbonink.xyz/account.
 *
 * Anything under /account/login (login + callback) is public. For
 * everything else we require a `session=` cookie and probe the Worker
 * — a 401 response from /api/v1/account/devices means the JWT is bad,
 * expired, or for a user that no longer exists, so we kick back to
 * /account/login.
 *
 * We deliberately delegate session validation to the Worker rather
 * than shipping the Ed25519 verifier into this site's bundle. It costs
 * one extra fetch per request but keeps SESSION_PRIVATE_KEY_HEX off
 * this site entirely. The probe is same-origin (carbonink.xyz), so
 * the cookie flows automatically.
 */
export const onRequest = defineMiddleware(async (context, next) => {
  const url = new URL(context.request.url);
  // Astro's `base: '/account'` only rewrites internal links — the raw
  // request pathname still includes the prefix.
  if (url.pathname.startsWith('/account/login') || url.pathname === '/account/login') {
    return next();
  }

  const cookieHeader = context.request.headers.get('Cookie') ?? '';
  const sessionCookie = cookieHeader.split(/;\s*/).find((c) => c.startsWith('session='));
  if (!sessionCookie) return context.redirect('/account/login');

  const probeUrl = new URL('/api/v1/account/devices', url.origin);
  const probe = await fetch(probeUrl.toString(), {
    headers: { Cookie: sessionCookie },
  });
  if (probe.status === 401) return context.redirect('/account/login');
  return next();
});
