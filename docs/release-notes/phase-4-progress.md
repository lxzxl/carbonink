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

## Sub-project B — License UI (not started)

Settings page License section: paste-key activation form, current-state
display, device list, top-of-screen banner for grace / expired / revoked.

## Sub-project C — Read-only mode gate (not started)

License-state-driven write gate on every IPC write handler
(`activity:create`, `extraction:run`, `report:generate`, etc.). Full-screen
overlay in read-only state.

## Sub-project D — Trial flow (not started)

Local logic of 14-day trial JWT. State machine is already in place; this
sub-project mostly wires the cloud-side trial signup form to the existing
`license:set-jwt` channel and adds a "Start free trial" CTA in the
unverified-state UI.

## Sub-project E — carbonbook-cloud spec (not started)

Design document for the Cloudflare Workers + R2 + KV deployment:
`/activate`, `/verify`, `/renew-webhook` endpoints; Stripe webhook
integration; revocation list storage.

## Sub-project F — Landing page spec (not started)

Pricing / activate / account pages (Cloudflare Pages).

## Sub-projects G, H, I — External dependencies (deferred)

- **G** — carbonbook-cloud implementation (requires Cloudflare account)
- **H** — Stripe Checkout (requires Stripe account + webhook URL)
- **I** — Apple Developer ID + Windows EV code signing (cert purchase + 1-4 week審批)
