# carbonink-cloud — architecture notes

For deploy/secrets/Stripe/migration ops, see [DEPLOY.md](./DEPLOY.md).
This file covers the patterns that took the longest to debug — so the
next time someone (or some agent) walks into this code they don't have
to re-derive them.

## Topology

```
carbonink.xyz/api/*  →  carbonink-cloud-api   (cloud/worker)
carbonink.xyz/*      →  carbonink-cloud-web   (cloud/web — Astro hybrid SSR)
                                                │
                                                ▼ service binding env.API
                                              api worker (internal RPC)
```

Two workers, same zone. The web worker SSRs the marketing pages,
activate flow, account portal, and admin queue. When it needs data
that lives behind `/api/v1/*` — license lookup, session probe, admin
list — it calls the api worker through a **service binding**, not
through the public URL.

## Why we use a service binding (not `fetch('https://carbonink.xyz/api/...')`)

Cloudflare Workers cannot reliably self-fetch their own zone over the
public edge — under load the request loops at the routing layer for
~20 seconds before giving up. We hit this on the magic-link login
callback: the web worker SSR did `fetch('https://carbonink.xyz/api/v1/auth/exchange')`,
which CF dispatched right back to the same zone, which the api worker
never actually received. `wrangler tail` on the api side showed zero
inbound requests during the 20s hang.

The fix is `[[services]]` in `cloud/web/wrangler.toml`:

```toml
[[services]]
binding = "API"
service = "carbonink-cloud-api"
```

That binding bypasses the public edge entirely — it's an in-process
RPC dispatch between two workers in the same account. POST latency
went from 19.75s → 0.52s in production.

**Never call your own zone's public URL from inside a Worker.** If
you need to add another web→api path, use `env.API.fetch(...)` via
the `apiFetch()` helper.

## The `lib/api-fetch.ts` helper

`cloud/web/src/lib/api-fetch.ts` exists because Astro v6 made
two things harder than they used to be:

1. **`Astro.locals.runtime.env` was removed.** The v6 runtime error
   tells you exactly what to do: `import { env } from 'cloudflare:workers'`.
   `getEnv()` and `getApiBinding()` wrap that import so the rest of
   the code stays portable if Astro changes its mind again.

2. **Service binding RPC needs a fully-qualified URL.** `env.API.fetch`
   wants an absolute origin, but the path it dispatches on is what
   the api worker sees. `apiFetch(api, { path: '/api/v1/foo' })`
   constructs `https://carbonink.xyz/api/v1/foo` and the api worker
   strips the `/api` prefix in `cloud/worker/src/index.ts` so route
   handlers continue to match `/v1/*`.

Use the helper. Don't reach into `cloudflare:workers` directly from
page files — it makes the call sites harder to read and the dev-vs-prod
type story muddier.

## Two-step magic-link confirm

`cloud/web/src/pages/account/login/callback.astro` and its `/en/`
mirror are deliberately a **GET-then-POST** flow, not a one-click
auto-exchange. The token from the email link is consumed only on
POST.

This is because email scanners (Outlook Safe Links, Defender ATP,
Mimecast) pre-fetch URLs to inspect them. A single-use magic token
that's consumed on GET gets burned by the scanner *before the user
clicks*, and the legitimate click then sees "link expired."

The pattern:
1. Email contains `GET /account/login/callback?t=<token>` — page
   renders a "Click to finish sign in" button (token in a hidden form
   field).
2. User click submits POST with the token. POST calls `apiFetch()` →
   `/v1/auth/exchange`, gets the session cookie, redirects.
3. Astro's built-in CSRF check (Origin header must match) means the
   scanner's pre-fetch can't trigger the POST.

Same pattern Slack, Notion, and Vercel use. Don't "simplify" it back
into a one-click flow.

## Admin gate

`cloud/worker/src/lib/admin-auth.ts` — single-admin model. There's
no `admin` table; we compare `claims.email` to `env.ADMIN_EMAIL`
(set as a `[vars]` entry, not a secret — the magic-link session JWT
signature is the actual auth, the email is just a directory).

