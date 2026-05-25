import { defineMiddleware } from 'astro:middleware';
import { apiFetch, getApiBinding } from './lib/api-fetch.ts';

/**
 * Session middleware for the account portal AND the admin tools.
 *
 * Two gated path families:
 *
 *   /account/*  /en/account/*   — any logged-in user (their own dashboard)
 *   /admin/*                     — logged-in user who matches ADMIN_EMAIL
 *
 * Public exceptions (no auth required):
 *   /account/login              /en/account/login
 *   /account/login/callback     /en/account/login/callback
 *
 * For both gates we delegate session validation to the API worker
 * rather than verifying the JWT signature here — that keeps
 * SESSION_PRIVATE_KEY_HEX out of this site's bundle entirely. The
 * probe is same-origin (carbonink.xyz/api/v1/...), costs one extra
 * fetch per request, and the cookie flows automatically.
 *
 * For admin paths we probe `/api/v1/admin/license-requests` instead
 * of `/devices` — it's the canonical admin endpoint, so a 200 from
 * it confirms both auth AND admin-role. 401 sends to login; 403
 * sends to /account/ (they're logged in but not admin).
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

function isAdminPath(pathname: string): boolean {
  // Single-locale admin surface — no /en/admin mirror. The audience
  // is one person (the project owner). Internal tools don't need
  // bilingual chrome.
  return pathname.startsWith('/admin/') || pathname === '/admin';
}

function loginRedirectFor(pathname: string): string {
  if (pathname.startsWith('/admin')) {
    return '/account/login?next=' + encodeURIComponent(pathname);
  }
  return pathname.startsWith('/en/') ? '/en/account/login' : '/account/login';
}

export const onRequest = defineMiddleware(async (context, next) => {
  const url = new URL(context.request.url);
  const path = url.pathname;
  const admin = isAdminPath(path);
  const account = isAccountPath(path);

  // Paths not under either gate skip the middleware — marketing
  // pages, activate, static assets, etc. Note `/api/*` is handled
  // by the separate API worker, never lands here.
  if (!admin && !account) return next();

  // Login + callback are public (only matters for the account gate;
  // admin has no public exception).
  if (account && isLoginPath(path)) return next();

  const cookieHeader = context.request.headers.get('Cookie') ?? '';
  const sessionCookie = cookieHeader.split(/;\s*/).find((c) => c.startsWith('session='));
  if (!sessionCookie) return context.redirect(loginRedirectFor(path));

  // Probe endpoint differs per gate so a non-admin trying /admin/*
  // gets a clean 403 → redirect to /account/, not "you're logged
  // out". Without this, they'd see a confusing login screen even
  // though their session is fine.
  //
  // Goes through the service binding (sub-ms internal RPC) rather
  // than a public-edge self-fetch (which hangs ~20 s).
  const api = getApiBinding();
  if (!api) {
    // No binding in dev / preview without wrangler — let through so
    // local Astro dev still works. Production deploy always binds.
    return next();
  }
  const probePath = admin ? '/api/v1/admin/license-requests' : '/api/v1/account/devices';
  const probe = await apiFetch(api, { path: probePath, cookie: sessionCookie });
  if (probe.status === 401) return context.redirect(loginRedirectFor(path));
  if (admin && probe.status === 403) return context.redirect('/account/');
  return next();
});
