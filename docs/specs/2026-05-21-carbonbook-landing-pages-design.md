# carbonbook landing pages — design spec

- **Created**: 2026-05-21
- **Status**: Design (Phase 4 sub-project F). Implementation = sub-project G.
- **Goal**: Specify the public-web surface for carbonbook: the marketing/pricing site (`carbonbook.app`), the activation page, and the customer account portal (`account.carbonbook.app`).

## Hosting

All three sites are **Cloudflare Pages** projects, each connected to a
subdirectory of the `carbonbook-cloud` repo (planned for sub-project G):

| Subdomain | Path in repo | Purpose |
|---|---|---|
| `carbonbook.app` | `pages/marketing` | Marketing, pricing, FAQ, download |
| `activate.carbonbook.app` | `pages/activate` | One-page activation helper (paste JWT → copy → return to app) |
| `account.carbonbook.app` | `pages/account` | Authenticated portal: my plan, devices, billing |

Static-first with edge functions only where needed (auth callback on
`account` subdomain). No SPA framework — Astro 5 + plain TypeScript is
the v1 default; switch to Next/Remix if we outgrow this in v1.5.

## Site map and pages

### `carbonbook.app/` (marketing root)

```
[hero]
  "Local GHG accounting for export factories that hate spreadsheets"
  [Download for macOS]  [Download for Windows]
  • Single-machine, no cloud sync.  • AI does the data engineering.

[problem section]
  3-column: CSRD pressure / CBAM compliance / A-share supplier surveys

[solution]
  3-step illustrated walkthrough:
  1. 上传单据 / Upload bills
  2. AI 抽取 + 配 EF / AI extracts + matches EFs
  3. 一键导报告 / One-click report

[3 differentiators]
  Single-machine · AI as data engineer · Calc + Fill in one ledger

[pricing summary]  → /pricing

[footer]
  About · Pricing · Docs · Privacy · Terms · Support
```

- Bilingual (zh-CN + en); language switcher in nav.
- All copy lives in `pages/marketing/content/{zh-CN,en}/*.mdx`.

### `carbonbook.app/pricing`

```
[plan cards]
  Trial (14 days, free)
    • Full features
    • Email only
    [Start trial] → /signup-trial

  Base ($300-$800 / year / user)
    • Inventory + Questionnaires + ISO 14064-1 report
    • EF library quarterly updates
    • 1 active device
    [Buy now] → Stripe Checkout

  CBAM Add-on (v1.1 — coming soon)
    • CBAM methodology + XML output
    • $2,000-5,000 / year
    [Notify me]

[FAQ accordion]
  - Why local-only? → privacy answer
  - Where does my data go? → "Nowhere. Only license & update checks talk to the cloud."
  - Refund policy → 30 days, automatic
  - Renewal grace period → 30 days
  - Multi-device → contact us, +$50/year per additional device
```

The `[Buy now]` button calls a Worker route that creates a Stripe
Checkout Session with `metadata: { plan: 'base@<period>', tier: 'base' }`
and redirects to it. On checkout success, Stripe redirects back to
`activate.carbonbook.app?session_id=...` so we have a single landing
target whether the user came via Stripe or via email.

### `carbonbook.app/download`

Direct links to the latest signed `.dmg` / `.exe`, served from R2.
JS-based platform detection pre-selects the right button.

### `activate.carbonbook.app/`

A single-purpose page the user lands on after either:
- completing Stripe Checkout (`?session_id=...` query param), or
- clicking the activation link in their welcome email (`?key=...`).

```
[heading]
  "Your license is ready"

[license_key card]
  cbk-XXXXX-XXXXX-XXXXX-XXXXX
  [Copy]

[instructions, numbered]
  1. Open carbonbook on your computer.
  2. Click your avatar → Settings.
  3. Paste this key into the "Activate a license" field.

[helper]
  Don't have carbonbook installed yet?  [Download for macOS] [Download for Windows]

[support footer]
```

Edge function behaviour:
- `?session_id=...` → call Stripe to look up the session, derive
  `license_key`, render the page.
- `?key=...` → render directly (no lookup needed).
- Either missing → render an empty-state with a CTA to check the email.

No login required. The license_key alone is sufficient to activate; the
user_id is bound on first activation.

### `account.carbonbook.app/`

Authenticated portal. Magic-link login (no password).

