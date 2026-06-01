# Cloud deploy primitives — Workers everywhere

> Detailed reference for `AGENTS.md`. Linked, not auto-loaded.

`cloud/` is a single **static** site now (the open-source pivot retired the API
backend). It's a Cloudflare Worker serving Static Assets — NOT Cloudflare Pages.
Cloudflare's recommended path is Workers + the Static Assets binding, which
subsumes Pages' capabilities and gets new platform features first.

Per cloud package:

- **`cloud/web/`** — Astro site, **fully prerendered** (`export const prerender
  = true` on every page) via `@astrojs/cloudflare` v13. Pages: `/`, `/download`,
  `/privacy` + their `/zh/` mirrors — all CDN HTML, no SSR. Build emits
  `dist/client/` (static) + `dist/_worker.js/index.js` (the Static-Assets worker
  entry). Deploy: `cd cloud/web && pnpm exec wrangler deploy`.
- **`cloud/worker/`** — old API worker (endpoints + scheduled cron). **Retired**
  — not deployed, `/api/*` route commented out. Code + tests kept for history;
  see `cloud/worker/README.md`.

**Gotcha**: don't put `main` in `cloud/web/wrangler.toml`. The
`@cloudflare/vite-plugin` bundled into `@astrojs/cloudflare` v13 resolves `main`
at vite-config time, before astro emits the build output → ENOENT. The adapter
injects `main` itself at build time.

## Single-domain routing

Everything serves under `carbonink.xyz` from one worker:

| Worker | Path | Notes |
|--------|------|-------|
| web (`cloud/web`) | `/*` (catch-all) | Static marketing HTML |

There is no `/api/*` route anymore — the desktop app is fully local and never
calls the cloud. Because the pages are static there are no cookies, no sessions,
no CORS, and no client→API fetches to reason about. Locale switches via URL
prefix (English at the apex `/`, Chinese under `/zh/*`).

> **History.** Before the OSS pivot this zone hosted two workers (web + an
> `/api/*` backend); the web side SSR'd `/activate` + `/account/*` and the two
> talked over a service binding (`env.API`) with a `session` cookie +
> license-JWT auth. Earlier still it was three subdomained Astro sites (`api.` /
> `activate.` / `account.`) merged into one. All retired — detail in git
> history. Don't reintroduce subdomains or a web→api hop without a strong reason.
