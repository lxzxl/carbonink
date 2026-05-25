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
carbonink.xyz/*      →  carbonink-cloud-web   (cloud/sites/marketing — merged Astro web)
```

After the 3-site merge there are just two workers. The web worker is
hybrid: marketing routes (`/`, `/pricing`, `/download`, `/privacy` +
their `/en/*` mirrors) prerender at build time (CDN-cached HTML);
`/activate`, `/account/*`, and their EN mirrors are SSR.

## First deploy

```bash
./cloud/scripts/deploy.sh
```

This will:

1. Build the merged Astro site (`cloud/sites/marketing`)
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
