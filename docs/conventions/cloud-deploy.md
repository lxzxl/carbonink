# Cloud deploy primitives — Workers everywhere

> Detailed reference for `AGENTS.md`. Linked, not auto-loaded.

`cloud/` is a single **static** site — a Cloudflare Worker serving Static
Assets, NOT Cloudflare Pages. Cloudflare's recommended path is Workers + the
Static Assets binding, which subsumes Pages' capabilities and gets new
platform features first.

Per cloud package:

- **`cloud/web/`** — Astro site, **fully prerendered** (`export const prerender
  = true` on every page) via `@astrojs/cloudflare` v13. Pages: `/`, `/download`,
  `/privacy`, `/guides/*` + their `/zh/` mirrors — all CDN HTML, no SSR. Build
  emits `dist/client/` (static) + `dist/_worker.js/index.js` (the Static-Assets
  worker entry). Deploy: `cd cloud/web && pnpm exec wrangler deploy`.

**Gotcha**: don't put `main` in `cloud/web/wrangler.toml`. The
`@cloudflare/vite-plugin` bundled into `@astrojs/cloudflare` v13 resolves `main`
at vite-config time, before astro emits the build output → ENOENT. The adapter
injects `main` itself at build time.

## Single-domain routing

Everything serves under `carbonink.xyz` from one worker:

| Worker | Path | Notes |
|--------|------|-------|
| web (`cloud/web`) | `/*` (catch-all) | Static marketing HTML |

The desktop app is fully local and never calls the cloud. Because the pages
are static there are no cookies, no sessions, no CORS, and no client→API
fetches to reason about. Locale switches via URL prefix (English at the apex
`/`, Chinese under `/zh/*`). Keep it this way: if a future change ever needs a
web→api hop on this zone, use a service binding — **never `fetch()` your own
zone's public URL from inside a Worker** (Cloudflare loops it at the routing
layer for ~20s before giving up).
