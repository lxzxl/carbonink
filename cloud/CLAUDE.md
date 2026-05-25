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
