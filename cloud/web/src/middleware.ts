import { defineMiddleware } from 'astro:middleware';

/**
 * Session middleware for the account portal — gates `/account/*` and
 * `/en/account/*` under a valid session cookie.
 *
 * Public exceptions (no auth required):
 *   /account/login              /en/account/login
 *   /account/login/callback     /en/account/login/callback
 *
 * Everything else under `/account/*` (the dashboard) needs a valid
 * session cookie. We delegate validation to the API worker rather
 * than verifying the JWT signature here — that keeps
 * SESSION_PRIVATE_KEY_HEX out of this site's bundle entirely. The
 * probe is same-origin (carbonink.xyz/api/v1/account/devices),
 * costs one extra fetch per request, and the cookie flows
 * automatically.
 *
 * After the 3-site merge this middleware lives in the single web
 * worker. Paths outside `/account` and `/en/account` are completely
 * unaffected — the early-return for non-account paths costs only a
 * `startsWith` check before any I/O.
 */

function isAccountPath(pathname: string): boolean {
  return pathname.startsWith('/account/') || pathname === '/account'
    || pathname.startsWith('/en/account/') || pathname === '/en/account';
}

function isLoginPath(pathname: string): boolean {
  // Includes the magic-link callback under `/login/callback`. Use
  // `startsWith` so a `?next=...` query string doesn't bypass the
  // gate by ending up at `/account/login?next=/whatever`.
  return pathname.startsWith('/account/login') || pathname.startsWith('/en/account/login');
}

function loginRedirectFor(pathname: string): string {
  return pathname.startsWith('/en/') ? '/en/account/login' : '/account/login';
}

export const onRequest = defineMiddleware(async (context, next) => {
  const url = new URL(context.request.url);
  const path = url.pathname;

  // Non-account paths skip the middleware entirely — marketing
  // pages, activate, /api/* (handled by a different Worker
  // anyway), static assets, etc.
  if (!isAccountPath(path)) return next();

  // Login + callback are public.
  if (isLoginPath(path)) return next();

  const cookieHeader = context.request.headers.get('Cookie') ?? '';
  const sessionCookie = cookieHeader.split(/;\s*/).find((c) => c.startsWith('session='));
  if (!sessionCookie) return context.redirect(loginRedirectFor(path));

  const probeUrl = new URL('/api/v1/account/devices', url.origin);
  const probe = await fetch(probeUrl.toString(), {
    headers: { Cookie: sessionCookie },
  });
  if (probe.status === 401) return context.redirect(loginRedirectFor(path));
  return next();
});