`handleMagicLink` in `cloud/worker/src/routes/auth.ts` auto-provisions
a `customer` row for `ADMIN_EMAIL` on first login. Without that
auto-provision, the admin gets silent `{sent: true}` responses with
no email because the no-customer branch is the standard
enumeration-prevention path.

## CI/CD — auto-deploy on push to main

Two workflows in `.github/workflows/`:

- `ci.yml` — PR + push-to-main validation (typecheck + desktop vitest
  + cloud worker vitest + cloud/web Astro build, ~3–5 min on Linux).
- `cloud-deploy.yml` — workflow_run-gated on CI success on main. Runs
  `wrangler deploy` for `cloud/worker` then `cloud/web`. Also exposes a
  manual `workflow_dispatch` button.

What auto-deploys: code only. What stays explicit:

- **D1 migrations** — apply by hand (`wrangler d1 migrations apply DB
  --remote`) BEFORE merging the PR. No staging zone yet → auto-apply
  would put a bad migration live before anyone could catch it.
- **Worker secrets** — `push-secrets.sh` stays manual; per-deploy
  re-encryption is waste, and a rogue PR touching `.env.local` would
  be serious.

Required GitHub repo secret: `CLOUDFLARE_API_TOKEN` (same scopes as
your local `cloud/.env.local`, see `cloud/DEPLOY.md`).

The local `cloud/scripts/deploy.sh` still works for manual ops
(`--dry-run`, single-worker re-deploys, debugging) — CI is just the
default happy path.

## Brand palette — same identity as the desktop app

The cloud site's color tokens (`cloud/web/src/styles/global.css`) are
aligned with the desktop X2 icon design. **Source of truth** is
`desktop/scripts/icon-designs.mjs::PALETTE` — when the desktop
identity moves, this file moves with it.

| Token | Hex | Role |
|---|---|---|
| `--color-primary` / `moss-500` | `#6B8266` | CTA buttons, focus rings, badges, accent text |
| `--color-primary-foreground` | `#ffffff` | Text on `bg-primary` (4.9:1 contrast on moss-500, WCAG AA-pass) |
| moss ramp `50/100/200/300/600/700/800/900` | derived | Soft backgrounds, borders, hover states |
| `--color-background` | `#ffffff` | Page background |
| `--color-foreground` | `#0f172a` | Body text |
| `--color-border` | `#e2e8f0` | Neutral chrome borders |

LogoMark + favicon use the X2 "stacked data rows" mark verbatim
(`graphite #15171A` squircle + `cream #F4EFE3` top/bottom bars +
`moss-500 #6B8266` middle bar). SVG coords are in 1024-design-space
so they copy-paste directly from `drawDirectionX2`.

**Do not introduce `bg-sky-*` / `text-sky-*` / `border-sky-*` here.**
The old Figma Make palette is fully retired. New chromatic accents
go through the moss ramp; if a shade is missing, extend the ramp in
`global.css` rather than reaching for a different Tailwind family.
The `--color-brand-*` legacy aliases also point at moss; they're a
soft-landing pad for any stale references, not a second palette.

Reminder: this brand is "old money green" — pharmacist's apothecary
jar, antique library, Jaguar dashboard — NOT a recycling-symbol /
SaaS-eco green. Resist the urge to bump saturation when adding
shades.

## Test conventions

`cloud/worker/tests/*.test.ts` uses `@cloudflare/vitest-pool-workers`.
A few patterns worth knowing:

- **Migrations are applied once per run** by `apply-migrations.ts`
  (`beforeAll`). The D1 and KV bindings are *shared* across tests in
  the file — use distinct emails / IPs / IDs per test rather than
  trying to wipe state.
- **Stub the EMAIL binding** with `vi.fn()`: `(env as any).EMAIL = { send: spy }`.
  The Workers `send_email` binding has no fetch surface, so `fetchMock`
  doesn't help.
- **Override env secrets per test**: `(env as any).SESSION_PRIVATE_KEY_HEX = SESSION_KEY`
  in a `beforeEach`. The fixture key in `_fixtures.ts` is for license
  signing; sessions use a separate test key.
- **Build session JWTs directly**: `signSessionJwt(claims, SESSION_KEY)`
  → set as `Cookie: session=<jwt>`. See `tests/admin.test.ts` for the
  full pattern, including admin-vs-non-admin distinction.
