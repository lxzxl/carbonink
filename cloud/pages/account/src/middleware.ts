import { defineMiddleware } from 'astro:middleware';

/**
 * Session middleware for account.carbonbook.app.
 *
 * Anything under /login (login + callback) is public. For everything else
 * we require a `session=` cookie and probe the Worker — a 401 response from
 * /v1/account/devices means the JWT is bad, expired, or for a user that no
 * longer exists, so we kick back to /login.
 *
 * We deliberately delegate session validation to the Worker rather than
 * shipping the Ed25519 verifier into the Pages bundle. It costs one extra
 * fetch per request but keeps the SESSION_PRIVATE_KEY_HEX off this site
 * entirely.
 */
export const onRequest = defineMiddleware(async (context, next) => {
  const url = new URL(context.request.url);
  if (url.pathname.startsWith('/login')) return next();

  // biome-ignore lint/suspicious/noExplicitAny: Astro.locals.runtime is untyped
  const runtime = (context.locals as any).runtime as { env: { API_ORIGIN?: string } } | undefined;
  const apiOrigin = runtime?.env?.API_ORIGIN ?? 'https://api.carbonbook.app';

  const cookieHeader = context.request.headers.get('Cookie') ?? '';
  const sessionCookie = cookieHeader.split(/;\s*/).find((c) => c.startsWith('session='));
  if (!sessionCookie) return context.redirect('/login');

  const probe = await fetch(`${apiOrigin}/v1/account/devices`, {
    headers: { Cookie: sessionCookie },
  });
  if (probe.status === 401) return context.redirect('/login');
  return next();
});
