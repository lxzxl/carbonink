# Phase 4 — Cloud + License + 签名 (work in progress)

## Sub-project A — License Client Core (shipped)

Local-only half of the carbonbook license system, per design spec §10.
Cloud-side issuance / `/activate` / `/verify` deferred to sub-project G.

**Shipped:**

- **Migration 016** — `license_local_state` single-row table caching
  device_id, last_verified_at, consecutive_offline_days, last_known_state.
- **`LicenseStateMachine`** — pure function over (claims, now,
  lastVerifiedAt, consecutiveOfflineDays, revoked) → one of
  `'unverified' | 'active' | 'grace' | 'expired' | 'revoked'`. Boundary
  `now === expires_at` is treated as `grace` (strict `<` for active).
- **`LicenseService`** — Ed25519 signature verification via `node:crypto`,
  hand-rolled JWT base64url decode (no `jose` dep), zod-validated claims,
  OS Keychain storage via the existing `CredentialStore`, and DB-side
  metadata maintenance. Exposes `getState`, `setJwt`, `clearJwt`.
- **IPC surface** — `license:get-state`, `license:set-jwt`,
  `license:clear`. Set returns a discriminated `_tag` union
  (`BadSignature` / `Malformed` / `BadSchema`) so the UI can branch on
  failure mode without parsing error strings.
- **Bridge allowlist** — extended for the three new channels.
- **Renderer wrapper** — `src/renderer/lib/api/license.ts` ready for the
  Settings page License section (sub-project B).
- **Dev tooling** — `scripts/issue-dev-license.mjs` mints local JWTs
  signed by the dev keypair at `scripts/dev/license-keypair/`. Public
  key bytes are embedded in `src/main/services/license-public-key.ts`
  with an all-zero placeholder guard that throws at boot if a release
  forgot to swap in the production key.

**Tests:** 25 added across 4 files. 635/635 vitest passing, typecheck +
biome clean.

## Sub-project B — License UI (shipped)

Renderer-side surface for sub-project A's IPC channels.

**Shipped:**

- **`LicenseSection`** (`src/renderer/components/LicenseSection.tsx`) —
  added to the bottom of `/settings`. Renders a state chip + the JWT
  claims (plan, features, expiry, device_id, last verified) when active,
  otherwise renders the paste-JWT activation form. Activation errors
  branch per tagged result (`BadSignature` / `Malformed` / `BadSchema`)
  with localized messages. Deactivation behind `window.confirm`.
- **`LicenseBanner`** (`src/renderer/components/LicenseBanner.tsx`) —
  top-of-app banner mounted in `__root.tsx`. Renders only on `grace`,
  `expired`, `revoked`; nothing on `active`/`unverified`. Includes a
  "Open License settings" link. Polls `license:get-state` every 60 s so
  state transitions surface within a minute without a manual refresh.
- **i18n** — 30 new keys across en + zh-CN.
- **__root layout** — restructured to `flex-col` so the banner spans the
  full window width above the sidebar+main flex.

**Tests:** 9 component tests (4 LicenseSection + 5 LicenseBanner).
653/653 vitest, typecheck + biome clean.

Cloud-side issuance is sub-project G; until then a developer mints a
local dev JWT with `node scripts/issue-dev-license.mjs` and pastes it
into the new activation form.

## Sub-project C — Read-only mode gate (shipped)

License-state-driven write gate on every IPC write handler. Per design
spec §10's read-only-mode definition.

**Shipped:**

- **`licenseGate(channel, licenseService, fn)`** middleware in
  `src/main/ipc/license-gate.ts`. Wraps every IPC handler. When the
  channel is in the curated `READ_ONLY_BLOCKED_CHANNELS` set AND
  `licenseService.getState().state` is `expired` or `revoked`, throws
  `LicenseReadOnlyError` before the handler runs. Fast-paths channels
  not in the blocked set (no `getState()` call) so list/get queries pay
  zero gate cost.
- **`LicenseReadOnlyError`** — tagged error class carrying
  `{ state: 'expired' | 'revoked', _tag: 'LicenseReadOnlyError' }`.
  Added to `sanitize.ts`'s passthrough whitelist so the renderer sees
  the structured message instead of an opaque correlation id.
- **Setup wiring** — `setup.ts` composes `sanitize(channel,
  licenseGate(channel, ctx.licenseService, handler))` for every
  registered handler. License gate runs first so the tagged error
  flows out cleanly.
- **Coverage** — 26 channels gated, including all `activity:*` /
  `extraction:*` / `report:generate` / `answer:*` / `questionnaire:*`
  write paths and `ef:recommend`. Settings + exports + reads stay
  open.

**Tests:** 9 new gate tests covering each state, the blocked set
membership, and the never-blocked fast-path. 644/644 vitest, typecheck +
biome clean.

UI surface (banner + "renew now" CTA) is sub-project B.

## Sub-project D — Trial flow (no client-side work needed)

The local 14-day trial is structurally indistinguishable from a base
license — only the `plan` value (`'trial@14d'`) and a shorter
`expires_at` differ. The state machine in sub-project A treats them
identically: same `active` → `grace` → `expired` progression, same gate
behaviour from sub-project C.

The remaining trial-flow work is **cloud-side issuance** (signup form
collecting email, mint trial JWT, email it to the user), which belongs
to sub-project G. The client already accepts whatever signed JWT the
cloud emits, including trial ones.

A "Start free trial" CTA in the activation form (vs. "Activate a
license") is a polish item rolled into sub-project G's UI changes when
the trial signup endpoint goes live.

## Sub-project E — carbonbook-cloud spec (shipped)

Design document at `docs/specs/2026-05-21-carbonbook-cloud-design.md`.

Highlights:

- Cloudflare Workers (one worker, path-dispatched) + KV (`license_active`
  + `revocation_set`) + D1 (customer/license/device tables) + R2
  (binaries) + Pages (static + account portal).
- REST endpoints: `POST /v1/activate`, `POST /v1/verify`, `POST
  /v1/trial-signup`, `POST /v1/stripe-webhook`, `GET
  /v1/updates/{channel}/manifest.json`.
- Ed25519 signing key in Worker Secrets; public-key rotation procedure
  documented (requires coordinated client release, only on suspected
  compromise).
- Humanized license keys (`cbk-XXXX-XXXX-XXXX-XXXX`) separate from
  internal `lic_01H...` ULIDs so leaked logs aren't directly
  weaponisable.
- Cost projection: < $5/month year-1 (Cloudflare free tier covers all
  primary use cases at our expected ≤ 200k req/month).

Implementation = sub-project G.

## Sub-project F — Landing page spec (shipped)

Design document at `docs/specs/2026-05-21-carbonbook-landing-pages-design.md`.

Covers `carbonbook.app` (marketing + pricing + download), 
`activate.carbonbook.app` (post-checkout activation helper), and
`account.carbonbook.app` (magic-link auth + my-plan + devices list +
Stripe Customer Portal handoff). Astro 5 + Tailwind, bilingual,
privacy posture aligned with main spec §10.

Implementation = sub-project G.

## Sub-projects G, H, I — External dependencies (deferred)

- **G** — carbonbook-cloud implementation (requires Cloudflare account)
- **H** — Stripe Checkout (requires Stripe account + webhook URL)
- **I** — Apple Developer ID + Windows EV code signing (cert purchase + 1-4 week審批)
