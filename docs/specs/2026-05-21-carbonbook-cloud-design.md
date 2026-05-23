# carbonbook-cloud — design spec

- **Created**: 2026-05-21
- **Status**: Design (Phase 4 sub-project E). Implementation = sub-project G; out of scope here.
- **Goal**: Specify the cloud layer that issues license JWTs, processes Stripe webhooks, ships update binaries, and answers `/verify` pings. Everything sized to fit Cloudflare's free tier for v1.

## Scope and non-goals

**In scope** (what carbonbook-cloud does):

- License JWT issuance (Ed25519, EdDSA)
- Revocation list (a single KV key set; clients consult on `/verify`)
- Stripe Checkout → license auto-issue webhook
- Trial signup (email-only; no payment)
- Auto-update channel for signed `.dmg` / `.exe` artefacts
- Customer self-serve account portal (renew + list active devices)

**Explicitly NOT in scope**:

- Any storage of customer inventory, activity_data, questionnaires,
  reports, or AI prompts/responses (single-machine privacy is the
  product promise — see main spec §10 "Privacy table")
- Customer telemetry beyond device_id + app version + OS + country
- A web app that lets customers do real work (the desktop app is the work)
- Linux distribution (not in v1 roadmap)

## Hosting platform: Cloudflare

| Component | Cloudflare primitive | Reason |
|---|---|---|
| API endpoints (`/activate`, `/verify`, `/stripe-webhook`, `/trial-signup`) | **Workers** | Cold start ≤ 5 ms, free tier 100k req/day; v1 traffic stays comfortably under this. |
| License + revocation storage | **KV (Workers KV)** | Eventually consistent reads (≤ 60 s), write throughput sufficient for issuance rate (~10/min peak), value size ≤ 25 MB (we store ≤ 1 KB per record). |
| Customer + activity-log storage | **D1** (SQLite at edge) | Need actual SQL queries (list devices for a user; aggregate signups; etc.). 5 GB free; D1 reads are eventually consistent across regions but that's fine for our workload. |
| Binaries (.dmg / .exe / update manifests) | **R2** | S3-compat; no egress fees; cheaper than R2 alternatives at our expected volume. |
| Static pages (pricing, activate, account, FAQ) | **Pages** | Wired to GitHub repo; zero config; bundles edge functions if we need them. |
| TLS / DNS | Cloudflare default | Single-vendor lock-in is acceptable for v1 — migration plan documented in §8. |

A single `wrangler.toml`-managed Worker hosts every API endpoint; routes
are dispatched by `URL.pathname`. We avoid microservices because the
total code is < 1000 LoC and one-worker is easier to reason about.

## Data model

### KV namespace: `license_active`

- **Key**: `license_id` (e.g. `lic_01H...`)
- **Value (JSON)**: the most recent JWT body claims, plus `device_ids: string[]`
- **Use**: `/verify` reads to confirm the license isn't revoked; `/activate` reads+updates
- **TTL**: never expire (we want a permanent revocation history)

```json
{
  "license_id": "lic_01H...",
  "user_id": "usr_01H...",
  "plan": "base@2026-q2",
  "features": ["inventory", "questionnaire", "iso14064"],
  "devices_max": 1,
  "device_ids": ["dev_01H...", "dev_01H..."],
  "issued_at": 1746700000,
  "expires_at": 1778236000,
  "grace_until": 1780828000,
  "revoked": false,
  "revoked_at": null,
  "revoked_reason": null,
  "stripe_subscription_id": "sub_..." 
}
```

### KV namespace: `revocation_set`

- **Key**: literal `'list'`
- **Value (JSON)**: `{ license_ids: string[], updated_at: number }`
- **Use**: `/verify` consults this single key to confirm a license isn't on the revoke list
- **Why a separate key set**: the client is allowed to cache `/verify` results for 7 days (`revocation_check_after`). A small, single-fetch list amortises better than per-license reads in the client.

### D1 schema: `cloud.sqlite`

Tables (full DDL maintained in `cloud/migrations/`):

