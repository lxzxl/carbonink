# Deploying carbonink-cloud

`cloud/web` is a **static Astro marketing site** — the only thing that deploys.
The old `carbonink-cloud-api` Worker (Stripe / licensing / accounts) is
**retired** (see [worker/README.md](worker/README.md)); these instructions
cover the web site only.

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

> The pre-pivot token also needed D1 / KV / R2 / Email / Stripe scopes for the
> api worker. None of that is required anymore — the site is static and stores
> nothing.

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

One worker, catch-all on the zone. All routes prerender to CDN HTML; there is
no `/api/*` route (the api worker is retired).

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
  (vitest), `cloud:test` (worker vitest — still run though the worker is
  retired, so the frozen code stays green), `cloud:build:web` (Astro build).
  ~3–5 min on one Linux runner.
- **`cloud-deploy.yml`** — `workflow_run`-gated on a green CI run on `main`.
  Builds + deploys **`cloud/web` only** (`cd cloud/web && wrangler deploy`). The
  `cloud/worker` deploy step was removed with the OSS pivot. Also exposes a
  manual `workflow_dispatch` button.

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

## Tearing down the api worker (manual, optional)

The `carbonink-cloud-api` worker is no longer deployed. If it's still attached
in your Cloudflare account you can remove it — checklist in
[worker/README.md](worker/README.md): delete the Worker, drop the D1 DB + KV
namespaces, rotate the old license / Stripe secrets, and deactivate the Stripe
product + webhook.
