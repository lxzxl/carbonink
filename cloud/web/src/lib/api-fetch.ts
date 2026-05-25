// biome-ignore lint/style/useImportType: cloudflare:workers exports a runtime value
import { env } from 'cloudflare:workers';

/**
 * Internal RPC to the carbonink-cloud-api worker via a service binding.
 *
 * Use this for any call from SSR (Astro page frontmatter, middleware)
 * that hits `/api/*`. Do NOT use this from browser-side scripts —
 * client fetches go through the public edge to the API worker
 * directly, no binding needed.
 *
 * Why: Cloudflare Workers same-zone self-fetch via the public URL is
 * pathologically slow (observed ~20s + occasional hangs) and
 * sometimes routes back to the calling worker due to routing-layer
 * quirks. Service bindings sidestep the public layer entirely —
 * the API worker handles the request in-process.
 *
 * Bound in `cloud/web/wrangler.toml`:
 *     [[services]]
 *     binding = "API"
 *     service = "carbonink-cloud-api"
 *
 * Env access uses Astro v6's `cloudflare:workers` runtime module
 * (Astro.locals.runtime.env was removed in v6).
 *
 * The API worker entrypoint strips a `/api/` URL prefix before
 * routing, so we keep the public-shape path here for consistency
 * (you can paste these URLs into curl against carbonink.xyz/api/*
 * and get the same response).
 */

// Narrow shape of the Fetcher binding emitted by Workers.
export interface ApiBinding {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export interface ApiFetchOpts {
  /** Path including leading slash, e.g. `/api/v1/auth/exchange`. */
  path: string;
  method?: 'GET' | 'POST' | 'DELETE' | 'PUT' | 'PATCH';
  /** JSON-serializable body. Adds `Content-Type: application/json`. */
  body?: unknown;
  /** Cookie header to forward (e.g. the inbound user's session cookie). */
  cookie?: string;
  /** Any other headers — overrides Content-Type / Cookie if specified. */
  headers?: Record<string, string>;
}

export async function apiFetch(api: ApiBinding, opts: ApiFetchOpts): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.cookie) headers.Cookie = opts.cookie;
  Object.assign(headers, opts.headers ?? {});
  // URL host is arbitrary — service bindings ignore it. We pick a
  // sensible-looking host so error logs stay readable.
  return api.fetch(`https://carbonink.xyz${opts.path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

/**
 * Read the API service binding from the Workers runtime `env`.
 * Returns null when the binding is missing (dev mode without
 * wrangler) so callers can fall back to a graceful "unavailable"
 * state instead of throwing.
 */
export function getApiBinding(): ApiBinding | null {
  const api = (env as Record<string, unknown>).API;
  if (api && typeof (api as ApiBinding).fetch === 'function') {
    return api as ApiBinding;
  }
  return null;
}

/**
 * Read a typed env binding (secrets / vars) from the Workers
 * runtime. Astro v6 removed `Astro.locals.runtime.env`; this is the
 * approved replacement.
 */
export function getEnv<T extends Record<string, unknown> = Record<string, unknown>>(): T {
  return env as T;
}
