# Phase 5 — Public Launch readiness checklist

> Phase 5 is overwhelmingly external-coordination work (sign-up flows,
> marketing, post-launch ops). This document is a checklist for the
> human operator running launch, not an agent execution plan.

**Prerequisite**: Phase 4 must be 100% complete. As of this writing
(2026-05-21), sub-projects A/B/C/D/E/F are shipped; G/H/I are blocked on
external procurement (Cloudflare, Stripe, Apple Developer, Windows EV).
Don't start Phase 5 until G/H/I are done.

## T-minus-30 days (before publishing)

- [ ] **Domains live**:
  - [ ] `carbonbook.app` registered + Cloudflare nameservers + TLS
  - [ ] `account.carbonbook.app` CNAME → Pages project
  - [ ] `activate.carbonbook.app` CNAME → Pages project
  - [ ] `noreply@carbonbook.app` SPF + DKIM + DMARC set up; bounce
    rate verified < 1 % on test sends
- [ ] **Stripe live mode**:
  - [ ] Test products migrated to live mode
  - [ ] Webhook endpoint registered + live mode signing secret in
    Worker Secrets
  - [ ] Refund window (30 days, automatic) configured in Customer Portal
- [ ] **Production signing key**:
  - [ ] Real Ed25519 keypair generated offline
  - [ ] Private key in Worker Secrets (`LICENSE_PRIVATE_KEY_PEM`)
  - [ ] Public key bytes substituted into
    `src/main/services/license-public-key.ts` for the launch release build
  - [ ] All-zero placeholder guard verified at `pnpm build` time
- [ ] **Signed binaries**:
  - [ ] Apple Developer ID notarization working on the `.dmg` build
  - [ ] Windows EV cert installed on the build machine + `.exe` signed
  - [ ] `electron-updater` manifest URLs point at the prod R2 bucket
- [ ] **Smoke run**:
  - [ ] End-to-end activation (buy → email → paste → app activates)
  - [ ] Trial signup (form → email → paste → app activates → expires correctly)
  - [ ] Renewal (Stripe Customer Portal → webhook → JWT refreshed on next ping)
  - [ ] Refund (Stripe refund → 30-day delay → revocation reflected on ping)
  - [ ] Read-only gate triggers correctly after grace period expires
  - [ ] Auto-update downloads + applies a follow-on build

## T-minus-7 days (final-week tasks)

- [ ] **Docs site**:
  - [ ] `docs.carbonbook.app` (or `carbonbook.app/docs`) live
  - [ ] User manual (zh + en) covering: install, onboarding, upload, review extractions, generate report, export, change EF, audit log
  - [ ] FAQ aggregated from beta feedback
  - [ ] At least 1 video demo (2-3 min, no audio commentary required for v1)
- [ ] **Support intake**:
  - [ ] `support@carbonbook.app` mailbox routes to a real human
  - [ ] First-response SLA documented internally (≤ 24h business days)
- [ ] **Backup / DR rehearsal**:
  - [ ] D1 backup restored to a scratch instance and queried
  - [ ] R2 binaries verified hash-by-hash against the build artefacts
- [ ] **Privacy + Terms**:
  - [ ] Privacy policy reviewed by counsel (or at minimum by a lawyer
    friend) — focus on the "we collect almost nothing" claim being
    technically accurate
  - [ ] Terms of Service: subscription terms + refund policy + governing
    law (suggest: Hong Kong for ease of cross-border ESG SaaS) + dispute
    resolution

## T-minus-1 day

- [ ] **Tag the launch build**:
  - [ ] `v1.0.0` git tag on `main`
  - [ ] Release notes summarising changes since the closed-beta tag
  - [ ] Build artefacts uploaded to R2 under `releases/{platform}/1.0.0/`
- [ ] **Pre-warm content**:
  - [ ] Product Hunt draft submitted (live next morning)
  - [ ] HN "Show HN" draft ready (live mid-morning)
  - [ ] X / Twitter announcement thread queued
  - [ ] LinkedIn post drafted
  - [ ] WeChat / 出口企业群 reaches identified + ready to drop links
- [ ] **Pricing display sanity check**:
  - [ ] USD prices match Stripe
  - [ ] CN-region RMB display (if Stripe China connector approved) matches CNY ledger
  - [ ] "Free trial" CTA on hero + on /pricing both go to `/v1/trial-signup`

## Launch day

- [ ] **00:00 local-time**: switch download buttons from "Join beta" to live binaries
- [ ] **08:00**: Product Hunt + Twitter thread go live
- [ ] **10:00**: HN "Show HN" submission
- [ ] **14:00**: WeChat / domestic channel posts
- [ ] **All day**: monitor Workers logs + Stripe dashboard + support inbox
- [ ] **End of day**: retro — note any P0/P1 bugs and patch overnight

**Success criteria (per main spec)**: 50+ unique landing-page visitors,
5-10 paid licenses sold in week 1, all P0 bugs patched within 48h.

## Week 1 follow-up

- [ ] Hotfix cadence: 1 release per day for the first 3 days if needed; daily check-in until 5 days bug-free
- [ ] Customer-success outreach: email every paid customer in their preferred language within 48h of activation
- [ ] Telemetry opt-in: if any user has opted into anonymous usage telemetry, review the first week's data for unexpected feature-usage gaps

## Month 1 retro

- [ ] Aggregate: trial → paid conversion %, time-from-install-to-first-report, top 3 support tickets
- [ ] Write the v1.1 priority list (CBAM, OAuth login, RMB pricing,
  team / multi-device, etc.) into `docs/plans/<date>-v1.1-backlog.md`

## When something goes wrong

| Symptom | Likely cause | Action |
|---|---|---|
| `/activate` 5xx | Worker exception; check Logpush. | Roll back the Worker to last known good; hotfix if needed. |
| Stripe webhook signature fails | Wrong env signing secret. | Re-paste the live-mode secret into Worker Secrets. |
| Customer reports "expired but I just renewed" | KV propagation lag. | Tell them to wait 60s + re-trigger /verify (or restart the app). |
| Customer reports JWT not accepted | Possible key mismatch (still on dev key in their build) | Confirm their version is ≥ launch build; cut a hotfix if any pre-launch build leaked. |
| Surge in `/v1/trial-signup` | Possible abuse | Tighten rate limit: 1/day per IP; review Cloudflare bot-fight settings. |

## Stop conditions

Stop the launch if:

- License JWT verification breaks for > 1 % of activations (suggests a
  key-mismatch leak).
- Stripe accepts payment but `/v1/stripe-webhook` fails to mint a license
  (customer paid but doesn't get the product — this is the worst possible
  failure mode and warrants an immediate roll-back).
- Refund rate exceeds 20 % in the first 48 hours (product-market signal
  to step back).
