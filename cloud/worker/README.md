# carbonink-cloud-api — DEPRECATED (retired 2026-06-01)

> **This worker is retired.** CarbonInk went free & open-source (MIT), which
> removed activation, licensing, and payments entirely. Nothing calls `/api/*`
> anymore — the desktop app no longer phones home, and the website's
> account/activate/admin pages are gone.

The code is kept in-repo for history only. It is **no longer deployed** (removed
from `.github/workflows/cloud-deploy.yml`) and its `carbonink.xyz/api/*` route is
commented out in `wrangler.toml`.

Manual teardown (do in the Cloudflare / Stripe dashboards — not in code):

- Delete the `carbonink-cloud-api` Worker (or just leave it unrouted).
- Drop the D1 database + the `LICENSE_ACTIVE` / `HUMANIZED_KEYS` /
  `REVOCATION_SET` / `RATE_LIMIT` KV namespaces.
- Rotate/remove the `LICENSE_PRIVATE_KEY_HEX`, `SESSION_PRIVATE_KEY_HEX`,
  `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` secrets.
- In Stripe: deactivate the product/price; remove the webhook endpoint.