#### `/login`

```
[input] email
[button] Send login link
```

Submitting hits a Worker that generates a 15-minute single-use token,
emails a `https://account.carbonbook.app/login/callback?t=...` URL, and
returns "check your email". The callback exchanges the token for a
session cookie (30 days, HttpOnly, SameSite=Lax) signed with the
session-Ed25519 key (distinct from the license-Ed25519 key).

#### `/`  (post-login dashboard)

```
[my plan]
  base@2026-q2  ·  expires 2027-05-21  (in 365 days)
  [Renew]  [Switch to annual]  [Cancel]

[my devices]
  ┌──────────────────────────────────────────┐
  │ ▸ MacBook Pro 16"      (this device)     │
  │   App 0.4.1 · macOS 26 · Last seen now    │
  │   [Deactivate]                            │
  ├──────────────────────────────────────────┤
  │ ▸ iMac 24"             (last seen 3w ago) │
  │   [Deactivate]                            │
  └──────────────────────────────────────────┘
  Slots used: 2 / 1   ← need to free a slot to activate again

[invoices]
  Last 12 months, downloadable PDFs from Stripe.

[danger zone]
  Cancel subscription · Delete account
```

Renew / Switch / Cancel buttons redirect to **Stripe Customer Portal**
(Stripe-hosted, no work for us). On return the Worker re-syncs from
Stripe via webhook.

Deactivate-device is implemented locally: hits Worker
`POST /v1/devices/{device_id}/deactivate`; the Worker removes the
device_id from `license_active[license_id].device_ids` and from D1
`device`. On the deactivated machine the next `/verify` ping fails
with a `device_revoked` flag (TBD in §sub-project G — we may instead
treat it as a normal revocation).

#### Browser-side telemetry

Nothing tracked beyond standard Cloudflare Analytics (no GA / mixpanel /
ad pixels — main spec §10 explicitly forbids them on the desktop side
and we keep the marketing surface consistent).

## Privacy posture

Privacy policy + ToS live at `carbonbook.app/privacy` and
`carbonbook.app/terms`. The privacy one-liner — already in the main spec
§10 — appears at the bottom of every page:

> "carbonbook-cloud knows you bought a license and which computer it's on. It doesn't know what you calculated, filled, or asked the AI."

The `/privacy` page expands that into a full disclosure table mirroring
main spec §10's "Privacy: carbonbook-cloud 看得到什么" — including the
explicit "Never collected" column.

## Localisation

- All marketing/pricing/account pages bilingual (zh-CN + en).
- Language is detected via `Accept-Language` header on first visit and
  remembered via a `lang` cookie.
- Switcher in the top nav.
- Translated strings live in `pages/<site>/content/<lang>/*.mdx` —
  reviewed during release tagging.

## Style and brand

- Same color tokens as the desktop app — `--color-primary`,
  `--color-destructive`, etc. — exposed via a shared Tailwind config.
- Type: Inter (variable) for Latin, Source Han Sans for CJK.
- No animation library; CSS transitions only for hovers + state changes.
- Dark mode follows OS preference.

## Implementation order (for sub-project G)

1. `pages/marketing` scaffolded with Astro + Tailwind + the shared design tokens.
2. Pricing page wired to a Worker route that creates Stripe sessions.
3. `pages/activate` — simplest of the three; ships next.
4. `pages/account` magic-link auth + devices list (no Stripe portal yet — just renders the data).
5. Stripe Customer Portal links + webhook handling.
6. Localisation pass.
7. Privacy / ToS / FAQ copy review.

## Open questions (deferred to sub-project G)

- **Domain registration**: assume we own `carbonbook.app` already; if not, allow ~24-72h for DNS propagation in the launch plan.
- **Email sender domain**: `noreply@carbonbook.app` requires SPF + DKIM setup (~30 min) in Cloudflare DNS.
- **CBAM "Notify me" target**: is this a Convertkit/Resend signup form or just an email link? Decide alongside marketing strategy.

## Self-review

- [x] Three pages explicitly scoped; each has user-flow + key copy + integration points.
- [x] No placeholder content in normative sections; open-questions section is intentionally tentative.
- [x] Aligns with main spec §10 (privacy) + cloud spec (license_key format, Stripe webhook contract).
- [x] No client-side telemetry / cookies beyond strictly-required session cookie.