```sql
CREATE TABLE customer (
  user_id      TEXT PRIMARY KEY,            -- 'usr_01H...'
  email        TEXT NOT NULL UNIQUE,
  country      TEXT,                        -- from IP at signup
  created_at   INTEGER NOT NULL,
  stripe_customer_id TEXT
);

CREATE TABLE license (
  license_id   TEXT PRIMARY KEY,            -- 'lic_01H...'
  user_id      TEXT NOT NULL REFERENCES customer(user_id),
  plan         TEXT NOT NULL,
  features     TEXT NOT NULL,               -- JSON-encoded array
  devices_max  INTEGER NOT NULL,
  issued_at    INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  grace_until  INTEGER NOT NULL,
  stripe_subscription_id TEXT,
  revoked      INTEGER NOT NULL DEFAULT 0,
  revoked_at   INTEGER,
  revoked_reason TEXT
);

CREATE TABLE device (
  device_id    TEXT NOT NULL,
  license_id   TEXT NOT NULL REFERENCES license(license_id),
  first_seen_at INTEGER NOT NULL,
  last_ping_at  INTEGER NOT NULL,
  app_version  TEXT,
  os           TEXT,
  PRIMARY KEY (device_id, license_id)
);
```

KV is the hot path (every `/verify` reads from it); D1 is the source of
truth for joinable queries (account portal: "list my devices",
"who used what version this month"). They drift apart by < 60 s in
the worst case (KV eventual consistency); the drift is acceptable
because the client treats `/verify` failures as soft errors (counts as
an offline day, doesn't kick into read-only until 30 days accumulate).

## Signing key

- **Algorithm**: Ed25519. JWT header is fixed `{ "alg": "EdDSA", "typ": "JWT" }`.
- **Generation**: produced once during cloud setup. Private key stored in
  **Cloudflare Worker Secrets** (`LICENSE_PRIVATE_KEY_PEM`); never appears
  in code, logs, or D1. Rotated only via the rotation procedure below.
- **Public key**: 32 raw bytes hex-encoded and committed to the client repo at
  `src/main/services/license-public-key.ts` (the existing
  `DEV_PUBLIC_KEY_HEX` constant); replaced by the prod key bytes in the
  release build.
- **Rotation**: requires a coordinated client release.
  1. Generate new keypair offline.
  2. Update client build to embed `LICENSE_PUBLIC_KEY_HEX_NEXT` alongside the
     current one — the verifier tries each public key.
  3. Cut the client release; wait until install base ≥ 95 % on the new
     binary (a few weeks).
  4. Flip the cloud to sign with the new private key.
  5. Cut a second client release that drops the old `…HEX` constant.
  Rotation cadence: only on suspected compromise. The algorithm itself
  doesn't time out.

## REST endpoints

All paths are routed by `URL.pathname` on the single Worker. Request +
response shapes are zod-validated server-side (mirroring the client
patterns).

### POST `/v1/activate`

Activate a license on a fresh device. Called by the client's eventual
sub-project-G activation HTTP wrapper (the existing renderer
`licenseApi.setJwt` will pre-call this and only `setJwt` the response).

**Request body**:

```json
{
  "license_key": "lic_01H...XXXXXX",   // visible "humanized" key
  "device_id": "dev_01H...",
  "app_version": "0.4.0",
  "os": "darwin"
}
```

**Response — success**:

```json
{
  "jwt": "eyJ...long.signed.token",
  "claims": {
    "iss": "carbonbook.app",
    "license_id": "lic_01H...",
    "user_id": "usr_01H...",
    "plan": "base@2026-q2",
    "features": ["inventory","questionnaire","iso14064"],
    "devices_max": 1,
    "issued_at": 1746700000,
    "expires_at": 1778236000,
    "grace_until": 1780828000,
    "revocation_check_after": 1747304800
  }
}
```

**Response — failure** (HTTP 4xx):

```json
{ "error": { "_tag": "DeviceCapReached" | "RevokedLicense" | "UnknownKey" | "RateLimited", "message": "..." } }
```

**Flow**:
1. Look up the license by `license_key` (humanized key → `license_id` via
   a one-way mapping table — see §humanized keys below).
2. If license not found → `UnknownKey`.
3. If license is revoked → `RevokedLicense`.
4. If `device_ids.length >= devices_max` AND `device_id` not already in
   the list → `DeviceCapReached`. The user can free a slot via the
   account portal.
5. Append device_id (idempotent) + record activation in D1.
6. Sign a fresh JWT with `revocation_check_after = now + 7 days` and
   return it.

**Rate limiting**: 10 req / minute per `license_key`. Implemented via a KV
counter with a 60-second TTL.

### POST `/v1/verify`

Background ping the client makes when `now >= revocation_check_after`.
Returns either the same JWT (signed afresh, with a bumped check time) or
a `revoked` payload.

**Request body**:

```json
{
  "license_id": "lic_01H...",
  "device_id": "dev_01H...",
  "app_version": "0.4.0",
  "os": "darwin"
}
```

**Response — still valid**:

```json
{ "jwt": "eyJ...", "claims": { ... }, "revoked": false }
```

**Response — revoked**:

```json
{ "revoked": true, "reason": "refund_30day | manual_admin | other" }
```

**Flow**:
1. Read `license_active[license_id]` from KV.
2. If revoked → return `{ revoked: true }`.
3. If license expired *cloud-side* (admin let it expire without renewal)
   → return current claims unchanged; client decides what to do.
4. Otherwise sign a fresh JWT with same claims +
   `revocation_check_after = now + 7 days` + reset the client's
   `consecutiveOfflineDays` (the client resets locally on a successful
   ping; cloud doesn't track this).
5. Update D1 `device.last_ping_at`.

### POST `/v1/trial-signup`

Trial sign-up (no payment). Returns the JWT immediately + emails it.

**Request body**:

```json
{ "email": "...", "country_hint": "CN", "device_id": "dev_01H...", "app_version": "0.4.0" }
```

**Response — success**:

```json
{ "license_key": "lic_01H...trial", "jwt": "eyJ..." }
```

**Flow**:
1. Validate email (Cloudflare Workers' standard regex; no MX lookup).
2. If `email` already has a trial license → return existing one
   (idempotent — refresh expires_at if more than 7 days have elapsed
   since signup).
3. Generate `customer` row, `license` row with `plan='trial@14d'`,
   `expires_at = now + 14d`, `grace_until = now + 44d`,
   `devices_max = 1`.
4. Sign JWT, persist to KV, return.
5. Side-effect: send signup email via the SendGrid / Resend integration
   (best-effort; not retry-critical because the JWT is already in the
   response).

**Anti-abuse**: 1 trial per email forever (handled by the idempotency in
step 2). 5 trials per IP per day (KV counter, 24-hour TTL).

### POST `/v1/stripe-webhook`

Stripe sends events here when a Checkout session completes, a
subscription renews, or a refund happens.

Events handled (subset of Stripe's full set):

| Event | Action |
|---|---|
| `checkout.session.completed` | If the metadata has `plan` set, mint a fresh license, store it, email JWT to the customer. |
| `invoice.payment_succeeded` | Bump the matching license's `expires_at` + `grace_until` by 1 year, re-sign + re-publish JWT to KV. Client picks it up on next ping. |
| `customer.subscription.deleted` | Mark license as `revoked` after the 30-day refund window (event-time + 30d → schedule). Until then leave it active. |
| `charge.refunded` | Schedule revocation as above. |

Stripe signature verification: standard HMAC-SHA256 against the
`STRIPE_WEBHOOK_SECRET` (Worker secret), rejecting on mismatch.

### GET `/v1/updates/{channel}/manifest.json`

`electron-updater` polls this. The response is a `latest.yml`-style
manifest pointing at the signed binary in R2.

```yaml
version: 0.5.0
files:
  - url: https://r2.carbonbook.app/releases/darwin-arm64/0.5.0/carbonbook-0.5.0-arm64.dmg
    sha512: "..."
    size: 84629184
releaseDate: '2026-06-01T00:00:00Z'
```

Channels: `stable` (default), `beta` (opt-in via Settings).

R2 hosts the actual binaries; signing is done at the build pipeline
(Apple Developer ID notarization for `.dmg`, Windows EV cert for `.exe`)
— see Phase 4 sub-project I.

## Humanized license keys

The `license_id` in the JWT (`lic_01H...`) is a ULID — efficient to
look up, not human-friendly. The visible "license key" the user pastes
into the activation form is a different, shorter humanized variant:

- Format: `cbk-{base32-Crockford}-{base32-Crockford}-{base32-Crockford}-{base32-Crockford}` (4 groups of 5 chars, 24 chars total with dashes)
- One-way KV mapping: `humanized_key[humanized] -> license_id`
- The humanized key is generated alongside the license + sent via email
- ULIDs stay internal; humans get the shorter key

This separation makes leaked logs safer (a `license_id` in a server log
doesn't on its own activate anything — you'd need the humanized key) and
keeps the paste-target short enough to type if needed.

## Account portal (`carbonbook.app/account`)

- **Pages**: Login (magic-link email), My Plan, Devices, Billing (Stripe Customer Portal redirect), Invoices, Cancel.
- **Auth**: short-lived session cookie issued on magic-link click; backed
  by a JWT signed with a separate session key (not the license key).
- **Operations**:
  - List my licenses + active devices
  - Deactivate a device (frees a slot under `devices_max`)
  - Trigger a re-send of the activation email (paste-JWT)
  - Renew via Stripe Customer Portal
  - Switch to annual billing

The portal is a Cloudflare Worker (SSR Astro via `@astrojs/cloudflare`),
mounted at `carbonbook.app/account` via Workers Routes. It re-uses the
API worker (mounted at `/api/*` on the same domain) for license/device
queries — same-origin, so the session cookie flows automatically.

## Operational concerns

**Backup**: D1 has automatic point-in-time backups (Cloudflare-managed).
KV is treated as a cache rebuildable from D1 (a maintenance job can
reconstruct `license_active` from `license` table rows).

**Monitoring**: Cloudflare Analytics for HTTP-level metrics; we also log
every `/activate` / `/verify` / Stripe event to Workers Logpush →
R2 (cold storage, 90-day retention). No PII in logs beyond user_id and
device_id.

**Rate limiting**: per-endpoint KV counters. `/activate` 10/min per
license_key, `/verify` 6/min per device_id (the client only ever calls
once every 7 days at steady state — 6/min is generous for the activation
debug case), `/trial-signup` 5/day per IP.

**Cost projection** (year-1):
- Workers: free tier (100k req/day = ~3M/month; we expect ≤ 200k/month).
- KV: free tier (100k reads/day) sufficient through ~500 customers.
- D1: free tier (5 GB) sufficient through ~10k customers.
- R2: storage cost only (no egress fees); ~$0.015/GB-month — 5 GB of
  binaries across stable+beta = ~$0.07/month.
- Pages: free.
- Total expected cost year-1: < $5/month + Stripe transaction fees.

## Migration plan if we outgrow Cloudflare

If we hit free-tier limits or want multi-region D1 replicas:
1. Move D1 → managed Postgres (Supabase / Neon). Worker keeps using D1
   syntax via an HTTP-Postgres compatibility shim during transition.
2. Move R2 → S3 (no egress changes our pricing materially; S3 is the
   safer long-term host).
3. Worker stays — Cloudflare's runtime is what gives us the < 5 ms
   cold-start at the global edge.

## Open questions (deferred to sub-project G implementation)

- **Magic-link email provider**: SendGrid vs. Resend. Pick during impl.
- **Stripe China connector**: if approved in time we surface RMB pricing
  at activation; if not, USD only for v1.
- **Trial → paid conversion incentive**: in-app banner during the last
  3 days of trial? CTA from the trial-expired banner to a Stripe
  Checkout link? Decide during sub-project G.

## Self-review

- [x] Spec covers each surface listed in Phase 4 §10: activation, verify,
      Stripe, trial, auto-update, account.
- [x] No placeholders / TBDs in normative sections (open-questions
      section is intentionally tentative).
- [x] Aligns with main design spec §10 — same JWT shape, same state
      transitions, same privacy commitments.
- [x] Cost projection sized vs. real free-tier limits.
- [x] Migration plan exists for the lock-in we accept.
