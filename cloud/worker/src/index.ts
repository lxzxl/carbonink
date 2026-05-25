import { json } from './lib/responses.js';
import { handleAccountDevices, handleBillingPortal } from './routes/account.js';
import { handleAccountDelete } from './routes/account-delete.js';
import { handleActivate } from './routes/activate.js';
import { handleExchange, handleMagicLink } from './routes/auth.js';
import { handleCheckoutSession } from './routes/checkout-session.js';
import { handleDeactivateDevice } from './routes/devices.js';
import { handleLicenseByEmail } from './routes/internal-lookup.js';
import { handleLicenseRequest } from './routes/license-request.js';
import { handleStripeWebhook } from './routes/stripe-webhook.js';
import { handleTrialSignup } from './routes/trial-signup.js';
import { handleUpdates } from './routes/updates.js';
import { handleVerify } from './routes/verify.js';
import { runRevocationSweep } from './scheduled/revoke-cron.js';

export interface Env {
  DB: D1Database;
  LICENSE_ACTIVE: KVNamespace;
  REVOCATION_SET: KVNamespace;
  HUMANIZED_KEYS: KVNamespace;
  RATE_LIMIT: KVNamespace;
  RELEASES: R2Bucket;
  LICENSE_PRIVATE_KEY_HEX: string;
  SESSION_PRIVATE_KEY_HEX: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  STRIPE_PRICE_BASE_2026Q2: string;
  EMAIL: SendEmail;
  STRIPE_PUBLISHABLE_KEY: string;
  ENVIRONMENT: string;
}

// Single-domain deployment: web clients (marketing, activate, account
// portal) all live under carbonink.xyz and call /api/* same-origin —
// no CORS needed for them. The Electron desktop client talks to the API
// from a file://-ish origin without browser cookies (auth is the
// license JWT in the request body). Permissive `*` CORS with no
// credentials suffices for both — and avoids the credentialed-origin
// allowlist we used to maintain in this file.
function corsHeaders(_request: Request): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function addCors(res: Response, request: Request): Response {
  const merged = new Headers(res.headers);
  for (const [k, v] of Object.entries(corsHeaders(request))) {
    merged.set(k, v);
  }
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: merged,
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Cloudflare Workers Routes dispatches `carbonink.xyz/api/*` here.
    // Strip the `/api` prefix so existing handlers continue to match
    // `/v1/*`. We rebuild the Request URL so downstream handlers that
    // re-parse `request.url` (e.g. updates.ts, devices.ts) see the same
    // path the entrypoint dispatched on.
    const originalUrl = new URL(request.url);
    let path = originalUrl.pathname;
    if (path.startsWith('/api/')) {
      path = path.slice(4); // '/api/v1/activate' → '/v1/activate'
    } else if (path === '/api') {
      path = '/';
    }
    if (path !== originalUrl.pathname) {
      const rewritten = new URL(request.url);
      rewritten.pathname = path;
      request = new Request(rewritten, request);
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(request) });
    }

    const res = await route(request, env, ctx, path);
    return addCors(res, request);
  },
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    await runRevocationSweep(env, Math.floor(Date.now() / 1000));
  },
} satisfies ExportedHandler<Env>;

async function route(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  path: string,
): Promise<Response> {
  if (path === '/health') {
    return json({ status: 'ok', timestamp: Date.now() });
  }

  if (request.method === 'POST' && path === '/v1/activate') {
    return handleActivate(request, env, ctx);
  }

  if (request.method === 'POST' && path === '/v1/verify') {
    return handleVerify(request, env, ctx);
  }

  if (request.method === 'POST' && path === '/v1/trial-signup') {
    return handleTrialSignup(request, env, ctx);
  }

  if (request.method === 'POST' && path === '/v1/license-request') {
    return handleLicenseRequest(request, env, ctx);
  }

  if (request.method === 'POST' && path === '/v1/checkout-session') {
    return handleCheckoutSession(request, env);
  }

  if (request.method === 'POST' && path === '/v1/stripe-webhook') {
    return handleStripeWebhook(request, env, ctx);
  }

  if (request.method === 'GET' && path.startsWith('/v1/updates/')) {
    return handleUpdates(request, env);
  }

  if (request.method === 'GET' && path === '/v1/internal/license-by-email') {
    return handleLicenseByEmail(request, env);
  }

  if (request.method === 'POST' && path === '/v1/auth/magic-link') {
    return handleMagicLink(request, env, ctx);
  }

  if (request.method === 'POST' && path === '/v1/auth/exchange') {
    return handleExchange(request, env);
  }

  if (request.method === 'GET' && path === '/v1/account/devices') {
    return handleAccountDevices(request, env);
  }

  if (request.method === 'GET' && path === '/v1/account/billing-portal') {
    return handleBillingPortal(request, env);
  }

  if (request.method === 'POST' && /^\/v1\/devices\/[^/]+\/deactivate$/.test(path)) {
    return handleDeactivateDevice(request, env);
  }

  if (request.method === 'DELETE' && path === '/v1/account') {
    return handleAccountDelete(request, env);
  }

  return json({ error: { _tag: 'NotFound', message: `No route: ${path}` } }, 404);
}
