# Deploying carbonink-cloud

`cloud/web` is a **static Astro marketing site** — the only thing that deploys.
These instructions cover the web site only.

Deployment is scripted — no `wrangler login`. Auth is a single
`CLOUDFLARE_API_TOKEN` env var.

## One-time setup

### 1. Create a Cloudflare API token

https://dash.cloudflare.com/profile/api-tokens → **Create Token** → Custom
Token. The static site needs only:

| Type | Permission | Why |
|------|------------|-----|
| Account | Workers Scripts: **Edit** | Deploy the web worker |
| Account | Account Settings: **Read** | Resolve account ID |
| Zone | Workers Routes: **Edit** | Attach `carbonink.xyz/*` to the worker |
| Zone | Zone: **Read** | Look up the zone |

**Account Resources** → Include → *your account*. **Zone Resources** → Include
→ *carbonink.xyz*. Copy the token (shown once).

### 2. Fill in cloud/.env.local

```bash
cp cloud/.env.example cloud/.env.local
$EDITOR cloud/.env.local   # set CLOUDFLARE_API_TOKEN
```

That's the only value the live site needs — **no worker secrets**. The static
site has no Stripe key, no license key, and no sessions. The file is gitignored.

### 3. Verify the token

```bash
./cloud/scripts/check.sh   # prints your email + account ID via whoami
```

## Topology

```
carbonink.xyz/*  →  carbonink-cloud-web   (cloud/web — static Astro)
```

One worker, catch-all on the zone; all routes prerender to CDN HTML. Fully
static — no SSR pages, no API. The desktop app never phones home.

> Note: Astro 6's Cloudflare adapter auto-injects a `SESSION` KV binding when
> no session driver is configured. `astro.config.mjs` pins the inert memory
> driver so the generated wrangler config carries **no KV binding** — without
> that, deploys fail with error 10210 once a referenced namespace is deleted
> (this bit us on 2026-08-25 after the pre-OSS `SESSION` namespace was
> removed). Keep the session pin if you ever regenerate the config.

## Deploy

```bash
# Build + deploy the web site
pnpm cloud:build:web
cd cloud/web && pnpm exec wrangler deploy

# …or via the helper (build + deploy in one):
./cloud/scripts/deploy.sh web

# Validate without deploying
./cloud/scripts/deploy.sh --dry-run
```

The Astro build emits `dist/` (static assets + the Static-Assets worker entry);
wrangler uploads it and attaches `carbonink.xyz/*`.

## CI/CD — auto-deploy on push to main

Two workflows in `.github/workflows/`:

- **`ci.yml`** — PR + push-to-main gate: `desktop:typecheck`, `desktop:test`
  (vitest), `cloud:build:web` (Astro build). ~3–5 min on one Linux runner.
- **`cloud-deploy.yml`** — `workflow_run`-gated on a green CI run on `main`.
  Builds + deploys **`cloud/web`** (`cd cloud/web && wrangler deploy`). Also
  exposes a manual `workflow_dispatch` button.

Required GitHub repo secret: **`CLOUDFLARE_API_TOKEN`** (same scopes as § 1) at
*Repo → Settings → Secrets and variables → Actions*.

A red PR can't merge (branch protection on `main`); a red main push blocks the
deploy via the `workflow_run.conclusion == success` gate. Fix forward.

## Rolling back

```bash
cd cloud/web
pnpm exec wrangler versions list
pnpm exec wrangler rollback           # previous
pnpm exec wrangler rollback <VERSION> # specific
```

## Dashboard residue

Live leftovers still sitting in the Cloudflare / Stripe dashboards (the
deploy token can't see or remove them):

- [ ] Stripe: if not yet done, deactivate the product + webhook endpoint
  (`https://carbonink.xyz/api/v1/stripe-webhook`) and revoke
  `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`.

(Everything else from the old backend — D1 `carbonink-cloud`, the four license
KVs, R2 `carbonink-releases`, the api worker + its secrets, and the orphaned
`SESSION` KV namespace — was deleted 2026-08-24. The `SESSION` binding on the
live web worker outlived its namespace and blocked deploys until 2026-08-25,
when the adapter's auto-injected binding was removed at the source via the
memory session driver.)
