# CarbonInk → free & open-source (MIT) — spec

**Date:** 2026-06-01 · **Status:** approved decisions, pre-implementation

## Goal

Turn CarbonInk into a fully **free, open-source (MIT)** product. Remove the
licensing/activation system from the desktop app, decommission the cloud
license + payments API, and strip all pricing / charging / activation copy from
the website — reframing it as free & open-source.

## Decisions (locked with the user)

| # | Decision |
|---|---|
| Desktop | **Full removal** of license code + UI (not just ungating). |
| Cloud `worker` | **Decommission** — stop deploying; code stays in-repo, marked deprecated. |
| License | **MIT** — `LICENSE` file at repo root. |
| Process | **Spec + plan first** (this doc + the plan), then implement on approval. |

## Current state (the surface, condensed)

- **Desktop** — no paid/free feature split exists. All write-gating is one set,
  `READ_ONLY_BLOCKED_CHANNELS` in `src/main/ipc/license-gate.ts` (34 channels).
  Plus license services (`license-service.ts`, `license-state-machine.ts`,
  `license-public-key.ts`), IPC (`ipc/handlers/license.ts`, `renderer/lib/api/license.ts`),
  UI (`LicenseSection.tsx`, `LicenseBanner.tsx`, `LicenseChip.tsx`), migration
  `016_license_local_state.sql`, and an activation network call to
  `${API_BASE}/v1/activate`.
- **Cloud `worker`** — a license + Stripe + account API: `/v1/activate`,
  `/verify`, `/trial-signup`, `/license-request`, `/checkout-session`,
  `/stripe-webhook`, billing-portal, magic-link auth, `/account/*`, admin issue,
  a daily revocation cron, D1 tables + KV. Its only consumers are the desktop
  (being de-licensed) and the website account/admin pages (being deleted).
- **Cloud `web`** — pricing pages (`/pricing`, `/zh/pricing`), components
  (`PricingPlans`, `PricingTeaser`, `PricingFaq`, `LicenseKeyCard`), `/activate`,
  `/account/*`, `/admin/*`, account/admin middleware; Hero/Nav/Footer carry
  pricing links; privacy page mentions Stripe/billing. **`/download` is already
  free** (redirects to the GitHub release). No "open source" framing today.

## Design

### A. Desktop — remove licensing entirely

- **Delete files:** `license-gate.ts`, `license-service.ts`,
  `license-state-machine.ts`, `license-public-key.ts`, `ipc/handlers/license.ts`,
  `renderer/lib/api/license.ts`, `components/.../LicenseSection.tsx`,
  `LicenseBanner.tsx`, `LicenseChip.tsx`, and their tests.
- **Unwire:** the license-gate from the IPC dispatch pipeline (`ipc/setup.ts` /
  `context.ts`); `<LicenseBanner/>` from `__root.tsx`; the License section from
  the Settings page; `<LicenseChip/>` from the header.
- **IPC surface:** drop `license:*` from `ipc/types.ts` + the preload
  `allowedChannels`; update the parse-driven allowlist test.
- **i18n:** remove `license_*` / activation keys from **both** message files
  (keep them aligned).
- **Migration:** delete `016_license_local_state.sql` so fresh DBs never create
  the table (consistent with the "discard old data + reset dev DB" approach
  already in use). Nothing references the table after the code removal.
- **Env / network:** remove `API_BASE` + the activation fetch. The app no longer
  phones home.
- **Net effect:** every IPC channel works unconditionally; no license state, no
  banners, no activation, no network dependency.

### B. Cloud `worker` — decommission

- Stop deploying it (remove from any deploy script / CI) and **remove its
  `/api/*` route registration** so the path stops resolving.
- Add a `DEPRECATED` note to `cloud/worker/README` explaining it's retired with
  the open-source pivot; **keep the code in-repo** for history.
- Cloudflare-dashboard ops (delete the Worker, rotate/remove Stripe + license
  signing secrets, drop the D1/KV) are **manual, out of code scope** — listed as
  follow-ups.

### C. Website — strip pricing/activation, reframe as free + OSS

- **Delete pages:** `pricing` (×2), `activate` (×2), `account/*` (×2 incl.
  `login` + `login/callback`), `admin/*`.
- **Delete components:** `PricingPlans`, `PricingTeaser`, `PricingFaq`,
  `LicenseKeyCard`. Delete the account/admin **middleware**.
- **Edit (copy/links):** Hero (replace the "See pricing" CTA with a
  GitHub/source link), Nav + Footer (drop the Pricing link, add a Source/GitHub
  link), `index.astro` + `zh/index.astro` (drop `<PricingTeaser/>`),
  `privacy.astro` (remove Stripe/billing/license-key mentions → local-only +
  open-source framing), `DownloadButtons` (drop "free trial" → "free & open
  source"). Update `astro.config` sitemap to drop deleted routes.
- **Add:** an "open source · MIT" line + GitHub repo link (hero/footer).

### D. Repo

- `LICENSE` (MIT) at repo root.
- README (repo + desktop): free, open-source, MIT, build-from-source.
- `docs/ROADMAP.md`: a section recording the pivot.
- `AGENTS.md` non-negotiables: the "audit/organizationId" stays; note the license
  system is removed so future agents don't reference it.

## Risks / assumptions

- **Pre-launch assumption:** no real paying users or field licenses depend on
  `/verify`. If any exist, old desktop builds lose re-verification when the
  worker is decommissioned — mitigated by shipping the de-licensed build. (Verify
  in Task 0.)
- **`/download` independence:** the plan must confirm `/download/mac|win` resolve
  via the **GitHub release**, not the API worker's R2 `RELEASES` bucket, before
  decommissioning. (Verify in Task 0.)
- **No other `/api` consumers:** confirm nothing else (update-check, MCP) calls
  `/api/*`. (Verify in Task 0.)
- **Deleting migration 016** is only safe because dev DBs are reset/discarded
  (pre-launch). Documented in the plan with the reset step.
- **Third-party deps** keep their own licenses; MIT applies to *our* code. A
  follow-up can add a NOTICE / deps-license note if desired.

## Out of scope (follow-ups)

- Making the GitHub repo public + adding `CONTRIBUTING.md`, issue templates, OSS
  CI — a separate hardening pass.
- Manual Cloudflare/Stripe teardown (delete Worker, rotate secrets, drop D1/KV).
- Any in-app "this is open source / star us on GitHub" nudge.

## Verification gate

- Desktop: `pnpm --filter carbonink test` green (license tests removed → new
  lower baseline, recorded in AGENTS.md), `typecheck` + scoped `biome` clean.
- Web: `astro build` succeeds; no internal links point at deleted pages.
- Worker: removed from deploy; any remaining non-license tests still pass.
