# Cloud deploy primitives — Workers everywhere

> Detailed reference for `AGENTS.md`. Linked, not auto-loaded.

Both cloud packages are Cloudflare Workers (API + web). We do NOT
use Cloudflare Pages — Cloudflare's recommended path now is Workers
+ the Static Assets binding, which subsumes Pages' capabilities and
gets all the new platform features first.

Per cloud package:

- **`cloud/worker/`** — pure Worker (API endpoints + scheduled cron).
  Deploy: `cd cloud/worker && wrangler deploy`.
- **`cloud/web/`** — Astro site, hybrid SSG + SSR via
  `@astrojs/cloudflare` v13. Marketing pages (`/`, `/pricing`,
  `/download`, `/privacy` + `/en/*` mirrors) `export const prerender
  = true` so they ship as CDN HTML; `/activate`, `/account/*`,
  `/login*` and their EN mirrors are SSR. Build emits `dist/client/`
  (static) + `dist/_worker.js/index.js` (Worker entry). Deploy:
  `pnpm --filter @carbonink-cloud/web deploy` → `astro build &&
  wrangler deploy`.

**Gotcha**: don't put `main` in `cloud/web/wrangler.toml`. The
`@cloudflare/vite-plugin` bundled into `@astrojs/cloudflare` v13
resolves `main` at vite-config time, before astro emits the build
output → ENOENT. The adapter injects `main` itself at build time.

## Single-domain routing

Everything serves under `carbonink.xyz`. Each Worker declares its
prefix in `wrangler.toml`:

| Worker | Path prefix | Notes |
|--------|------------|-------|
| API (`cloud/worker`) | `/api/*` | Entry strips `/api` so handlers match `/v1/*` |
| web (`cloud/web`) | `/*` (catch-all) | Catch-all; longest-prefix loses to `/api/*` only |

Before the 3-site merge there were 3 Astro workers (marketing /
activate / account) split across `/`, `/activate*`, `/account*`.
They now all live in `cloud/web/` as one Astro app with
per-page prerender opt-in; lang switches via URL prefix (zh-CN at
`/`, en at `/en/*`).

Same-origin benefits this buys:

- **Cookie**: `session` has no `Domain` attribute (same-origin
  auto-sent). Set in `auth.ts`, cleared in `account-delete.ts`.
- **CORS**: not needed for web. API uses permissive
  `Access-Control-Allow-Origin: *` with no `Allow-Credentials`. Web
  clients are same-origin (CORS doesn't fire); the desktop Electron
  client uses the license JWT in the body (no cookies).
- **Client fetch**: relative URLs (`/api/v1/...`) from `<script>` in
  Astro pages. Astro SSR fetches build an absolute URL via
  `new URL('/api/v1/...', new URL(Astro.request.url).origin)` because
  Worker `fetch()` needs an absolute URL even for same-origin calls.

Previously each site had its own subdomain (`api.`, `activate.`,
`account.`); that's retired — added DNS + CORS + cookie `Domain=`
complexity for no real benefit since they're all parts of one
product. Don't reintroduce subdomains without a strong reason.

**Astro `base` gotcha**: with `base: '/account'`, internal `<Link>`
components get rewritten, but raw `<a href="/login">` does NOT. Audit
any hardcoded `href`/`action` paths in SSR sites and prefix them
manually (e.g. `/account/login`).
