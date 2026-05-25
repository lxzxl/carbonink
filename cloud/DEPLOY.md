# Deploying carbonink-cloud

Cloudflare deployment is fully scripted — no `wrangler login` needed.
Auth goes through a single `CLOUDFLARE_API_TOKEN` env var, and the
scripts handle bootstrapping, deploying, and pushing secrets.

## One-time setup

### 1. Create a Cloudflare API token

Go to https://dash.cloudflare.com/profile/api-tokens → **Create Token**.

Use the **Custom Token** template with these scopes:

| Type | Permission | Why |
|------|------------|-----|
| Account | Workers Scripts: **Edit** | Deploy the 2 workers |
| Account | Workers KV Storage: **Edit** | Auto-create the 4 KV namespaces on first deploy |
| Account | Workers R2 Storage: **Edit** | Auto-create the `carbonink-releases` bucket |
| Account | D1: **Edit** | Auto-create `carbonink-cloud` DB + apply migrations |
| Account | Account Settings: **Read** | Resolve account ID |
| Zone | Workers Routes: **Edit** | Attach the 2 route patterns to `carbonink.xyz` |
| Zone | Zone: **Read** | Look up the zone |
| Zone | Email: **Edit** | Enable Email Sending on `carbonink.xyz` |

**Account Resources** — Include — *your account*.
**Zone Resources** — Include — *carbonink.xyz*.

Or use the **"Edit Cloudflare Workers" template** (covers most of the
above except D1) and add D1 manually.

Copy the token. You can't see it again after closing the page.

### 2. Fill in cloud/.env.local

```bash
cp cloud/.env.example cloud/.env.local
$EDITOR cloud/.env.local
```

Required: `CLOUDFLARE_API_TOKEN` plus the 4 worker secrets
(`LICENSE_PRIVATE_KEY_HEX`, `SESSION_PRIVATE_KEY_HEX`, `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`).

Email delivery (activation + magic-link) uses Cloudflare's native
Email Sending binding — no third-party API key. Enable it once via
`pnpm exec wrangler email sending enable carbonink.xyz` (token needs
the "Email" zone permission).

The file is gitignored.

### 3. Verify the token works

```bash
./cloud/scripts/check.sh
```

You should see your email + account ID in the `whoami` output. If you
get `Authentication error [code: 10000]`, the token is wrong or the
scopes don't cover what wrangler is trying to do.

## Topology

```
carbonink.xyz/api/*  →  carbonink-cloud-api   (cloud/worker — D1/KV/R2/email backend)
carbonink.xyz/*      →  carbonink-cloud-web   (cloud/web — Astro hybrid SSR)
```

Two workers total. The web worker is hybrid: marketing routes (`/`,
`/pricing`, `/download`, `/privacy` + their `/en/*` mirrors)
prerender at build time (CDN-cached HTML); `/activate`,
`/account/*`, and their EN mirrors are SSR.

## First deploy

```bash
./cloud/scripts/deploy.sh
```

This will:

1. Build the Astro web worker (`cloud/web`)
2. Deploy `cloud/worker` → `carbonink-cloud-api` worker
   - Wrangler **auto-creates** D1 `carbonink-cloud`, 4 KV namespaces, R2
     `carbonink-releases` because their IDs are placeholders in the
     `wrangler.toml`. The real IDs get written back to wrangler.toml —
     **commit those**.
3. Deploy the web worker as catch-all `carbonink.xyz/*`

Then finish provisioning:

```bash
# Push worker secrets from .env.local
./cloud/scripts/push-secrets.sh

# Apply D1 migrations to the remote DB
cd cloud/worker && pnpm exec wrangler d1 migrations apply DB --remote
```

## Migrating from the pre-merge 3-site layout

If your Cloudflare account has the older `carbonink-marketing`,
`carbonink-activate`, and `carbonink-account` workers still
attached to `carbonink.xyz`, the first deploy will fail with:

```
✘ Can't deploy routes that are assigned to another worker.
  "carbonink-marketing" is already assigned to routes:
    - carbonink.xyz/*
```

That's expected — Cloudflare's edge routes are one-worker-per-route
and the new `carbonink-cloud-web` can't claim a pattern someone
else already owns. Delete the orphans first, then re-deploy:

```bash
cd cloud/worker
pnpm exec wrangler delete --name carbonink-marketing
pnpm exec wrangler delete --name carbonink-activate
pnpm exec wrangler delete --name carbonink-account
./cloud/scripts/deploy.sh web   # re-attach /* to the new worker
```

The web worker upload itself succeeds in the original failing run —
only the route-binding step errors — so the worker is already in
the dashboard when you delete the old names. Re-running deploy.sh
just attaches the route and is idempotent.

You'll also need to re-set `STRIPE_SECRET_KEY` on the new web
worker (the `/activate` SSR route uses it; previously it lived on
the deleted `carbonink-activate` worker):

```bash
cd cloud/web && pnpm exec wrangler secret put STRIPE_SECRET_KEY
```

Or set `STRIPE_SECRET_KEY` in `cloud/.env.local` and re-run
`./cloud/scripts/push-secrets.sh` — the script pushes it to both
API and web workers automatically.

## Day-to-day

```bash
# Redeploy everything
./cloud/scripts/deploy.sh

# Deploy just one
./cloud/scripts/deploy.sh worker
./cloud/scripts/deploy.sh web

# Validate without deploying
./cloud/scripts/deploy.sh --dry-run

# Push secrets after editing .env.local
./cloud/scripts/push-secrets.sh

# What's the current state?
./cloud/scripts/check.sh

# Stream live logs
cd cloud/worker && pnpm exec wrangler tail
```

## CI/CD pipeline (GitHub Actions)

Two workflows handle cloud auto-deploy. The `cloud/scripts/deploy.sh`
local script still works (manual ops, dry runs, single-worker
re-deploys) — CI is just the "happy path" for landing changes via PR.

### `.github/workflows/ci.yml` — validation gate

Runs on every PR and every push to `main`:

1. `pnpm desktop:typecheck`
2. `pnpm desktop:test` (vitest, baseline 662)
3. `pnpm cloud:test` (cloud/worker vitest, baseline 92)
4. `pnpm cloud:build:web` (Astro build smoke-test)

~3–5 min on a single Ubuntu runner. PR runs auto-cancel if you push
a new commit to the same branch; main runs never cancel.

### `.github/workflows/cloud-deploy.yml` — auto-deploy

Triggers off a successful `CI` workflow run on `main` (via
`workflow_run`). Also exposes a manual "Run workflow" button on
GitHub for re-deploys without a fresh commit.

What it does, in order:
1. Checks out the exact SHA that CI validated
2. `pnpm install --frozen-lockfile`
3. `pnpm cloud:build:web` (Astro)
4. `wrangler deploy` for `cloud/worker` (api first, then web — keeps
   the routing edge clean during the swap)
5. `wrangler deploy` for `cloud/web`

What it does **NOT** do:
- **No D1 migration apply.** A bad migration would go live the instant
  it merged. Until we have a staging zone, migrations stay explicit:
  the developer who wrote the migration runs `wrangler d1 migrations
  apply DB --remote` BEFORE merging the migration-bearing PR. The
  deploy then picks up code that assumes the schema already moved.
- **No secret rotation.** `push-secrets.sh` stays manual — re-encrypting
  unchanged secret values on every push is wasted work, and the
  failure mode (a rogue PR with a changed `cloud/.env.local`) would be
  serious.
- **No Stripe webhook URL config.** One-shot dashboard click; not
  per-deploy.

### Required GitHub repo secret

| Secret | Value | Scope |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Same token you have in `cloud/.env.local` | All Workers/D1/KV/R2/Email scopes from § 1 above |

Add it at: **Repo → Settings → Secrets and variables → Actions → New
repository secret**. The token can be the same one local dev uses —
or scoped narrower if you want CI to fail-closed on bootstrap-only
operations (it only needs Workers Scripts: Edit + Workers Routes:
Edit for steady-state deploys).

### When CI catches a regression

A red PR can't be merged (configure branch protection on `main` to
require the CI check to pass). A red push to main blocks the cloud
auto-deploy via the `workflow_run.conclusion == success` gate. Fix
forward in a new commit; the next green main SHA deploys
automatically.

### Bypassing CI

Use the manual `workflow_dispatch` trigger on cloud-deploy.yml when
CI's broken for environmental reasons (rare — GH Actions outage,
flaky transient) but the code is fine. Deploys HEAD of the chosen
branch unconditionally.

## Stripe webhook URL

After the first deploy, set the webhook endpoint in Stripe dashboard:

- URL: `https://carbonink.xyz/api/v1/stripe-webhook`
- Events: `checkout.session.completed`, `customer.subscription.updated`,
  `customer.subscription.deleted` (whatever `stripe-webhook.ts` handles)
- Copy the signing secret it generates → paste into `STRIPE_WEBHOOK_SECRET`
  in `cloud/.env.local` → re-run `./cloud/scripts/push-secrets.sh`

## Rolling back

```bash
cd cloud/worker
pnpm exec wrangler versions list
pnpm exec wrangler rollback           # to previous
pnpm exec wrangler rollback <VERSION> # to specific
```
