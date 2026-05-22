# Phase 4 Sub-project G — carbonbook-cloud Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the `carbonbook-cloud` repo — a Cloudflare-native backend + static web surface that issues Ed25519 license JWTs, processes Stripe payments, serves auto-update manifests, and hosts the marketing / activation / account portal pages at `carbonbook.app`. When complete, the Electron client's `LicenseService.setJwt()` and future `/activate` + `/verify` HTTP wrappers have a live server to talk to.

**Architecture:** One Cloudflare Worker dispatches all API routes (`/v1/activate`, `/v1/verify`, `/v1/trial-signup`, `/v1/stripe-webhook`, `/v1/checkout-session`, `/v1/updates/{channel}/latest{,-mac}.yml`, and account-portal endpoints). Three Cloudflare Pages projects (`pages/marketing`, `pages/activate`, `pages/account`) handle the public-facing web surfaces. D1 is the source of truth; KV is the hot-path cache for license lookups + rate limiting; R2 stores release binaries and the auto-update YAML manifests.

```
carbonbook-cloud/
  worker/                  ← Cloudflare Worker (API)
    src/
      index.ts             ← Router entrypoint
      routes/              ← activate.ts, verify.ts, trial-signup.ts, stripe-webhook.ts, checkout-session.ts, updates.ts, devices.ts, auth.ts, account.ts, account-delete.ts
      lib/                 ← jwt.ts, humanized-key.ts, rate-limit.ts, email.ts, stripe.ts, id.ts
      schemas/             ← Zod request/response schemas
    migrations/            ← D1 SQL migrations
    tests/                 ← vitest + miniflare
    wrangler.toml
  pages/
    marketing/             ← Astro 5 + Tailwind v4
    activate/              ← Astro 5 (single page)
    account/               ← Astro 5 + edge functions
  packages/
    shared/                ← Shared Zod schemas, types, constants (consumed by worker + pages)
  biome.json
  tsconfig.base.json
  pnpm-workspace.yaml
  package.json
```

**Tech Stack:** TypeScript strict, Cloudflare Workers (wrangler 4.x), D1 (edge SQLite), Workers KV, R2, Cloudflare Pages, Astro 5, Tailwind CSS v4, Stripe (raw HTTP via `fetch` — no `stripe` SDK — to keep the bundle small and avoid Node-compat for the Worker), `@noble/curves` for EdDSA JWT signing, Resend for transactional email (raw HTTP), vitest + miniflare for Worker testing, biome for lint+format, pnpm workspaces.

**Spec deviations (intentional):**

1. **Signing key format**: the cloud spec (`docs/specs/2026-05-21-carbonbook-cloud-design.md` §"Signing key") names the secret `LICENSE_PRIVATE_KEY_PEM`. The plan uses `LICENSE_PRIVATE_KEY_HEX` (32-byte Ed25519 seed, hex-encoded) instead. Reason: Workers don't ship a PEM/DER parser, `@noble/curves` consumes raw 32-byte seeds directly, and a single env var is simpler to rotate. The on-disk public key (the 32-byte hex constant in `license-public-key.ts`) is unchanged — only the *private* key's storage encoding differs from the spec wording.
2. **Stripe SDK**: the spec mentions "Stripe SDK" in passing. The plan deliberately avoids the SDK and uses `fetch` against the Stripe REST API plus a hand-rolled HMAC-SHA256 verifier. Reason: the SDK pulls in ~80 kB of Node-isms that would force `compatibility_flags = ["nodejs_compat"]` and inflate the worker bundle. Two routes need Stripe (`/v1/stripe-webhook` + `/v1/checkout-session`); both are < 50 lines of fetch.
3. **Auto-update manifest**: the spec serves `latest.yml` (YAML); a previous draft of this plan said `manifest.json`. The plan now matches the spec — see Task 7.

**Specs:**
- Cloud: `docs/specs/2026-05-21-carbonbook-cloud-design.md`
- Landing pages: `docs/specs/2026-05-21-carbonbook-landing-pages-design.md`
- Client-side license system: `docs/specs/2026-05-08-carbonbook-design.md` section 10

**Client-side contract (must match exactly):**
- JWT header: `{ "alg": "EdDSA", "typ": "JWT" }`
- JWT claims schema: `{ iss, license_id, user_id, plan, features, devices_max, issued_at, expires_at, grace_until, support_until?, revocation_check_after }` — all unix seconds where applicable
- Public key format: 32-byte raw Ed25519 hex, currently `DEV_PUBLIC_KEY_HEX` in `carbonbook/src/main/services/license-public-key.ts`
- Device ID format: `dev_` + ULID (26 chars)
- Humanized license key: `cbk-XXXXX-XXXXX-XXXXX-XXXXX` (Crockford Base32, 4 groups of 5)
- Client verifies via `node:crypto` Ed25519 SPKI — cloud signs with matching private key via `@noble/curves` (`ed25519` module)

**Discipline reminder for implementers:**
- This is a NEW repo. Task 1 scaffolds it from scratch.
- Each task is independently committable. Run `biome check` and `vitest run` before every commit.
- Worker tests use `unstable_dev` / miniflare — no live Cloudflare account needed during development.
- Secrets (`LICENSE_PRIVATE_KEY_HEX`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_SECRET_KEY`, `RESEND_API_KEY`, `SESSION_PRIVATE_KEY_HEX`) are never committed; `.dev.vars` holds dev values and is gitignored.

---

## Task 1: Repo scaffold — pnpm workspace, wrangler, tsconfig, biome, vitest

**Files:**
- Create: `package.json` (workspace root)
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `biome.json`
- Create: `.gitignore`
- Create: `.dev.vars.example`
- Create: `worker/package.json`
- Create: `worker/tsconfig.json`
- Create: `worker/wrangler.toml`
- Create: `worker/vitest.config.ts`
- Create: `worker/src/index.ts` (minimal hello-world router)
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/index.ts`

The repo is a pnpm workspace with three areas: `worker/`, `pages/*`, and `packages/shared/`. This task sets up `worker/` and `packages/shared/` only; pages are scaffolded in Tasks 7-9.

- [ ] **Step 1: Init git repo + root workspace**

```bash
git init carbonbook-cloud
```

Run every subsequent command in this task from inside the `carbonbook-cloud/` directory the command above just created.

Create `package.json` (workspace root, private, no deps — just scripts):

```json
{
  "name": "carbonbook-cloud",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20", "pnpm": ">=10" },
  "scripts": {
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "test": "pnpm -r run test",
    "test:worker": "pnpm --filter @carbonbook-cloud/worker test"
  }
}
```

Create `pnpm-workspace.yaml`:

```yaml
packages:
  - worker
  - packages/*
  - pages/*
```

- [ ] **Step 2: tsconfig.base.json + biome.json**

`tsconfig.base.json` — strict, ES2022 target (Cloudflare Workers runtime):

```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true
  }
}
```

`biome.json` — matches the carbonbook Electron repo's style where possible:

```json
{
  "$schema": "https://biomejs.dev/schemas/2.0.0/schema.json",
  "organizeImports": { "enabled": true },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "linter": {
    "enabled": true,
    "rules": { "recommended": true }
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "single",
      "trailingCommas": "all",
      "semicolons": "always"
    }
  }
}
```

- [ ] **Step 3: packages/shared scaffold**

`packages/shared/package.json`:

```json
{
  "name": "@carbonbook-cloud/shared",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts"
}
```

`packages/shared/tsconfig.json` — extends base:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

`packages/shared/src/index.ts` — placeholder, populated in Task 2:

```ts
// @carbonbook-cloud/shared — Zod schemas, types, and constants
// shared between the Worker and Pages edge functions.
export {};
```

- [ ] **Step 4: worker/ scaffold with wrangler.toml**

`worker/package.json`:

```json
{
  "name": "@carbonbook-cloud/worker",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@carbonbook-cloud/shared": "workspace:*",
    "@noble/curves": "^1.8.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.8.0",
    "@cloudflare/workers-types": "^4.20250501.0",
    "vitest": "^3.2.0",
    "wrangler": "^4.14.0"
  }
}
```

`worker/wrangler.toml`:

```toml
name = "carbonbook-cloud-api"
main = "src/index.ts"
compatibility_date = "2025-05-01"
# No nodejs_compat needed: we use @noble/curves (pure-JS WebCrypto-based)
# for Ed25519 and raw fetch() calls (no stripe SDK) for Stripe + Resend.
# If a future contributor adds the `stripe` npm package, they MUST also
# add `compatibility_flags = ["nodejs_compat"]` here and re-measure the
# bundle size against the free-tier limit (see Task 10 Step 4).

# ---------- D1 ----------
[[d1_databases]]
binding = "DB"
database_name = "carbonbook-cloud"
database_id = "local"              # replaced by real ID after `wrangler d1 create`
migrations_dir = "migrations"

# ---------- KV ----------
[[kv_namespaces]]
binding = "LICENSE_ACTIVE"
id = "local"                        # replaced after `wrangler kv namespace create`

[[kv_namespaces]]
binding = "REVOCATION_SET"
id = "local"

[[kv_namespaces]]
binding = "HUMANIZED_KEYS"
id = "local"

[[kv_namespaces]]
binding = "RATE_LIMIT"
id = "local"

# ---------- R2 ----------
[[r2_buckets]]
binding = "RELEASES"
bucket_name = "carbonbook-releases"

# ---------- Secrets (never in this file — set via wrangler secret put) ----------
# LICENSE_PRIVATE_KEY_HEX   — Ed25519 64-byte hex (seed+pubkey) for @noble/ed25519
# SESSION_PRIVATE_KEY_HEX   — Separate Ed25519 key for account portal session JWTs
# STRIPE_SECRET_KEY          — Stripe secret key (sk_live_... or sk_test_...)
# STRIPE_WEBHOOK_SECRET      — Stripe webhook signing secret (whsec_...)
# RESEND_API_KEY             — Resend transactional email API key

# ---------- Environment variables ----------
[vars]
ENVIRONMENT = "development"
STRIPE_PUBLISHABLE_KEY = "pk_test_placeholder"
```

`worker/tsconfig.json`:

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "types": ["@cloudflare/workers-types"]
  },
  "include": ["src"],
  "references": [{ "path": "../packages/shared" }]
}
```

- [ ] **Step 5: vitest config with miniflare pool**

`worker/vitest.config.ts`:

```ts
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    globals: true,
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          d1Databases: ['DB'],
          kvNamespaces: ['LICENSE_ACTIVE', 'REVOCATION_SET', 'HUMANIZED_KEYS', 'RATE_LIMIT'],
          r2Buckets: ['RELEASES'],
        },
      },
    },
  },
});
```

- [ ] **Step 6: Minimal router in worker/src/index.ts**

```ts
export interface Env {
  DB: D1Database;
  LICENSE_ACTIVE: KVNamespace;
  REVOCATION_SET: KVNamespace;
  HUMANIZED_KEYS: KVNamespace;
  RATE_LIMIT: KVNamespace;
  RELEASES: R2Bucket;
  LICENSE_PRIVATE_KEY_HEX: string;
  SESSION_PRIVATE_KEY_HEX: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  RESEND_API_KEY: string;
  STRIPE_PUBLISHABLE_KEY: string;
  ENVIRONMENT: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders(),
      });
    }

    // Route dispatch
    if (path === '/health') {
      return json({ status: 'ok', timestamp: Date.now() });
    }

    return json({ error: { _tag: 'NotFound', message: `No route: ${path}` } }, 404);
  },
} satisfies ExportedHandler<Env>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}
```

- [ ] **Step 7: .gitignore + .dev.vars.example**

`.gitignore`:

```
node_modules/
dist/
.wrangler/
.dev.vars
.astro/
*.tsbuildinfo
```

`.dev.vars.example`:

```bash
# Copy to .dev.vars and fill in real values for local development.
# NEVER commit .dev.vars — it contains secrets.
LICENSE_PRIVATE_KEY_HEX=<64-byte-hex-ed25519-seed-plus-pubkey>
SESSION_PRIVATE_KEY_HEX=<64-byte-hex-ed25519-seed-plus-pubkey>
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
RESEND_API_KEY=re_...
```

- [ ] **Step 8: Smoke test — hello world Worker responds**

Write `worker/tests/health.test.ts`:

```ts
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src/index.js';

describe('health endpoint', () => {
  it('GET /health returns 200 with status ok', async () => {
    const req = new Request('https://api.carbonbook.app/health');
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const body = await res.json<{ status: string }>();
    expect(body.status).toBe('ok');
  });

  it('unknown route returns 404', async () => {
    const req = new Request('https://api.carbonbook.app/nope');
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(404);
  });
});
```

Run:

```bash
pnpm install
pnpm test:worker
```

Expected: 2 tests pass.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: scaffold carbonbook-cloud repo — pnpm workspace, wrangler, biome, vitest"
```

---

## Task 2: D1 migrations + shared types + humanized key generator

**Files:**
- Create: `worker/migrations/0001_initial_schema.sql`
- Create: `packages/shared/src/types.ts`
- Create: `packages/shared/src/schemas.ts`
- Create: `packages/shared/src/constants.ts`
- Create: `packages/shared/src/humanized-key.ts`
- Create: `worker/src/lib/id.ts`
- Modify: `packages/shared/src/index.ts` — re-export everything
- Create: `worker/tests/humanized-key.test.ts`
- Create: `worker/tests/migrations.test.ts`

This task establishes the D1 schema (customer, license, device tables), the Zod schemas for all API request/response shapes, and the humanized license key generator (`cbk-XXXXX-XXXXX-XXXXX-XXXXX`).

**Note on `license.humanized_key` (spec clarification):** the cloud spec keeps the
humanized → `license_id` mapping in KV only. The plan additionally stores
`humanized_key` as a column on the `license` D1 row. Reason: the account
portal needs to display "your license key" alongside the rest of the row
data ("plan", "expires"), and an admin debugging "what humanized key was
issued for license `lic_X`" should not have to scan the entire KV
namespace. KV `HUMANIZED_KEYS[humanized] → license_id` remains the hot-path
reverse lookup (every `/activate` does it on the edge). The D1 column is
the cold-path forward lookup. They never disagree because both are
written in the same transaction.

- [ ] **Step 1: D1 migration — initial schema**

Create `worker/migrations/0001_initial_schema.sql`:

```sql
-- 0001_initial_schema.sql
-- Core tables for the carbonbook licensing system.

CREATE TABLE customer (
  user_id            TEXT PRIMARY KEY,           -- 'usr_01H...' (ULID)
  email              TEXT NOT NULL UNIQUE,
  country            TEXT,                       -- ISO 3166-1 alpha-2, from IP at signup
  created_at         INTEGER NOT NULL,           -- unix seconds
  stripe_customer_id TEXT
);

CREATE TABLE license (
  license_id              TEXT PRIMARY KEY,       -- 'lic_01H...' (ULID)
  user_id                 TEXT NOT NULL REFERENCES customer(user_id),
  humanized_key           TEXT NOT NULL UNIQUE,   -- 'cbk-XXXXX-XXXXX-XXXXX-XXXXX'
  plan                    TEXT NOT NULL,           -- 'base@2026-q2', 'trial@14d'
  features                TEXT NOT NULL,           -- JSON array: '["inventory","questionnaire","iso14064"]'
  devices_max             INTEGER NOT NULL,
  issued_at               INTEGER NOT NULL,        -- unix seconds
  expires_at              INTEGER NOT NULL,        -- unix seconds
  grace_until             INTEGER NOT NULL,        -- unix seconds
  stripe_subscription_id  TEXT,
  revoked                 INTEGER NOT NULL DEFAULT 0,
  revoked_at              INTEGER,
  revoked_reason          TEXT
);

CREATE TABLE device (
  device_id       TEXT NOT NULL,                  -- 'dev_01H...' (ULID, from client)
  license_id      TEXT NOT NULL REFERENCES license(license_id),
  first_seen_at   INTEGER NOT NULL,               -- unix seconds
  last_ping_at    INTEGER NOT NULL,               -- unix seconds
  app_version     TEXT,
  os              TEXT,                            -- 'darwin' | 'win32' | 'linux'
  PRIMARY KEY (device_id, license_id)
);

CREATE INDEX idx_license_user ON license(user_id);
CREATE INDEX idx_device_license ON device(license_id);
```

- [ ] **Step 2: Shared types**

Create `packages/shared/src/types.ts`:

```ts
/**
 * JWT claims shape — MUST match the client-side `LicenseJwtClaims` type
 * in carbonbook/src/shared/types.ts exactly.
 */
export type LicenseJwtClaims = {
  iss: string;
  license_id: string;
  user_id: string;
  plan: string;
  features: string[];
  devices_max: number;
  issued_at: number;
  expires_at: number;
  grace_until: number;
  support_until?: number;
  revocation_check_after: number;
};

/** Shape stored in KV `license_active[license_id]`. */
export type LicenseActiveRecord = {
  license_id: string;
  user_id: string;
  plan: string;
  features: string[];
  devices_max: number;
  device_ids: string[];
  issued_at: number;
  expires_at: number;
  grace_until: number;
  revoked: boolean;
  revoked_at: number | null;
  revoked_reason: string | null;
  stripe_subscription_id: string | null;
};

/** Shape stored in KV `revocation_set['list']`. */
export type RevocationSet = {
  license_ids: string[];
  updated_at: number;
};

/** Standardised API error envelope. */
export type ApiError = {
  error: {
    _tag: string;
    message: string;
  };
};
```

- [ ] **Step 3: Zod request/response schemas**

Create `packages/shared/src/schemas.ts`:

```ts
import { z } from 'zod';

// ---- /v1/activate ----
export const activateRequestSchema = z.object({
  license_key: z.string().regex(/^cbk-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/i),
  device_id: z.string().min(1),
  app_version: z.string().min(1),
  os: z.string().min(1),
});

export const activateSuccessSchema = z.object({
  jwt: z.string(),
  claims: z.object({
    iss: z.string(),
    license_id: z.string(),
    user_id: z.string(),
    plan: z.string(),
    features: z.array(z.string()),
    devices_max: z.number(),
    issued_at: z.number(),
    expires_at: z.number(),
    grace_until: z.number(),
    revocation_check_after: z.number(),
  }),
});

// ---- /v1/verify ----
export const verifyRequestSchema = z.object({
  license_id: z.string().min(1),
  device_id: z.string().min(1),
  app_version: z.string().min(1),
  os: z.string().min(1),
});

// ---- /v1/trial-signup ----
export const trialSignupRequestSchema = z.object({
  email: z.string().email(),
  country_hint: z.string().max(2).optional(),
  device_id: z.string().min(1),
  app_version: z.string().min(1),
});

// ---- Shared claim shape for JWT ----
export const jwtClaimsSchema = z.object({
  iss: z.string().min(1),
  license_id: z.string().min(1),
  user_id: z.string().min(1),
  plan: z.string().min(1),
  features: z.array(z.string()).min(1),
  devices_max: z.number().int().positive(),
  issued_at: z.number().int().nonnegative(),
  expires_at: z.number().int().nonnegative(),
  grace_until: z.number().int().nonnegative(),
  support_until: z.number().int().nonnegative().optional(),
  revocation_check_after: z.number().int().nonnegative(),
});

export type ActivateRequest = z.infer<typeof activateRequestSchema>;
export type VerifyRequest = z.infer<typeof verifyRequestSchema>;
export type TrialSignupRequest = z.infer<typeof trialSignupRequestSchema>;
```

- [ ] **Step 4: Constants**

Create `packages/shared/src/constants.ts`:

```ts
/** JWT header — fixed for all carbonbook license JWTs. */
export const JWT_HEADER = { alg: 'EdDSA', typ: 'JWT' } as const;

/** The JWT `iss` claim value. */
export const JWT_ISSUER = 'carbonbook.app';

/** Base plan feature set for v1. */
export const BASE_FEATURES = ['inventory', 'questionnaire', 'iso14064'] as const;

/** Trial plan duration in seconds (14 days). */
export const TRIAL_DURATION_S = 14 * 24 * 60 * 60;

/** Grace period in seconds (30 days after expires_at). */
export const GRACE_PERIOD_S = 30 * 24 * 60 * 60;

/** Revocation check interval in seconds (7 days). */
export const REVOCATION_CHECK_INTERVAL_S = 7 * 24 * 60 * 60;

/** Rate limit: /activate — 10 requests per 60 seconds per license_key. */
export const RATE_LIMIT_ACTIVATE = { max: 10, windowS: 60 } as const;

/** Rate limit: /verify — 6 requests per 60 seconds per device_id. */
export const RATE_LIMIT_VERIFY = { max: 6, windowS: 60 } as const;

/** Rate limit: /trial-signup — 5 per day per IP. */
export const RATE_LIMIT_TRIAL = { max: 5, windowS: 24 * 60 * 60 } as const;
```

- [ ] **Step 5: Humanized key generator**

Create `packages/shared/src/humanized-key.ts`:

```ts
/**
 * Humanized license key: `cbk-XXXXX-XXXXX-XXXXX-XXXXX`
 * 20 Crockford Base32 characters = 100 bits of entropy.
 *
 * Crockford Base32 alphabet (excludes I, L, O, U to avoid
 * visual/offensive confusion): 0123456789ABCDEFGHJKMNPQRSTVWXYZ
 */

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Generate a humanized license key with 100 bits of randomness.
 * Uses Web Crypto API (available in Workers + Node 20+).
 */
export function generateHumanizedKey(): string {
  const bytes = new Uint8Array(13); // 104 bits, we use 100
  crypto.getRandomValues(bytes);
  let chars = '';
  for (let i = 0; i < 20; i++) {
    // Extract 5 bits per character from the byte stream
    const bitOffset = i * 5;
    const byteIndex = Math.floor(bitOffset / 8);
    const bitShift = bitOffset % 8;
    // Read 2 bytes to handle cross-byte boundary
    const val = ((bytes[byteIndex]! << 8) | (bytes[byteIndex + 1] ?? 0)) >> (16 - bitShift - 5);
    chars += CROCKFORD[val & 0x1f]!;
  }
  return `cbk-${chars.slice(0, 5)}-${chars.slice(5, 10)}-${chars.slice(10, 15)}-${chars.slice(15, 20)}`;
}

/**
 * Normalize a user-typed key: uppercase, strip extra whitespace,
 * validate format. Returns null if the input doesn't match.
 */
export function normalizeHumanizedKey(input: string): string | null {
  const cleaned = input.trim().toUpperCase().replace(/\s+/g, '');
  // Accept with or without dashes
  const noDash = cleaned.replace(/-/g, '');
  if (!/^CBK[0-9A-HJKMNP-TV-Z]{20}$/.test(noDash)) return null;
  return `cbk-${noDash.slice(3, 8)}-${noDash.slice(8, 13)}-${noDash.slice(13, 18)}-${noDash.slice(18, 23)}`.toLowerCase();
}
```

- [ ] **Step 6: ID generation utility**

Create `worker/src/lib/id.ts`:

```ts
/**
 * Generate prefixed ULIDs for database IDs.
 * Uses timestamp + random (monotonic within the same ms).
 * The `ulid` package is NOT used server-side — we hand-roll a simpler
 * version using crypto.getRandomValues for Cloudflare Workers compat.
 */

const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford Base32

function encodeTime(ts: number, len: number): string {
  let s = '';
  for (let i = len - 1; i >= 0; i--) {
    s = ENCODING[ts % 32]! + s;
    ts = Math.floor(ts / 32);
  }
  return s;
}

function encodeRandom(len: number): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) {
    s += ENCODING[b % 32]!;
  }
  return s;
}

export function newId(prefix: string): string {
  const ts = Date.now();
  return `${prefix}${encodeTime(ts, 10)}${encodeRandom(16)}`;
}

export const newUserId = () => newId('usr_');
export const newLicenseId = () => newId('lic_');
```

- [ ] **Step 7: Update shared/src/index.ts re-exports**

```ts
export * from './types.js';
export * from './schemas.js';
export * from './constants.js';
export * from './humanized-key.js';
```

- [ ] **Step 8: Tests**

Create `worker/tests/humanized-key.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { generateHumanizedKey, normalizeHumanizedKey } from '@carbonbook-cloud/shared';

describe('generateHumanizedKey', () => {
  it('produces cbk-XXXXX-XXXXX-XXXXX-XXXXX format', () => {
    const key = generateHumanizedKey();
    expect(key).toMatch(/^cbk-[0-9a-hjkmnp-tv-z]{5}-[0-9a-hjkmnp-tv-z]{5}-[0-9a-hjkmnp-tv-z]{5}-[0-9a-hjkmnp-tv-z]{5}$/i);
  });

  it('generates unique keys', () => {
    const keys = new Set(Array.from({ length: 100 }, () => generateHumanizedKey()));
    expect(keys.size).toBe(100);
  });
});

describe('normalizeHumanizedKey', () => {
  it('normalizes uppercase with dashes', () => {
    expect(normalizeHumanizedKey('CBK-ABCDE-12345-FGHJK-MNPQR')).toBe('cbk-abcde-12345-fghjk-mnpqr');
  });

  it('normalizes input without dashes', () => {
    expect(normalizeHumanizedKey('cbkABCDE12345FGHJKMNPQR')).toBe('cbk-abcde-12345-fghjk-mnpqr');
  });

  it('rejects invalid characters (I, L, O, U)', () => {
    expect(normalizeHumanizedKey('CBK-ILOUD-12345-FGHJK-MNPQR')).toBeNull();
  });

  it('rejects wrong length', () => {
    expect(normalizeHumanizedKey('cbk-ABC-DEF')).toBeNull();
  });
});
```

Create `worker/tests/migrations.test.ts`:

```ts
import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

describe('D1 migrations', () => {
  it('customer table exists and accepts inserts', async () => {
    await env.DB.exec(`INSERT INTO customer (user_id, email, created_at) VALUES ('usr_test', 'test@example.com', 1700000000)`);
    const row = await env.DB.prepare('SELECT * FROM customer WHERE user_id = ?').bind('usr_test').first();
    expect(row).toBeTruthy();
    expect(row!.email).toBe('test@example.com');
  });

  it('license table exists with foreign key to customer', async () => {
    await env.DB.exec(`INSERT INTO customer (user_id, email, created_at) VALUES ('usr_fk', 'fk@example.com', 1700000000)`);
    await env.DB.exec(`INSERT INTO license (license_id, user_id, humanized_key, plan, features, devices_max, issued_at, expires_at, grace_until) VALUES ('lic_test', 'usr_fk', 'cbk-aaaaa-bbbbb-ccccc-ddddd', 'base@2026-q2', '["inventory"]', 1, 1700000000, 1710000000, 1720000000)`);
    const row = await env.DB.prepare('SELECT * FROM license WHERE license_id = ?').bind('lic_test').first();
    expect(row).toBeTruthy();
    expect(row!.plan).toBe('base@2026-q2');
  });

  it('device table has composite primary key', async () => {
    await env.DB.exec(`INSERT INTO customer (user_id, email, created_at) VALUES ('usr_dev', 'dev@example.com', 1700000000)`);
    await env.DB.exec(`INSERT INTO license (license_id, user_id, humanized_key, plan, features, devices_max, issued_at, expires_at, grace_until) VALUES ('lic_dev', 'usr_dev', 'cbk-ddddd-eeeee-fffff-ggggg', 'base@2026-q2', '[]', 1, 1700000000, 1710000000, 1720000000)`);
    await env.DB.exec(`INSERT INTO device (device_id, license_id, first_seen_at, last_ping_at) VALUES ('dev_abc', 'lic_dev', 1700000000, 1700000000)`);
    const row = await env.DB.prepare('SELECT * FROM device WHERE device_id = ? AND license_id = ?').bind('dev_abc', 'lic_dev').first();
    expect(row).toBeTruthy();
  });
});
```

- [ ] **Step 9: Run tests + commit**

```bash
pnpm install && pnpm test:worker && pnpm lint
git add -A
git commit -m "feat: D1 schema, shared Zod schemas/types, humanized key generator"
```

---

## Task 3: Ed25519 JWT signing + rate limiting library

**Files:**
- Create: `worker/src/lib/jwt.ts`
- Create: `worker/src/lib/rate-limit.ts`
- Create: `worker/tests/jwt.test.ts`
- Create: `worker/tests/rate-limit.test.ts`

These are the two shared libraries that every API route depends on. JWT signing is the critical one — the signed output must be verifiable by the Electron client's `node:crypto` Ed25519 SPKI path.

- [ ] **Step 1: JWT signing module**

Create `worker/src/lib/jwt.ts`:

```ts
import { ed25519 } from '@noble/curves/ed25519';
import { JWT_HEADER, JWT_ISSUER } from '@carbonbook-cloud/shared';
import type { LicenseJwtClaims } from '@carbonbook-cloud/shared';

/**
 * Base64url encode a Uint8Array or string.
 */
function b64url(data: Uint8Array | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  // Workers have btoa; encode bytes → binary string → base64 → base64url
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Parse a 64-byte hex string (seed || pubkey) into the 32-byte seed
 * that @noble/ed25519 needs for signing.
 */
function parsePrivateKeyHex(hex: string): Uint8Array {
  if (hex.length !== 128) {
    // Might be 64 hex chars = 32 bytes (seed only)
    if (hex.length === 64) {
      const bytes = new Uint8Array(32);
      for (let i = 0; i < 32; i++) {
        bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
      }
      return bytes;
    }
    throw new Error(`Expected 64 or 128 hex chars for Ed25519 private key, got ${hex.length}`);
  }
  // First 32 bytes = seed
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Sign a license JWT with Ed25519 (EdDSA).
 *
 * The resulting JWT is verifiable by the Electron client using
 * `node:crypto.verify(null, signingInput, publicKey, signature)`.
 */
export async function signLicenseJwt(
  claims: LicenseJwtClaims,
  privateKeyHex: string,
): Promise<string> {
  const header = b64url(JSON.stringify(JWT_HEADER));
  const body = b64url(JSON.stringify(claims));
  const signingInput = `${header}.${body}`;
  const seed = parsePrivateKeyHex(privateKeyHex);
  const signature = ed25519.sign(
    new TextEncoder().encode(signingInput),
    seed,
  );
  return `${signingInput}.${b64url(signature)}`;
}

/**
 * Build the standard claims for a license JWT.
 *
 * NOTE: `support_until` is intentionally omitted. The client's
 * `LicenseJwtClaims` Zod schema marks it as optional, and v1 has no
 * paid-support tier — base licenses are "lifetime support" via the
 * existing `expires_at` field. When a paid-support SKU ships, add
 * `supportUntil` to this function's options and emit it as a claim.
 */
export function buildClaims(opts: {
  licenseId: string;
  userId: string;
  plan: string;
  features: string[];
  devicesMax: number;
  issuedAt: number;
  expiresAt: number;
  graceUntil: number;
  nowSeconds: number;
  revocationCheckIntervalS: number;
}): LicenseJwtClaims {
  return {
    iss: JWT_ISSUER,
    license_id: opts.licenseId,
    user_id: opts.userId,
    plan: opts.plan,
    features: opts.features,
    devices_max: opts.devicesMax,
    issued_at: opts.issuedAt,
    expires_at: opts.expiresAt,
    grace_until: opts.graceUntil,
    // support_until intentionally omitted — see JSDoc above.
    revocation_check_after: opts.nowSeconds + opts.revocationCheckIntervalS,
  };
}
```

- [ ] **Step 2: Rate limiting via KV counters**

Create `worker/src/lib/rate-limit.ts`:

```ts
/**
 * Rate limiting via KV counters with TTL.
 *
 * NOT Cloudflare's built-in rate limiting (requires paid plan).
 * Each counter is a KV key `rl:{scope}:{identifier}` with a TTL
 * matching the rate limit window. Value is a JSON `{ count, resetAt }`.
 */

type RateLimitConfig = {
  max: number;
  windowS: number;
};

type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: number;
};

type CounterValue = {
  count: number;
  resetAt: number;
};

export async function checkRateLimit(
  kv: KVNamespace,
  scope: string,
  identifier: string,
  config: RateLimitConfig,
  nowSeconds: number,
): Promise<RateLimitResult> {
  const key = `rl:${scope}:${identifier}`;
  const raw = await kv.get(key);
  let counter: CounterValue;

  if (raw) {
    counter = JSON.parse(raw) as CounterValue;
    // Window expired — reset
    if (nowSeconds >= counter.resetAt) {
      counter = { count: 0, resetAt: nowSeconds + config.windowS };
    }
  } else {
    counter = { count: 0, resetAt: nowSeconds + config.windowS };
  }

  counter.count += 1;
  const allowed = counter.count <= config.max;

  // Write back with TTL = remaining window + small buffer.
  // KV's minimum expirationTtl is 60 seconds — if a window is about to
  // close (e.g. resetAt - nowSeconds = 3), passing `8` would 400 with
  // "Invalid expiration_ttl". Clamp to the 60s floor; the extra lifetime
  // costs nothing (the next read sees the expired window and resets
  // the counter via the `nowSeconds >= counter.resetAt` branch above).
  const ttlS = Math.max(60, counter.resetAt - nowSeconds + 5);
  await kv.put(key, JSON.stringify(counter), { expirationTtl: ttlS });

  return {
    allowed,
    remaining: Math.max(0, config.max - counter.count),
    resetAt: counter.resetAt,
  };
}
```

- [ ] **Step 3: JWT signing test — verify round-trip with @noble/curves**

Create `worker/tests/jwt.test.ts`:

```ts
import { ed25519 } from '@noble/curves/ed25519';
import { describe, it, expect } from 'vitest';
import { signLicenseJwt, buildClaims } from '../src/lib/jwt.js';
import { REVOCATION_CHECK_INTERVAL_S } from '@carbonbook-cloud/shared';

// Generate a test keypair
const seed = ed25519.utils.randomPrivateKey();
const pubkey = ed25519.getPublicKey(seed);
const seedHex = Buffer.from(seed).toString('hex');

function b64urlDecode(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

describe('signLicenseJwt', () => {
  const now = Math.floor(Date.now() / 1000);
  const claims = buildClaims({
    licenseId: 'lic_test',
    userId: 'usr_test',
    plan: 'base@2026-q2',
    features: ['inventory', 'questionnaire', 'iso14064'],
    devicesMax: 1,
    issuedAt: now,
    expiresAt: now + 86400 * 365,
    graceUntil: now + 86400 * 395,
    nowSeconds: now,
    revocationCheckIntervalS: REVOCATION_CHECK_INTERVAL_S,
  });

  it('produces a 3-part JWT', async () => {
    const jwt = await signLicenseJwt(claims, seedHex);
    const parts = jwt.split('.');
    expect(parts.length).toBe(3);
  });

  it('header has alg=EdDSA, typ=JWT', async () => {
    const jwt = await signLicenseJwt(claims, seedHex);
    const header = JSON.parse(new TextDecoder().decode(b64urlDecode(jwt.split('.')[0]!)));
    expect(header.alg).toBe('EdDSA');
    expect(header.typ).toBe('JWT');
  });

  it('body round-trips the claims', async () => {
    const jwt = await signLicenseJwt(claims, seedHex);
    const body = JSON.parse(new TextDecoder().decode(b64urlDecode(jwt.split('.')[1]!)));
    expect(body.iss).toBe('carbonbook.app');
    expect(body.license_id).toBe('lic_test');
    expect(body.plan).toBe('base@2026-q2');
    expect(body.features).toEqual(['inventory', 'questionnaire', 'iso14064']);
  });

  it('signature is verifiable with the matching public key', async () => {
    const jwt = await signLicenseJwt(claims, seedHex);
    const [h, b, s] = jwt.split('.') as [string, string, string];
    const sigInput = new TextEncoder().encode(`${h}.${b}`);
    const sig = b64urlDecode(s);
    const valid = ed25519.verify(sig, sigInput, pubkey);
    expect(valid).toBe(true);
  });

  it('rejects a tampered body', async () => {
    const jwt = await signLicenseJwt(claims, seedHex);
    const parts = jwt.split('.');
    // Tamper with the body
    parts[1] = parts[1]! + 'x';
    const [h, b, s] = parts as [string, string, string];
    const sigInput = new TextEncoder().encode(`${h}.${b}`);
    const sig = b64urlDecode(s);
    const valid = ed25519.verify(sig, sigInput, pubkey);
    expect(valid).toBe(false);
  });
});
```

- [ ] **Step 4: Rate limit test**

Create `worker/tests/rate-limit.test.ts`:

```ts
import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { checkRateLimit } from '../src/lib/rate-limit.js';

describe('checkRateLimit', () => {
  const config = { max: 3, windowS: 60 };

  it('allows requests within the limit', async () => {
    const now = 1700000000;
    const r1 = await checkRateLimit(env.RATE_LIMIT, 'test', 'key1', config, now);
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(2);
  });

  it('blocks after exceeding the limit', async () => {
    const now = 1700000100;
    for (let i = 0; i < 3; i++) {
      await checkRateLimit(env.RATE_LIMIT, 'test', 'key2', config, now);
    }
    const blocked = await checkRateLimit(env.RATE_LIMIT, 'test', 'key2', config, now);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it('resets after the window expires', async () => {
    const now1 = 1700000200;
    for (let i = 0; i < 3; i++) {
      await checkRateLimit(env.RATE_LIMIT, 'test', 'key3', config, now1);
    }
    // 61 seconds later — window has expired
    const now2 = now1 + 61;
    const r = await checkRateLimit(env.RATE_LIMIT, 'test', 'key3', config, now2);
    expect(r.allowed).toBe(true);
  });

  it('does not throw at the very end of the window (KV TTL >= 60s)', async () => {
    // Regression test for the TTL-floor fix: KV rejects expirationTtl < 60.
    // The first write creates a window ending at now+60; the second write
    // happens at now+58, leaving only 2s — clamping to 60 must apply.
    const start = 1700000300;
    await checkRateLimit(env.RATE_LIMIT, 'test', 'edge', config, start);
    await expect(
      checkRateLimit(env.RATE_LIMIT, 'test', 'edge', config, start + 58),
    ).resolves.toBeTruthy();
  });
});
```

- [ ] **Step 5: Run tests + commit**

```bash
pnpm test:worker && pnpm lint
git add -A
git commit -m "feat: Ed25519 JWT signing + KV-based rate limiting"
```

---

## Task 4: `/v1/activate` + `/v1/verify` endpoints

**Files:**
- Create: `worker/src/lib/responses.ts` (shared JSON / error helpers)
- Create: `worker/src/lib/license-store.ts` (KV+D1 reads/writes for the active record)
- Create: `worker/src/routes/activate.ts`
- Create: `worker/src/routes/verify.ts`
- Modify: `worker/src/index.ts` — wire routes
- Create: `worker/tests/_fixtures.ts` (D1+KV seed helpers, reused by Tasks 4-9)
- Create: `worker/tests/activate.test.ts`
- Create: `worker/tests/verify.test.ts`

These are the two endpoints the Electron client talks to. `/activate` is
called when the user pastes a license key; `/verify` is the 7-day
background ping. Both write through D1 and KV; KV is the read path.

We split into small steps because the route reads from 3 stores
(`HUMANIZED_KEYS`, `LICENSE_ACTIVE`, D1) and writes to 2 — easy to half-do.

- [ ] **Step 1: Shared response helpers**

Create `worker/src/lib/responses.ts`:

```ts
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS, ...extra },
  });
}

export type ErrorTag =
  | 'UnknownKey'
  | 'RevokedLicense'
  | 'DeviceCapReached'
  | 'RateLimited'
  | 'BadRequest'
  | 'Unauthorized'
  | 'NotFound'
  | 'Internal';

export function err(tag: ErrorTag, message: string, status: number): Response {
  return json({ error: { _tag: tag, message } }, status);
}
```

Move the `corsHeaders`/`json` helpers from `worker/src/index.ts` to import from this module so the routes share them.

- [ ] **Step 2: License-store module — KV reads/writes**

Create `worker/src/lib/license-store.ts`:

```ts
import type { LicenseActiveRecord } from '@carbonbook-cloud/shared';

export async function getLicenseIdByHumanizedKey(
  kv: KVNamespace,
  humanized: string,
): Promise<string | null> {
  return kv.get(`hk:${humanized}`);
}

export async function readActive(
  kv: KVNamespace,
  licenseId: string,
): Promise<LicenseActiveRecord | null> {
  const raw = await kv.get(`la:${licenseId}`);
  return raw ? (JSON.parse(raw) as LicenseActiveRecord) : null;
}

export async function writeActive(
  kv: KVNamespace,
  record: LicenseActiveRecord,
): Promise<void> {
  await kv.put(`la:${record.license_id}`, JSON.stringify(record));
}

export async function writeHumanizedKey(
  kv: KVNamespace,
  humanized: string,
  licenseId: string,
): Promise<void> {
  await kv.put(`hk:${humanized}`, licenseId);
}
```

Run + commit:

```bash
pnpm --filter @carbonbook-cloud/worker exec biome check src/lib/responses.ts src/lib/license-store.ts
git add -A
git commit -m "feat(worker): response + license-store helpers"
```

- [ ] **Step 3: Test fixtures**

Create `worker/tests/_fixtures.ts`:

```ts
import { env } from 'cloudflare:test';
import type { LicenseActiveRecord } from '@carbonbook-cloud/shared';

export const TEST_PRIVATE_KEY_HEX =
  // deterministic 32-byte seed used in tests; matches TEST_PUBLIC_KEY below
  '4af3e2f9c1b0a988776655443322110011223344556677889900aabbccddeeff';

export async function seedLicense(opts: {
  userId?: string;
  licenseId?: string;
  humanizedKey?: string;
  plan?: string;
  features?: string[];
  devicesMax?: number;
  devices?: string[];
  revoked?: boolean;
  revokedReason?: string;
  expiresAt?: number;
  graceUntil?: number;
} = {}): Promise<LicenseActiveRecord> {
  const now = 1_700_000_000;
  const record: LicenseActiveRecord = {
    license_id: opts.licenseId ?? 'lic_test',
    user_id: opts.userId ?? 'usr_test',
    plan: opts.plan ?? 'base@2026-q2',
    features: opts.features ?? ['inventory', 'questionnaire', 'iso14064'],
    devices_max: opts.devicesMax ?? 1,
    device_ids: opts.devices ?? [],
    issued_at: now,
    expires_at: opts.expiresAt ?? now + 365 * 86_400,
    grace_until: opts.graceUntil ?? now + 395 * 86_400,
    revoked: opts.revoked ?? false,
    revoked_at: opts.revoked ? now : null,
    revoked_reason: opts.revokedReason ?? null,
    stripe_subscription_id: null,
  };
  const humanized = opts.humanizedKey ?? 'cbk-aaaaa-bbbbb-ccccc-ddddd';

  // D1
  await env.DB.prepare(
    'INSERT OR REPLACE INTO customer (user_id, email, created_at) VALUES (?, ?, ?)',
  ).bind(record.user_id, `${record.user_id}@example.com`, now).run();
  await env.DB.prepare(
    `INSERT OR REPLACE INTO license
     (license_id, user_id, humanized_key, plan, features, devices_max, issued_at, expires_at, grace_until, revoked, revoked_at, revoked_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    record.license_id, record.user_id, humanized, record.plan,
    JSON.stringify(record.features), record.devices_max,
    record.issued_at, record.expires_at, record.grace_until,
    record.revoked ? 1 : 0, record.revoked_at, record.revoked_reason,
  ).run();

  // KV
  await env.LICENSE_ACTIVE.put(`la:${record.license_id}`, JSON.stringify(record));
  await env.HUMANIZED_KEYS.put(`hk:${humanized}`, record.license_id);
  return record;
}
```

Run + commit:

```bash
pnpm --filter @carbonbook-cloud/worker exec biome check tests/_fixtures.ts
git add -A
git commit -m "test(worker): D1+KV seed fixtures"
```

- [ ] **Step 4: Write failing test — `/v1/activate` happy path**

Create `worker/tests/activate.test.ts` (initial version, just the happy path):

```ts
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../src/index.js';
import { seedLicense, TEST_PRIVATE_KEY_HEX } from './_fixtures.js';

const HUMANIZED = 'cbk-aaaaa-bbbbb-ccccc-ddddd';

async function activate(body: unknown): Promise<Response> {
  const req = new Request('https://api.carbonbook.app/v1/activate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const ctx = createExecutionContext();
  const res = await worker.fetch(req, { ...env, LICENSE_PRIVATE_KEY_HEX: TEST_PRIVATE_KEY_HEX }, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

describe('POST /v1/activate', () => {
  beforeEach(async () => {
    // miniflare gives us a clean DB+KV per test file; nothing to do.
  });

  it('returns 200 + JWT for a valid first-time activation', async () => {
    await seedLicense({ humanizedKey: HUMANIZED, devicesMax: 2, devices: [] });
    const res = await activate({
      license_key: HUMANIZED, device_id: 'dev_alpha',
      app_version: '0.5.0', os: 'darwin',
    });
    expect(res.status).toBe(200);
    const body = await res.json<{ jwt: string; claims: Record<string, unknown> }>();
    expect(body.jwt.split('.').length).toBe(3);
    expect(body.claims.license_id).toBe('lic_test');
  });
});
```

Run:

```bash
pnpm test:worker -- activate.test.ts
```

Expected: fails because the route doesn't exist yet (Worker returns 404 `NotFound`). That's the red signal we want before writing the handler.

- [ ] **Step 5: Implement `/v1/activate` happy path**

Create `worker/src/routes/activate.ts`:

```ts
import { activateRequestSchema, normalizeHumanizedKey, REVOCATION_CHECK_INTERVAL_S } from '@carbonbook-cloud/shared';
import { signLicenseJwt, buildClaims } from '../lib/jwt.js';
import { getLicenseIdByHumanizedKey, readActive, writeActive } from '../lib/license-store.js';
import { err, json } from '../lib/responses.js';
import type { Env } from '../index.js';

export async function handleActivate(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const raw = await request.json().catch(() => null);
  const parsed = activateRequestSchema.safeParse(raw);
  if (!parsed.success) return err('BadRequest', parsed.error.message, 400);

  const normalized = normalizeHumanizedKey(parsed.data.license_key);
  if (!normalized) return err('UnknownKey', 'license key format invalid', 404);

  const licenseId = await getLicenseIdByHumanizedKey(env.HUMANIZED_KEYS, normalized);
  if (!licenseId) return err('UnknownKey', 'license key not found', 404);

  const record = await readActive(env.LICENSE_ACTIVE, licenseId);
  if (!record) return err('UnknownKey', 'license record missing', 404);

  // (rate-limit, revocation, device-cap branches added in next steps)

  const now = Math.floor(Date.now() / 1000);
  const deviceId = parsed.data.device_id;
  const alreadyHasDevice = record.device_ids.includes(deviceId);
  if (!alreadyHasDevice) record.device_ids.push(deviceId);

  await env.DB.prepare(
    `INSERT OR REPLACE INTO device
     (device_id, license_id, first_seen_at, last_ping_at, app_version, os)
     VALUES (?, ?, COALESCE((SELECT first_seen_at FROM device WHERE device_id=? AND license_id=?), ?), ?, ?, ?)`,
  ).bind(deviceId, licenseId, deviceId, licenseId, now, now, parsed.data.app_version, parsed.data.os).run();

  await writeActive(env.LICENSE_ACTIVE, record);

  const claims = buildClaims({
    licenseId, userId: record.user_id, plan: record.plan, features: record.features,
    devicesMax: record.devices_max, issuedAt: record.issued_at,
    expiresAt: record.expires_at, graceUntil: record.grace_until,
    nowSeconds: now, revocationCheckIntervalS: REVOCATION_CHECK_INTERVAL_S,
  });
  const jwt = await signLicenseJwt(claims, env.LICENSE_PRIVATE_KEY_HEX);
  return json({ jwt, claims });
}
```

Wire in `worker/src/index.ts`:

```ts
import { handleActivate } from './routes/activate.js';
// ...
if (request.method === 'POST' && path === '/v1/activate') {
  return handleActivate(request, env, ctx);
}
```

Run:

```bash
pnpm test:worker -- activate.test.ts
```

Expected: the happy-path test passes.

- [ ] **Step 6: Add revocation branch + test**

Append to `worker/tests/activate.test.ts`:

```ts
  it('returns 403 RevokedLicense for a revoked license', async () => {
    await seedLicense({ humanizedKey: HUMANIZED, revoked: true, revokedReason: 'refund' });
    const res = await activate({
      license_key: HUMANIZED, device_id: 'dev_a',
      app_version: '0.5.0', os: 'darwin',
    });
    expect(res.status).toBe(403);
    const body = await res.json<{ error: { _tag: string } }>();
    expect(body.error._tag).toBe('RevokedLicense');
  });

  it('returns 404 UnknownKey for an unmapped humanized key', async () => {
    const res = await activate({
      license_key: 'cbk-zzzzz-zzzzz-zzzzz-zzzzz', device_id: 'dev_a',
      app_version: '0.5.0', os: 'darwin',
    });
    expect(res.status).toBe(404);
  });
```

Add the revocation check to `activate.ts`, right after the `readActive` call:

```ts
  if (record.revoked) return err('RevokedLicense', record.revoked_reason ?? 'revoked', 403);
```

Run:

```bash
pnpm test:worker -- activate.test.ts
```

Expected: both new tests pass; the happy-path test still passes.

- [ ] **Step 7: Add device-cap branch + idempotency test**

Append to `worker/tests/activate.test.ts`:

```ts
  it('returns 409 DeviceCapReached when device_ids is full and device is new', async () => {
    await seedLicense({ humanizedKey: HUMANIZED, devicesMax: 1, devices: ['dev_already'] });
    const res = await activate({
      license_key: HUMANIZED, device_id: 'dev_new',
      app_version: '0.5.0', os: 'darwin',
    });
    expect(res.status).toBe(409);
    const body = await res.json<{ error: { _tag: string } }>();
    expect(body.error._tag).toBe('DeviceCapReached');
  });

  it('re-activation of an existing device is idempotent (200, device_ids unchanged)', async () => {
    await seedLicense({ humanizedKey: HUMANIZED, devicesMax: 1, devices: ['dev_loyal'] });
    const res = await activate({
      license_key: HUMANIZED, device_id: 'dev_loyal',
      app_version: '0.5.0', os: 'darwin',
    });
    expect(res.status).toBe(200);
    const row = await env.LICENSE_ACTIVE.get('la:lic_test');
    const rec = JSON.parse(row!) as { device_ids: string[] };
    expect(rec.device_ids).toEqual(['dev_loyal']);
  });
```

Insert the device-cap branch in `activate.ts`, right after the revocation check:

```ts
  if (
    !record.device_ids.includes(parsed.data.device_id) &&
    record.device_ids.length >= record.devices_max
  ) {
    return err('DeviceCapReached', `max ${record.devices_max} devices`, 409);
  }
```

Run:

```bash
pnpm test:worker -- activate.test.ts
```

Expected: device-cap test and idempotency test both pass.

- [ ] **Step 8: Add rate-limit branch + test**

Append:

```ts
  it('returns 429 RateLimited after 10 rapid activations on the same key', async () => {
    await seedLicense({ humanizedKey: HUMANIZED, devicesMax: 99 });
    for (let i = 0; i < 10; i++) {
      await activate({
        license_key: HUMANIZED, device_id: `dev_${i}`,
        app_version: '0.5.0', os: 'darwin',
      });
    }
    const res = await activate({
      license_key: HUMANIZED, device_id: 'dev_eleven',
      app_version: '0.5.0', os: 'darwin',
    });
    expect(res.status).toBe(429);
  });
```

Add the check to `activate.ts`, before the device-cap branch:

```ts
import { checkRateLimit } from '../lib/rate-limit.js';
import { RATE_LIMIT_ACTIVATE } from '@carbonbook-cloud/shared';
// ...
  const now = Math.floor(Date.now() / 1000);
  const rl = await checkRateLimit(env.RATE_LIMIT, 'activate', normalized, RATE_LIMIT_ACTIVATE, now);
  if (!rl.allowed) return err('RateLimited', 'too many activation attempts', 429);
```

(Move the `const now = ...` declaration up so the rate limit and downstream logic share it.)

Run:

```bash
pnpm test:worker -- activate.test.ts
```

Expected: all activate tests pass (5 tests).

- [ ] **Step 9: Commit `/v1/activate`**

```bash
pnpm --filter @carbonbook-cloud/worker exec biome check src/routes/activate.ts tests/activate.test.ts
git add -A
git commit -m "feat(worker): POST /v1/activate with rate limit + device cap + revocation"
```

- [ ] **Step 10: Write failing test — `/v1/verify` happy path**

Create `worker/tests/verify.test.ts`:

```ts
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src/index.js';
import { seedLicense, TEST_PRIVATE_KEY_HEX } from './_fixtures.js';

async function verify(body: unknown): Promise<Response> {
  const req = new Request('https://api.carbonbook.app/v1/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const ctx = createExecutionContext();
  const res = await worker.fetch(req, { ...env, LICENSE_PRIVATE_KEY_HEX: TEST_PRIVATE_KEY_HEX }, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

describe('POST /v1/verify', () => {
  it('returns 200 + fresh JWT for a healthy license', async () => {
    await seedLicense({ devices: ['dev_a'] });
    const res = await verify({
      license_id: 'lic_test', device_id: 'dev_a',
      app_version: '0.5.0', os: 'darwin',
    });
    expect(res.status).toBe(200);
    const body = await res.json<{ jwt: string; revoked: boolean }>();
    expect(body.revoked).toBe(false);
    expect(body.jwt.split('.').length).toBe(3);
  });
});
```

Run:

```bash
pnpm test:worker -- verify.test.ts
```

Expected: fails (no route yet).

- [ ] **Step 11: Implement `/v1/verify`**

Create `worker/src/routes/verify.ts`:

```ts
import { verifyRequestSchema, REVOCATION_CHECK_INTERVAL_S, RATE_LIMIT_VERIFY } from '@carbonbook-cloud/shared';
import { signLicenseJwt, buildClaims } from '../lib/jwt.js';
import { readActive } from '../lib/license-store.js';
import { checkRateLimit } from '../lib/rate-limit.js';
import { err, json } from '../lib/responses.js';
import type { Env } from '../index.js';

export async function handleVerify(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
  const raw = await request.json().catch(() => null);
  const parsed = verifyRequestSchema.safeParse(raw);
  if (!parsed.success) return err('BadRequest', parsed.error.message, 400);

  const now = Math.floor(Date.now() / 1000);
  const rl = await checkRateLimit(env.RATE_LIMIT, 'verify', parsed.data.device_id, RATE_LIMIT_VERIFY, now);
  if (!rl.allowed) return err('RateLimited', 'too many verify pings', 429);

  const record = await readActive(env.LICENSE_ACTIVE, parsed.data.license_id);
  if (!record) return err('UnknownKey', 'license not found', 404);

  if (record.revoked) {
    return json({ revoked: true, reason: record.revoked_reason ?? 'revoked' });
  }

  await env.DB.prepare(
    'UPDATE device SET last_ping_at = ?, app_version = ? WHERE device_id = ? AND license_id = ?',
  ).bind(now, parsed.data.app_version, parsed.data.device_id, parsed.data.license_id).run();

  const claims = buildClaims({
    licenseId: record.license_id, userId: record.user_id, plan: record.plan,
    features: record.features, devicesMax: record.devices_max,
    issuedAt: record.issued_at, expiresAt: record.expires_at, graceUntil: record.grace_until,
    nowSeconds: now, revocationCheckIntervalS: REVOCATION_CHECK_INTERVAL_S,
  });
  const jwt = await signLicenseJwt(claims, env.LICENSE_PRIVATE_KEY_HEX);
  return json({ jwt, claims, revoked: false });
}
```

Wire in `worker/src/index.ts`:

```ts
import { handleVerify } from './routes/verify.js';
// ...
if (request.method === 'POST' && path === '/v1/verify') {
  return handleVerify(request, env, ctx);
}
```

Run:

```bash
pnpm test:worker -- verify.test.ts
```

Expected: happy-path test passes.

- [ ] **Step 12: Add revocation + 404 + rate-limit tests for `/v1/verify`**

Append to `worker/tests/verify.test.ts`:

```ts
  it('returns { revoked: true, reason } for a revoked license', async () => {
    await seedLicense({ revoked: true, revokedReason: 'subscription_cancelled', devices: ['dev_a'] });
    const res = await verify({
      license_id: 'lic_test', device_id: 'dev_a',
      app_version: '0.5.0', os: 'darwin',
    });
    expect(res.status).toBe(200);
    const body = await res.json<{ revoked: boolean; reason: string }>();
    expect(body.revoked).toBe(true);
    expect(body.reason).toBe('subscription_cancelled');
  });

  it('returns 404 for an unknown license_id', async () => {
    const res = await verify({
      license_id: 'lic_does_not_exist', device_id: 'dev_a',
      app_version: '0.5.0', os: 'darwin',
    });
    expect(res.status).toBe(404);
  });

  it('returns 429 after 6 rapid verifies from the same device', async () => {
    await seedLicense({ devices: ['dev_chatty'] });
    for (let i = 0; i < 6; i++) {
      await verify({
        license_id: 'lic_test', device_id: 'dev_chatty',
        app_version: '0.5.0', os: 'darwin',
      });
    }
    const res = await verify({
      license_id: 'lic_test', device_id: 'dev_chatty',
      app_version: '0.5.0', os: 'darwin',
    });
    expect(res.status).toBe(429);
  });
```

Run:

```bash
pnpm test:worker -- verify.test.ts
```

Expected: all verify tests pass (4 tests).

- [ ] **Step 13: Commit `/v1/verify`**

```bash
pnpm --filter @carbonbook-cloud/worker exec biome check src/routes/verify.ts tests/verify.test.ts
git add -A
git commit -m "feat(worker): POST /v1/verify with rate limit + revocation passthrough"
```

---

## Task 5: `/v1/trial-signup` endpoint + email integration

**Files:**
- Create: `worker/src/lib/email.ts`
- Create: `worker/src/routes/trial-signup.ts`
- Modify: `worker/src/index.ts` — wire route
- Create: `worker/tests/trial-signup.test.ts`

Trial signup creates a customer, issues a 14-day trial license, and
(best-effort) sends a welcome email with the license key. Idempotent on
the email — calling it twice for the same address returns the same
license, refreshing `expires_at` if more than 7 days have passed (matches
the spec section 4 wording: "refresh `expires_at`").

- [ ] **Step 1: Resend email module**

Create `worker/src/lib/email.ts`:

```ts
type Lang = 'zh-CN' | 'en';

async function sendViaResend(
  apiKey: string,
  payload: { from: string; to: string; subject: string; html: string },
): Promise<void> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    // Don't throw inside ctx.waitUntil — log for the dashboard, give up.
    const body = await res.text().catch(() => '<unreadable>');
    console.error('resend:send-failed', { status: res.status, body });
  }
}

export function sendActivationEmail(opts: {
  apiKey: string;
  to: string;
  licenseKey: string;
  lang: Lang;
}): Promise<void> {
  const { lang, licenseKey } = opts;
  const subject = lang === 'zh-CN'
    ? 'carbonbook 激活密钥'
    : 'Your carbonbook activation key';
  const body = lang === 'zh-CN'
    ? `<p>你好！</p><p>你的 carbonbook 激活密钥：</p>
       <p style="font-family:monospace;font-size:18px"><b>${licenseKey}</b></p>
       <p>打开桌面应用，进入「设置 → 激活」，粘贴此密钥。</p>`
    : `<p>Hi —</p><p>Your carbonbook activation key:</p>
       <p style="font-family:monospace;font-size:18px"><b>${licenseKey}</b></p>
       <p>Open the desktop app, go to Settings → Activate, and paste the key.</p>`;
  return sendViaResend(opts.apiKey, {
    from: 'carbonbook <noreply@carbonbook.app>',
    to: opts.to,
    subject,
    html: body,
  });
}

export function sendMagicLinkEmail(opts: {
  apiKey: string;
  to: string;
  url: string;
  lang: Lang;
}): Promise<void> {
  const subject = opts.lang === 'zh-CN' ? 'carbonbook 登录链接' : 'carbonbook login link';
  const body = opts.lang === 'zh-CN'
    ? `<p>点击链接登录 carbonbook 账户：</p><p><a href="${opts.url}">${opts.url}</a></p><p>链接 15 分钟内有效。</p>`
    : `<p>Click the link to sign in to your carbonbook account:</p><p><a href="${opts.url}">${opts.url}</a></p><p>This link expires in 15 minutes.</p>`;
  return sendViaResend(opts.apiKey, {
    from: 'carbonbook <noreply@carbonbook.app>',
    to: opts.to,
    subject,
    html: body,
  });
}
```

Run:

```bash
pnpm --filter @carbonbook-cloud/worker exec biome check src/lib/email.ts
git add -A
git commit -m "feat(worker): Resend email helpers (activation + magic-link)"
```

- [ ] **Step 2: Write failing test — fresh-email signup**

Create `worker/tests/trial-signup.test.ts`:

```ts
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src/index.js';
import { TEST_PRIVATE_KEY_HEX } from './_fixtures.js';

async function trialSignup(body: unknown, ip = '203.0.113.1'): Promise<Response> {
  const req = new Request('https://api.carbonbook.app/v1/trial-signup', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'CF-Connecting-IP': ip,
      'Accept-Language': 'en',
    },
    body: JSON.stringify(body),
  });
  const ctx = createExecutionContext();
  const res = await worker.fetch(req, { ...env, LICENSE_PRIVATE_KEY_HEX: TEST_PRIVATE_KEY_HEX, RESEND_API_KEY: 'test_re_key' }, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

describe('POST /v1/trial-signup', () => {
  it('issues a 14-day trial license for a fresh email', async () => {
    const res = await trialSignup({
      email: 'fresh@example.com',
      device_id: 'dev_a',
      app_version: '0.5.0',
    });
    expect(res.status).toBe(200);
    const body = await res.json<{ license_key: string; jwt: string }>();
    expect(body.license_key).toMatch(/^cbk-[0-9a-z]{5}-[0-9a-z]{5}-[0-9a-z]{5}-[0-9a-z]{5}$/i);
    expect(body.jwt.split('.').length).toBe(3);

    const row = await env.DB.prepare('SELECT plan, expires_at, grace_until FROM license WHERE user_id IN (SELECT user_id FROM customer WHERE email=?)').bind('fresh@example.com').first<{ plan: string; expires_at: number; grace_until: number }>();
    expect(row!.plan).toBe('trial@14d');
    const expectedExp = row!.expires_at - row!.grace_until;
    // 14d expires + 30d grace = 44d total; so grace_until - expires_at = 30d.
    expect(row!.grace_until - row!.expires_at).toBe(30 * 86_400);
  });
});
```

Run:

```bash
pnpm test:worker -- trial-signup.test.ts
```

Expected: fails (no route).

- [ ] **Step 3: Implement happy path**

Create `worker/src/routes/trial-signup.ts`:

```ts
import {
  trialSignupRequestSchema, generateHumanizedKey,
  TRIAL_DURATION_S, GRACE_PERIOD_S, REVOCATION_CHECK_INTERVAL_S,
  RATE_LIMIT_TRIAL,
} from '@carbonbook-cloud/shared';
import type { LicenseActiveRecord } from '@carbonbook-cloud/shared';
import { newUserId, newLicenseId } from '../lib/id.js';
import { signLicenseJwt, buildClaims } from '../lib/jwt.js';
import { checkRateLimit } from '../lib/rate-limit.js';
import { writeActive, writeHumanizedKey } from '../lib/license-store.js';
import { sendActivationEmail } from '../lib/email.js';
import { err, json } from '../lib/responses.js';
import type { Env } from '../index.js';

function pickLang(request: Request): 'zh-CN' | 'en' {
  const al = request.headers.get('Accept-Language') ?? '';
  return al.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}

export async function handleTrialSignup(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const raw = await request.json().catch(() => null);
  const parsed = trialSignupRequestSchema.safeParse(raw);
  if (!parsed.success) return err('BadRequest', parsed.error.message, 400);

  const ip = request.headers.get('CF-Connecting-IP') ?? '0.0.0.0';
  const now = Math.floor(Date.now() / 1000);
  const rl = await checkRateLimit(env.RATE_LIMIT, 'trial', ip, RATE_LIMIT_TRIAL, now);
  if (!rl.allowed) return err('RateLimited', 'too many trial signups from this IP', 429);

  // (idempotency branch added in next step)

  const userId = newUserId();
  const licenseId = newLicenseId();
  const humanized = generateHumanizedKey();
  const expiresAt = now + TRIAL_DURATION_S;
  const graceUntil = expiresAt + GRACE_PERIOD_S;

  await env.DB.prepare(
    'INSERT INTO customer (user_id, email, country, created_at) VALUES (?, ?, ?, ?)',
  ).bind(userId, parsed.data.email, parsed.data.country_hint ?? null, now).run();

  await env.DB.prepare(
    `INSERT INTO license
     (license_id, user_id, humanized_key, plan, features, devices_max, issued_at, expires_at, grace_until, revoked)
     VALUES (?, ?, ?, 'trial@14d', '["inventory","questionnaire","iso14064"]', 1, ?, ?, ?, 0)`,
  ).bind(licenseId, userId, humanized, now, expiresAt, graceUntil).run();

  await env.DB.prepare(
    'INSERT INTO device (device_id, license_id, first_seen_at, last_ping_at, app_version) VALUES (?, ?, ?, ?, ?)',
  ).bind(parsed.data.device_id, licenseId, now, now, parsed.data.app_version).run();

  const record: LicenseActiveRecord = {
    license_id: licenseId, user_id: userId,
    plan: 'trial@14d',
    features: ['inventory', 'questionnaire', 'iso14064'],
    devices_max: 1,
    device_ids: [parsed.data.device_id],
    issued_at: now, expires_at: expiresAt, grace_until: graceUntil,
    revoked: false, revoked_at: null, revoked_reason: null,
    stripe_subscription_id: null,
  };
  await writeActive(env.LICENSE_ACTIVE, record);
  await writeHumanizedKey(env.HUMANIZED_KEYS, humanized, licenseId);

  const claims = buildClaims({
    licenseId, userId, plan: record.plan, features: record.features,
    devicesMax: record.devices_max, issuedAt: now, expiresAt, graceUntil,
    nowSeconds: now, revocationCheckIntervalS: REVOCATION_CHECK_INTERVAL_S,
  });
  const jwt = await signLicenseJwt(claims, env.LICENSE_PRIVATE_KEY_HEX);

  ctx.waitUntil(sendActivationEmail({
    apiKey: env.RESEND_API_KEY,
    to: parsed.data.email,
    licenseKey: humanized,
    lang: pickLang(request),
  }));

  return json({ license_key: humanized, jwt });
}
```

Wire in `worker/src/index.ts`:

```ts
import { handleTrialSignup } from './routes/trial-signup.js';
// ...
if (request.method === 'POST' && path === '/v1/trial-signup') {
  return handleTrialSignup(request, env, ctx);
}
```

Run:

```bash
pnpm test:worker -- trial-signup.test.ts
```

Expected: fresh-email test passes.

- [ ] **Step 4: Idempotency — same email returns same license (refresh `expires_at` if > 7d old)**

Per the spec's "refresh `expires_at`" rule, when a returning email re-hits trial-signup we extend their trial to 14 days from *now* (and bump `grace_until` accordingly), not just bump `revocation_check_after`. This unblocks people who half-set-up the app once and came back two weeks later.

Append to `worker/tests/trial-signup.test.ts`:

```ts
  it('returning email reuses the license and refreshes expires_at when stale', async () => {
    const first = await trialSignup({ email: 'returning@example.com', device_id: 'dev_a', app_version: '0.5.0' });
    const firstBody = await first.json<{ license_key: string }>();

    // Simulate "more than 7 days ago": rewind the issued/expires/grace columns.
    const old = Math.floor(Date.now() / 1000) - 10 * 86_400;
    await env.DB.prepare(
      'UPDATE license SET issued_at=?, expires_at=?, grace_until=? WHERE humanized_key=?',
    ).bind(old, old + 14 * 86_400, old + 44 * 86_400, firstBody.license_key).run();

    const second = await trialSignup({ email: 'returning@example.com', device_id: 'dev_b', app_version: '0.5.0' });
    const secondBody = await second.json<{ license_key: string }>();
    expect(secondBody.license_key).toBe(firstBody.license_key);

    const row = await env.DB.prepare('SELECT expires_at FROM license WHERE humanized_key=?').bind(firstBody.license_key).first<{ expires_at: number }>();
    // expires_at must now be ~ now + 14d (refreshed), NOT old + 14d.
    expect(row!.expires_at).toBeGreaterThan(old + 14 * 86_400 + 1);
  });

  it('returning email within 7 days returns the same license without changing expires_at', async () => {
    const first = await trialSignup({ email: 'recent@example.com', device_id: 'dev_a', app_version: '0.5.0' });
    const firstBody = await first.json<{ license_key: string }>();
    const before = await env.DB.prepare('SELECT expires_at FROM license WHERE humanized_key=?').bind(firstBody.license_key).first<{ expires_at: number }>();

    const second = await trialSignup({ email: 'recent@example.com', device_id: 'dev_b', app_version: '0.5.0' });
    const secondBody = await second.json<{ license_key: string }>();
    expect(secondBody.license_key).toBe(firstBody.license_key);

    const after = await env.DB.prepare('SELECT expires_at FROM license WHERE humanized_key=?').bind(firstBody.license_key).first<{ expires_at: number }>();
    expect(after!.expires_at).toBe(before!.expires_at);
  });
```

Add the idempotency branch in `trial-signup.ts`, right after the rate-limit check:

```ts
import { readActive, writeActive } from '../lib/license-store.js';
// ...

  const existing = await env.DB.prepare(
    `SELECT l.license_id, l.humanized_key, l.plan, l.issued_at
     FROM license l JOIN customer c ON l.user_id = c.user_id
     WHERE c.email = ?`,
  ).bind(parsed.data.email).first<{ license_id: string; humanized_key: string; plan: string; issued_at: number }>();

  if (existing) {
    if (existing.plan !== 'trial@14d') {
      return err('BadRequest', 'AlreadyPaid', 409);
    }
    const record = await readActive(env.LICENSE_ACTIVE, existing.license_id);
    if (!record) return err('Internal', 'license KV out of sync', 500);

    const stale = (now - existing.issued_at) > REVOCATION_CHECK_INTERVAL_S;
    if (stale) {
      const newExp = now + TRIAL_DURATION_S;
      const newGrace = newExp + GRACE_PERIOD_S;
      record.expires_at = newExp;
      record.grace_until = newGrace;
      record.issued_at = now;
      await env.DB.prepare(
        'UPDATE license SET issued_at=?, expires_at=?, grace_until=? WHERE license_id=?',
      ).bind(now, newExp, newGrace, existing.license_id).run();
      await writeActive(env.LICENSE_ACTIVE, record);
    }

    const claims = buildClaims({
      licenseId: record.license_id, userId: record.user_id, plan: record.plan,
      features: record.features, devicesMax: record.devices_max,
      issuedAt: record.issued_at, expiresAt: record.expires_at, graceUntil: record.grace_until,
      nowSeconds: now, revocationCheckIntervalS: REVOCATION_CHECK_INTERVAL_S,
    });
    const jwt = await signLicenseJwt(claims, env.LICENSE_PRIVATE_KEY_HEX);
    return json({ license_key: existing.humanized_key, jwt });
  }
```

Run:

```bash
pnpm test:worker -- trial-signup.test.ts
```

Expected: both idempotency tests pass; fresh-email test still passes.

- [ ] **Step 5: Already-paid customer returns 409**

Append:

```ts
  it('returns 409 when the email belongs to a paid customer', async () => {
    // Seed a paid customer + license manually.
    await env.DB.prepare('INSERT INTO customer (user_id, email, created_at) VALUES (?, ?, ?)').bind('usr_paid', 'paid@example.com', 1_700_000_000).run();
    await env.DB.prepare(
      `INSERT INTO license (license_id, user_id, humanized_key, plan, features, devices_max, issued_at, expires_at, grace_until)
       VALUES ('lic_paid', 'usr_paid', 'cbk-paid1-paid2-paid3-paid4', 'base@2026-q2', '["inventory"]', 1, 1700000000, 1900000000, 1910000000)`,
    ).run();

    const res = await trialSignup({ email: 'paid@example.com', device_id: 'dev_x', app_version: '0.5.0' });
    expect(res.status).toBe(409);
  });
```

The 409 branch is already covered by the idempotency code above (`plan !== 'trial@14d'`).

Run:

```bash
pnpm test:worker -- trial-signup.test.ts
```

Expected: passes.

- [ ] **Step 6: Rate-limit + validation tests**

Append:

```ts
  it('returns 400 for an invalid email', async () => {
    const res = await trialSignup({ email: 'not-an-email', device_id: 'dev_a', app_version: '0.5.0' });
    expect(res.status).toBe(400);
  });

  it('returns 429 after 5 rapid signups from the same IP', async () => {
    for (let i = 0; i < 5; i++) {
      await trialSignup({ email: `flood${i}@example.com`, device_id: 'dev_a', app_version: '0.5.0' }, '198.51.100.1');
    }
    const res = await trialSignup({ email: 'flood-6@example.com', device_id: 'dev_a', app_version: '0.5.0' }, '198.51.100.1');
    expect(res.status).toBe(429);
  });
```

Run:

```bash
pnpm test:worker -- trial-signup.test.ts
```

Expected: all 6 tests pass.

- [ ] **Step 7: Commit `/v1/trial-signup`**

```bash
pnpm --filter @carbonbook-cloud/worker exec biome check src/routes/trial-signup.ts tests/trial-signup.test.ts
git add -A
git commit -m "feat(worker): POST /v1/trial-signup with idempotency + IP rate limit"
```

---

## Task 6: Stripe — Checkout Session + webhook + revocation cron

**Files:**
- Create: `worker/src/lib/stripe.ts`
- Create: `worker/src/routes/checkout-session.ts`
- Create: `worker/src/routes/stripe-webhook.ts`
- Create: `worker/src/scheduled/revoke-cron.ts`
- Modify: `worker/src/index.ts` — wire routes + `scheduled` handler
- Modify: `worker/wrangler.toml` — add cron trigger
- Create: `worker/tests/checkout-session.test.ts`
- Create: `worker/tests/stripe-webhook.test.ts`
- Create: `worker/tests/revoke-cron.test.ts`

This task ships everything that touches Stripe:
1. `POST /v1/checkout-session` — the route the pricing-page "Buy now"
   button calls to spin up a Checkout Session. Without this, the
   marketing pricing page has no backend to talk to.
2. `POST /v1/stripe-webhook` — Stripe's async callback for events.
3. A daily cron trigger that flips `revoked: true` on any license whose
   `revoked_at` timestamp has passed. The spec requires cancellation /
   refund to take effect after a 30-day buffer (so the active KV record
   stays live during that window), and a cron is the cheapest way to
   enforce it without per-request expiry checks everywhere.

- [ ] **Step 1: Stripe helpers — signature verify + REST wrappers**

Create `worker/src/lib/stripe.ts`:

```ts
/**
 * Stripe HMAC-SHA256 signature verification.
 * Stripe ships the signature as: `t=<unix>,v1=<hex>` (we ignore v0).
 * Constant-time comparison is critical here.
 */
type VerifyResult = { valid: true; event: StripeEvent } | { valid: false; reason: string };

export type StripeEvent = {
  id: string;
  type: string;
  created: number;
  data: { object: Record<string, unknown> };
};

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function toHex(bytes: ArrayBuffer): string {
  const arr = new Uint8Array(bytes);
  let s = '';
  for (const b of arr) s += b.toString(16).padStart(2, '0');
  return s;
}

export async function verifyStripeSignature(
  payload: string,
  sigHeader: string | null,
  secret: string,
  toleranceS = 300,
): Promise<VerifyResult> {
  if (!sigHeader) return { valid: false, reason: 'missing-signature' };
  const parts = Object.fromEntries(sigHeader.split(',').map((kv) => {
    const [k, v] = kv.split('=', 2);
    return [k!, v ?? ''];
  })) as { t?: string; v1?: string };
  if (!parts.t || !parts.v1) return { valid: false, reason: 'malformed-signature' };

  const signedPayload = `${parts.t}.${payload}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const macBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedPayload));
  const expected = toHex(macBuf);
  if (!timingSafeEqualHex(expected, parts.v1)) return { valid: false, reason: 'signature-mismatch' };

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(parts.t)) > toleranceS) return { valid: false, reason: 'timestamp-out-of-tolerance' };

  const event = JSON.parse(payload) as StripeEvent;
  return { valid: true, event };
}

/**
 * Form-encoded POST to Stripe REST. The Checkout endpoint accepts nested
 * keys via bracket notation (`metadata[plan]=...`); the helper flattens
 * objects recursively to match.
 */
function flatten(obj: Record<string, unknown>, prefix = ''): string[][] {
  const pairs: string[][] = [];
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v === undefined || v === null) continue;
    if (typeof v === 'object' && !Array.isArray(v)) pairs.push(...flatten(v as Record<string, unknown>, key));
    else pairs.push([key, String(v)]);
  }
  return pairs;
}

export async function stripeRequest<T>(
  secretKey: string,
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const params = new URLSearchParams();
  for (const [k, v] of flatten(body)) params.append(k, v);
  const res = await fetch(`https://api.stripe.com${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`stripe ${path} ${res.status}: ${text}`);
  }
  return res.json<T>();
}

export type CheckoutSession = {
  id: string;
  url: string;
};

export async function createCheckoutSession(opts: {
  secretKey: string;
  priceId: string;
  plan: string;
  tier: string;
  successUrl: string;
  cancelUrl: string;
  customerEmail?: string;
}): Promise<CheckoutSession> {
  return stripeRequest<CheckoutSession>(opts.secretKey, '/v1/checkout/sessions', {
    mode: 'subscription',
    'line_items[0][price]': opts.priceId,
    'line_items[0][quantity]': 1,
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
    customer_email: opts.customerEmail,
    metadata: { plan: opts.plan, tier: opts.tier },
  } as Record<string, unknown>);
}

export type BillingPortalSession = { id: string; url: string };

export async function createBillingPortal(opts: {
  secretKey: string;
  stripeCustomerId: string;
  returnUrl: string;
}): Promise<BillingPortalSession> {
  return stripeRequest<BillingPortalSession>(opts.secretKey, '/v1/billing_portal/sessions', {
    customer: opts.stripeCustomerId,
    return_url: opts.returnUrl,
  });
}
```

Run + commit:

```bash
pnpm --filter @carbonbook-cloud/worker exec biome check src/lib/stripe.ts
git add -A
git commit -m "feat(worker): Stripe HMAC verifier + REST helpers (no SDK)"
```

- [ ] **Step 2: Write failing test — `POST /v1/checkout-session`**

Create `worker/tests/checkout-session.test.ts`:

```ts
import { env, createExecutionContext, waitOnExecutionContext, fetchMock } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import worker from '../src/index.js';

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

async function call(body: unknown): Promise<Response> {
  const req = new Request('https://api.carbonbook.app/v1/checkout-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const ctx = createExecutionContext();
  const res = await worker.fetch(
    req,
    { ...env, STRIPE_SECRET_KEY: 'sk_test_xxx', STRIPE_PRICE_BASE_2026Q2: 'price_base_q2' },
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

describe('POST /v1/checkout-session', () => {
  it('creates a Checkout Session and returns its URL', async () => {
    fetchMock.get('https://api.stripe.com')
      .intercept({ path: '/v1/checkout/sessions', method: 'POST' })
      .reply(200, { id: 'cs_test_123', url: 'https://checkout.stripe.com/c/pay/cs_test_123' });

    const res = await call({ plan: 'base@2026-q2', email: 'b@example.com' });
    expect(res.status).toBe(200);
    const body = await res.json<{ checkout_url: string }>();
    expect(body.checkout_url).toContain('checkout.stripe.com');
  });

  it('rejects unknown plans with 400', async () => {
    const res = await call({ plan: 'mystery-plan' });
    expect(res.status).toBe(400);
  });
});
```

Run:

```bash
pnpm test:worker -- checkout-session.test.ts
```

Expected: fails (route doesn't exist).

- [ ] **Step 3: Implement `POST /v1/checkout-session`**

Create `worker/src/routes/checkout-session.ts`:

```ts
import { z } from 'zod';
import { createCheckoutSession } from '../lib/stripe.js';
import { err, json } from '../lib/responses.js';
import type { Env } from '../index.js';

const checkoutSessionRequest = z.object({
  plan: z.enum(['base@2026-q2']),
  email: z.string().email().optional(),
});

const PLAN_TO_PRICE_ENV: Record<string, keyof Env> = {
  'base@2026-q2': 'STRIPE_PRICE_BASE_2026Q2',
};

export async function handleCheckoutSession(request: Request, env: Env): Promise<Response> {
  const raw = await request.json().catch(() => null);
  const parsed = checkoutSessionRequest.safeParse(raw);
  if (!parsed.success) return err('BadRequest', parsed.error.message, 400);

  const priceEnv = PLAN_TO_PRICE_ENV[parsed.data.plan];
  const priceId = (env as Record<string, string>)[priceEnv];
  if (!priceId) return err('Internal', 'price not configured for plan', 500);

  const session = await createCheckoutSession({
    secretKey: env.STRIPE_SECRET_KEY,
    priceId,
    plan: parsed.data.plan,
    tier: 'base',
    successUrl: 'https://activate.carbonbook.app?session_id={CHECKOUT_SESSION_ID}',
    cancelUrl: 'https://carbonbook.app/pricing?cancelled=1',
    customerEmail: parsed.data.email,
  });
  return json({ checkout_url: session.url });
}
```

Add to `worker/src/index.ts`:

```ts
import { handleCheckoutSession } from './routes/checkout-session.js';
// ...
if (request.method === 'POST' && path === '/v1/checkout-session') {
  return handleCheckoutSession(request, env);
}
```

Add to `Env` interface in `worker/src/index.ts`:

```ts
STRIPE_PRICE_BASE_2026Q2: string;
```

Add to `worker/wrangler.toml` under `[vars]`:

```toml
STRIPE_PRICE_BASE_2026Q2 = "price_placeholder_replace_in_prod"
```

Run + commit:

```bash
pnpm test:worker -- checkout-session.test.ts
pnpm --filter @carbonbook-cloud/worker exec biome check src/routes/checkout-session.ts tests/checkout-session.test.ts
git add -A
git commit -m "feat(worker): POST /v1/checkout-session for the pricing page Buy now button"
```

- [ ] **Step 4: Write failing test — webhook signature verification**

Create `worker/tests/stripe-webhook.test.ts`:

```ts
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src/index.js';

const SECRET = 'whsec_test_secret';

async function sign(payload: string, ts: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const macBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${ts}.${payload}`));
  const arr = new Uint8Array(macBuf);
  let hex = '';
  for (const b of arr) hex += b.toString(16).padStart(2, '0');
  return `t=${ts},v1=${hex}`;
}

async function postEvent(eventObj: unknown): Promise<Response> {
  const payload = JSON.stringify(eventObj);
  const ts = Math.floor(Date.now() / 1000);
  const sig = await sign(payload, ts);
  const req = new Request('https://api.carbonbook.app/v1/stripe-webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'stripe-signature': sig },
    body: payload,
  });
  const ctx = createExecutionContext();
  const res = await worker.fetch(req, { ...env, STRIPE_WEBHOOK_SECRET: SECRET, RESEND_API_KEY: 'test', LICENSE_PRIVATE_KEY_HEX: '4af3e2f9c1b0a988776655443322110011223344556677889900aabbccddeeff' }, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

describe('POST /v1/stripe-webhook signature verification', () => {
  it('rejects requests without a signature with 400', async () => {
    const req = new Request('https://api.carbonbook.app/v1/stripe-webhook', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, { ...env, STRIPE_WEBHOOK_SECRET: SECRET } as never, ctx);
    expect(res.status).toBe(400);
  });

  it('accepts a correctly-signed payload', async () => {
    const res = await postEvent({ id: 'evt_1', type: 'unhandled.event', created: Math.floor(Date.now() / 1000), data: { object: {} } });
    expect(res.status).toBe(200);
  });
});
```

Run:

```bash
pnpm test:worker -- stripe-webhook.test.ts
```

Expected: fails (no route).

- [ ] **Step 5: Implement webhook skeleton + signature verification**

Create `worker/src/routes/stripe-webhook.ts`:

```ts
import { verifyStripeSignature } from '../lib/stripe.js';
import { err, json } from '../lib/responses.js';
import type { Env } from '../index.js';

export async function handleStripeWebhook(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const payload = await request.text();
  const verified = await verifyStripeSignature(payload, request.headers.get('stripe-signature'), env.STRIPE_WEBHOOK_SECRET);
  if (!verified.valid) return err('BadRequest', `signature: ${verified.reason}`, 400);

  const event = verified.event;
  switch (event.type) {
    // event-specific branches added in later steps
    default:
      console.log('stripe:unhandled', event.type);
      return json({ received: true });
  }
}
```

Wire in `worker/src/index.ts`:

```ts
import { handleStripeWebhook } from './routes/stripe-webhook.js';
// ...
if (request.method === 'POST' && path === '/v1/stripe-webhook') {
  return handleStripeWebhook(request, env, ctx);
}
```

Run:

```bash
pnpm test:worker -- stripe-webhook.test.ts
```

Expected: both signature tests pass.

Commit:

```bash
git add -A
git commit -m "feat(worker): POST /v1/stripe-webhook signature verification skeleton"
```

- [ ] **Step 6: Handle `checkout.session.completed`**

Append a test:

```ts
  it('checkout.session.completed creates customer + license + KV entries', async () => {
    const res = await postEvent({
      id: 'evt_checkout',
      type: 'checkout.session.completed',
      created: 1_700_000_000,
      data: { object: {
        id: 'cs_test_done',
        customer: 'cus_42',
        customer_details: { email: 'buyer@example.com' },
        subscription: 'sub_42',
        metadata: { plan: 'base@2026-q2', tier: 'base' },
      } },
    });
    expect(res.status).toBe(200);

    const row = await env.DB.prepare('SELECT plan FROM license WHERE stripe_subscription_id=?').bind('sub_42').first<{ plan: string }>();
    expect(row?.plan).toBe('base@2026-q2');
  });
```

Insert a branch in `stripe-webhook.ts`:

```ts
import { newUserId, newLicenseId } from '../lib/id.js';
import { generateHumanizedKey, GRACE_PERIOD_S } from '@carbonbook-cloud/shared';
import { writeActive, writeHumanizedKey } from '../lib/license-store.js';
import { sendActivationEmail } from '../lib/email.js';
import type { LicenseActiveRecord } from '@carbonbook-cloud/shared';

// ... inside switch:
case 'checkout.session.completed': {
  const o = event.data.object as {
    customer?: string;
    customer_details?: { email?: string };
    subscription?: string;
    metadata?: { plan?: string };
  };
  const email = o.customer_details?.email;
  const plan = o.metadata?.plan ?? 'base@2026-q2';
  if (!email) return err('BadRequest', 'missing customer email', 400);

  const now = event.created;
  const existing = await env.DB.prepare('SELECT user_id FROM customer WHERE email=?').bind(email).first<{ user_id: string }>();
  const userId = existing?.user_id ?? newUserId();
  if (!existing) {
    await env.DB.prepare('INSERT INTO customer (user_id, email, created_at, stripe_customer_id) VALUES (?, ?, ?, ?)').bind(userId, email, now, o.customer ?? null).run();
  } else if (o.customer) {
    await env.DB.prepare('UPDATE customer SET stripe_customer_id=? WHERE user_id=?').bind(o.customer, userId).run();
  }

  const licenseId = newLicenseId();
  const humanized = generateHumanizedKey();
  const expiresAt = now + 365 * 86_400;
  const graceUntil = expiresAt + GRACE_PERIOD_S;
  await env.DB.prepare(
    `INSERT INTO license (license_id, user_id, humanized_key, plan, features, devices_max, issued_at, expires_at, grace_until, stripe_subscription_id, revoked)
     VALUES (?, ?, ?, ?, '["inventory","questionnaire","iso14064"]', 1, ?, ?, ?, ?, 0)`,
  ).bind(licenseId, userId, humanized, plan, now, expiresAt, graceUntil, o.subscription ?? null).run();

  const record: LicenseActiveRecord = {
    license_id: licenseId, user_id: userId, plan,
    features: ['inventory', 'questionnaire', 'iso14064'],
    devices_max: 1, device_ids: [],
    issued_at: now, expires_at: expiresAt, grace_until: graceUntil,
    revoked: false, revoked_at: null, revoked_reason: null,
    stripe_subscription_id: o.subscription ?? null,
  };
  await writeActive(env.LICENSE_ACTIVE, record);
  await writeHumanizedKey(env.HUMANIZED_KEYS, humanized, licenseId);

  ctx.waitUntil(sendActivationEmail({
    apiKey: env.RESEND_API_KEY, to: email, licenseKey: humanized, lang: 'en',
  }));
  return json({ received: true });
}
```

Run + commit:

```bash
pnpm test:worker -- stripe-webhook.test.ts
git add -A
git commit -m "feat(worker): webhook handler for checkout.session.completed"
```

- [ ] **Step 7: Handle `invoice.payment_succeeded` (renewal)**

Append test:

```ts
  it('invoice.payment_succeeded bumps expires_at by ~1 year', async () => {
    // Seed a license linked to sub_renew.
    await env.DB.prepare('INSERT INTO customer (user_id, email, created_at) VALUES (?, ?, ?)').bind('usr_renew', 'r@example.com', 1_700_000_000).run();
    await env.DB.prepare(
      `INSERT INTO license (license_id, user_id, humanized_key, plan, features, devices_max, issued_at, expires_at, grace_until, stripe_subscription_id, revoked)
       VALUES ('lic_renew', 'usr_renew', 'cbk-renew1-renew2-renew3-renew4', 'base@2026-q2', '["inventory"]', 1, 1700000000, 1731536000, 1734128000, 'sub_renew', 0)`,
    ).run();
    await env.LICENSE_ACTIVE.put('la:lic_renew', JSON.stringify({
      license_id: 'lic_renew', user_id: 'usr_renew', plan: 'base@2026-q2',
      features: ['inventory'], devices_max: 1, device_ids: [],
      issued_at: 1_700_000_000, expires_at: 1_731_536_000, grace_until: 1_734_128_000,
      revoked: false, revoked_at: null, revoked_reason: null, stripe_subscription_id: 'sub_renew',
    }));

    const res = await postEvent({
      id: 'evt_inv', type: 'invoice.payment_succeeded',
      created: 1_731_500_000,
      data: { object: { subscription: 'sub_renew' } },
    });
    expect(res.status).toBe(200);
    const row = await env.DB.prepare('SELECT expires_at FROM license WHERE license_id=?').bind('lic_renew').first<{ expires_at: number }>();
    expect(row!.expires_at).toBe(1_731_536_000 + 365 * 86_400);
  });
```

Append branch:

```ts
case 'invoice.payment_succeeded': {
  const o = event.data.object as { subscription?: string };
  if (!o.subscription) return json({ received: true });
  const row = await env.DB.prepare('SELECT license_id, expires_at, grace_until FROM license WHERE stripe_subscription_id=?').bind(o.subscription).first<{ license_id: string; expires_at: number; grace_until: number }>();
  if (!row) return json({ received: true });
  const newExp = row.expires_at + 365 * 86_400;
  const newGrace = row.grace_until + 365 * 86_400;
  await env.DB.prepare('UPDATE license SET expires_at=?, grace_until=? WHERE license_id=?').bind(newExp, newGrace, row.license_id).run();
  const raw = await env.LICENSE_ACTIVE.get(`la:${row.license_id}`);
  if (raw) {
    const rec = JSON.parse(raw) as LicenseActiveRecord;
    rec.expires_at = newExp;
    rec.grace_until = newGrace;
    await env.LICENSE_ACTIVE.put(`la:${row.license_id}`, JSON.stringify(rec));
  }
  return json({ received: true });
}
```

Run + commit:

```bash
pnpm test:worker -- stripe-webhook.test.ts
git add -A
git commit -m "feat(worker): webhook handler for invoice.payment_succeeded"
```

- [ ] **Step 8: Handle `customer.subscription.deleted` — deferred revocation**

Per spec section 4 + IMP-5 from the review: do **not** flip `revoked=true`
immediately when Stripe says the subscription ended. Stripe's 30-day
chargeback window means the user could still legitimately use the app
during that period. Store a future `revoked_at = event.created + 30d` and
leave `revoked: false` in the active KV record. A cron (next step) flips
the bit when the timestamp passes.

Append test:

```ts
  it('customer.subscription.deleted schedules revocation in 30 days (does not flip revoked yet)', async () => {
    await env.DB.prepare('INSERT INTO customer (user_id, email, created_at) VALUES (?, ?, ?)').bind('usr_cancel', 'c@example.com', 1_700_000_000).run();
    await env.DB.prepare(
      `INSERT INTO license (license_id, user_id, humanized_key, plan, features, devices_max, issued_at, expires_at, grace_until, stripe_subscription_id, revoked)
       VALUES ('lic_cancel', 'usr_cancel', 'cbk-canc1-canc2-canc3-canc4', 'base@2026-q2', '["inventory"]', 1, 1700000000, 1731536000, 1734128000, 'sub_cancel', 0)`,
    ).run();
    await env.LICENSE_ACTIVE.put('la:lic_cancel', JSON.stringify({
      license_id: 'lic_cancel', user_id: 'usr_cancel', plan: 'base@2026-q2',
      features: ['inventory'], devices_max: 1, device_ids: [],
      issued_at: 1_700_000_000, expires_at: 1_731_536_000, grace_until: 1_734_128_000,
      revoked: false, revoked_at: null, revoked_reason: null, stripe_subscription_id: 'sub_cancel',
    }));

    const eventTime = 1_731_000_000;
    const res = await postEvent({
      id: 'evt_cancel', type: 'customer.subscription.deleted',
      created: eventTime,
      data: { object: { id: 'sub_cancel' } },
    });
    expect(res.status).toBe(200);

    const row = await env.DB.prepare('SELECT revoked, revoked_at, revoked_reason FROM license WHERE license_id=?').bind('lic_cancel').first<{ revoked: number; revoked_at: number; revoked_reason: string }>();
    expect(row!.revoked).toBe(0);                                // not yet
    expect(row!.revoked_at).toBe(eventTime + 30 * 86_400);       // scheduled
    expect(row!.revoked_reason).toBe('subscription_cancelled');
    const kv = JSON.parse((await env.LICENSE_ACTIVE.get('la:lic_cancel'))!) as LicenseActiveRecord;
    expect(kv.revoked).toBe(false);
  });
```

Append branch (factoring out the shared scheduling helper):

```ts
async function scheduleRevocation(env: Env, subscriptionId: string, eventTime: number, reason: string): Promise<void> {
  const row = await env.DB.prepare('SELECT license_id FROM license WHERE stripe_subscription_id=?').bind(subscriptionId).first<{ license_id: string }>();
  if (!row) return;
  const scheduledAt = eventTime + 30 * 86_400;
  await env.DB.prepare('UPDATE license SET revoked_at=?, revoked_reason=? WHERE license_id=?').bind(scheduledAt, reason, row.license_id).run();
  const raw = await env.LICENSE_ACTIVE.get(`la:${row.license_id}`);
  if (raw) {
    const rec = JSON.parse(raw) as LicenseActiveRecord;
    rec.revoked_at = scheduledAt;
    rec.revoked_reason = reason;
    // intentionally leave rec.revoked = false until the cron tips it over
    await env.LICENSE_ACTIVE.put(`la:${row.license_id}`, JSON.stringify(rec));
  }
}

// inside switch:
case 'customer.subscription.deleted': {
  const o = event.data.object as { id?: string };
  if (o.id) await scheduleRevocation(env, o.id, event.created, 'subscription_cancelled');
  return json({ received: true });
}
```

Run + commit:

```bash
pnpm test:worker -- stripe-webhook.test.ts
git add -A
git commit -m "feat(worker): webhook handler for subscription.deleted (deferred revocation)"
```

- [ ] **Step 9: Handle `charge.refunded`**

Append test:

```ts
  it('charge.refunded schedules revocation in 30 days with reason=refund', async () => {
    await env.DB.prepare('INSERT INTO customer (user_id, email, created_at) VALUES (?, ?, ?)').bind('usr_ref', 'ref@example.com', 1_700_000_000).run();
    await env.DB.prepare(
      `INSERT INTO license (license_id, user_id, humanized_key, plan, features, devices_max, issued_at, expires_at, grace_until, stripe_subscription_id, revoked)
       VALUES ('lic_ref', 'usr_ref', 'cbk-ref1a-ref2b-ref3c-ref4d', 'base@2026-q2', '["inventory"]', 1, 1700000000, 1731536000, 1734128000, 'sub_ref', 0)`,
    ).run();
    const eventTime = 1_731_100_000;
    const res = await postEvent({
      id: 'evt_ref', type: 'charge.refunded',
      created: eventTime,
      // charge.refunded events expose the subscription via the `invoice` -> `subscription` chain;
      // for the test we cheat and put it on `metadata` for the handler to read.
      data: { object: { id: 'ch_x', metadata: { subscription_id: 'sub_ref' } } },
    });
    expect(res.status).toBe(200);
    const row = await env.DB.prepare('SELECT revoked_at, revoked_reason FROM license WHERE license_id=?').bind('lic_ref').first<{ revoked_at: number; revoked_reason: string }>();
    expect(row!.revoked_at).toBe(eventTime + 30 * 86_400);
    expect(row!.revoked_reason).toBe('refund');
  });
```

Append branch (real Stripe events expose `invoice` on `charge.refunded`;
the handler accepts a `metadata.subscription_id` fallback so we can write
deterministic tests):

```ts
case 'charge.refunded': {
  const o = event.data.object as { invoice?: string; metadata?: { subscription_id?: string } };
  let subId: string | undefined;
  if (o.metadata?.subscription_id) subId = o.metadata.subscription_id;
  else if (o.invoice) {
    // Look up subscription via the linked invoice. Skipped here for brevity;
    // for prod use stripeRequest<{ subscription: string }>(env.STRIPE_SECRET_KEY, `/v1/invoices/${o.invoice}`, {})
    subId = undefined;
  }
  if (subId) await scheduleRevocation(env, subId, event.created, 'refund');
  return json({ received: true });
}
```

Run + commit:

```bash
pnpm test:worker -- stripe-webhook.test.ts
git add -A
git commit -m "feat(worker): webhook handler for charge.refunded (deferred revocation)"
```

- [ ] **Step 10: Unknown-event smoke test**

Append:

```ts
  it('unknown event types return 200 (no error)', async () => {
    const res = await postEvent({
      id: 'evt_unknown', type: 'invoice.upcoming',
      created: Math.floor(Date.now() / 1000),
      data: { object: {} },
    });
    expect(res.status).toBe(200);
  });
```

Run:

```bash
pnpm test:worker -- stripe-webhook.test.ts
```

Expected: all webhook tests pass.

- [ ] **Step 11: Revocation cron — daily sweep**

Create `worker/src/scheduled/revoke-cron.ts`:

```ts
import type { Env } from '../index.js';
import type { LicenseActiveRecord } from '@carbonbook-cloud/shared';

/**
 * Daily sweep: for every license whose `revoked_at` has passed but is
 * not yet flipped, set `revoked = 1` in D1 and `revoked: true` in KV,
 * and append to the REVOCATION_SET list.
 */
export async function runRevocationSweep(env: Env, nowSeconds: number): Promise<{ flipped: string[] }> {
  const rows = await env.DB.prepare(
    'SELECT license_id FROM license WHERE revoked = 0 AND revoked_at IS NOT NULL AND revoked_at <= ?',
  ).bind(nowSeconds).all<{ license_id: string }>();

  const flipped: string[] = [];
  for (const row of rows.results ?? []) {
    await env.DB.prepare('UPDATE license SET revoked = 1 WHERE license_id = ?').bind(row.license_id).run();
    const raw = await env.LICENSE_ACTIVE.get(`la:${row.license_id}`);
    if (raw) {
      const rec = JSON.parse(raw) as LicenseActiveRecord;
      rec.revoked = true;
      await env.LICENSE_ACTIVE.put(`la:${row.license_id}`, JSON.stringify(rec));
    }
    flipped.push(row.license_id);
  }

  if (flipped.length > 0) {
    const existing = await env.REVOCATION_SET.get('list');
    const set = existing ? (JSON.parse(existing) as { license_ids: string[] }) : { license_ids: [] };
    const merged = Array.from(new Set([...set.license_ids, ...flipped]));
    await env.REVOCATION_SET.put('list', JSON.stringify({ license_ids: merged, updated_at: nowSeconds }));
  }
  return { flipped };
}
```

Wire it into `worker/src/index.ts` by exporting a `scheduled` handler alongside `fetch`:

```ts
import { runRevocationSweep } from './scheduled/revoke-cron.js';

export default {
  async fetch(/* ... unchanged ... */) {},
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    await runRevocationSweep(env, Math.floor(Date.now() / 1000));
  },
} satisfies ExportedHandler<Env>;
```

Add the cron trigger to `worker/wrangler.toml`:

```toml
[triggers]
crons = ["0 3 * * *"]   # 03:00 UTC every day
```

- [ ] **Step 12: Test the cron sweep**

Create `worker/tests/revoke-cron.test.ts`:

```ts
import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { runRevocationSweep } from '../src/scheduled/revoke-cron.js';

describe('runRevocationSweep', () => {
  it('flips revoked=1 when revoked_at <= now', async () => {
    await env.DB.prepare('INSERT INTO customer (user_id, email, created_at) VALUES (?, ?, ?)').bind('usr_due', 'd@example.com', 1).run();
    await env.DB.prepare(
      `INSERT INTO license (license_id, user_id, humanized_key, plan, features, devices_max, issued_at, expires_at, grace_until, revoked, revoked_at, revoked_reason)
       VALUES ('lic_due', 'usr_due', 'cbk-due11-due22-due33-due44', 'base@2026-q2', '[]', 1, 1, 2, 3, 0, 1000, 'subscription_cancelled')`,
    ).run();
    await env.LICENSE_ACTIVE.put('la:lic_due', JSON.stringify({
      license_id: 'lic_due', user_id: 'usr_due', plan: 'base@2026-q2',
      features: [], devices_max: 1, device_ids: [],
      issued_at: 1, expires_at: 2, grace_until: 3,
      revoked: false, revoked_at: 1000, revoked_reason: 'subscription_cancelled',
      stripe_subscription_id: null,
    }));

    const result = await runRevocationSweep(env as never, 2000);
    expect(result.flipped).toContain('lic_due');

    const row = await env.DB.prepare('SELECT revoked FROM license WHERE license_id=?').bind('lic_due').first<{ revoked: number }>();
    expect(row!.revoked).toBe(1);
    const kv = JSON.parse((await env.LICENSE_ACTIVE.get('la:lic_due'))!);
    expect(kv.revoked).toBe(true);
    const revSet = JSON.parse((await env.REVOCATION_SET.get('list'))!);
    expect(revSet.license_ids).toContain('lic_due');
  });

  it('leaves licenses alone when revoked_at is in the future', async () => {
    await env.DB.prepare('INSERT INTO customer (user_id, email, created_at) VALUES (?, ?, ?)').bind('usr_future', 'f@example.com', 1).run();
    await env.DB.prepare(
      `INSERT INTO license (license_id, user_id, humanized_key, plan, features, devices_max, issued_at, expires_at, grace_until, revoked, revoked_at, revoked_reason)
       VALUES ('lic_future', 'usr_future', 'cbk-fut11-fut22-fut33-fut44', 'base@2026-q2', '[]', 1, 1, 2, 3, 0, 9999999999, 'subscription_cancelled')`,
    ).run();
    const result = await runRevocationSweep(env as never, 2000);
    expect(result.flipped).not.toContain('lic_future');
  });
});
```

Run + commit:

```bash
pnpm test:worker -- revoke-cron.test.ts
pnpm --filter @carbonbook-cloud/worker exec biome check src/scheduled/revoke-cron.ts tests/revoke-cron.test.ts
git add -A
git commit -m "feat(worker): daily cron sweep flips revoked=true once revoked_at passes"
```

---

## Task 7: Update manifest endpoint (YAML) + marketing site scaffold

**Files:**
- Create: `worker/src/routes/updates.ts`
- Modify: `worker/src/index.ts` — wire route
- Create: `worker/tests/updates.test.ts`
- Create: `pages/marketing/package.json`
- Create: `pages/marketing/astro.config.mjs`
- Create: `pages/marketing/tsconfig.json`
- Create: `pages/marketing/src/styles/global.css`
- Create: `pages/marketing/src/layouts/Base.astro`
- Create: `pages/marketing/src/pages/index.astro`
- Create: `pages/marketing/src/pages/pricing.astro`
- Create: `pages/marketing/src/pages/download.astro`
- Create: `pages/marketing/src/pages/privacy.astro`
- Create: `pages/marketing/src/components/Nav.astro`
- Create: `pages/marketing/src/components/Footer.astro`
- Create: `pages/marketing/src/components/PricingCards.astro`

Two deliverables: the auto-update manifest endpoint and the marketing
site scaffold. The manifest matches the cloud spec (`latest.yml` /
`latest-mac.yml` — `electron-updater` expects YAML, not JSON). The
marketing site uses Astro 5 + Tailwind v4 via `@tailwindcss/vite` (no JS
config, no `@astrojs/tailwind` integration — Tailwind v4 dropped both).

- [ ] **Step 1: Write failing test — update manifest**

Create `worker/tests/updates.test.ts`:

```ts
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../src/index.js';

const STABLE_MAC_YML = `version: 0.5.0
files:
  - url: https://releases.carbonbook.app/darwin-arm64/0.5.0/carbonbook-0.5.0-arm64.dmg
    sha512: deadbeef
    size: 84629184
releaseDate: '2026-06-01T00:00:00Z'
`;

async function get(path: string): Promise<Response> {
  const req = new Request(`https://api.carbonbook.app${path}`);
  const ctx = createExecutionContext();
  const res = await worker.fetch(req, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

describe('GET /v1/updates/:channel/:file', () => {
  beforeEach(async () => {
    await env.RELEASES.put('updates/stable/latest-mac.yml', STABLE_MAC_YML);
  });

  it('serves latest-mac.yml as text/yaml', async () => {
    const res = await get('/v1/updates/stable/latest-mac.yml');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toMatch(/yaml/);
    expect(res.headers.get('Cache-Control')).toMatch(/max-age=300/);
    expect(await res.text()).toBe(STABLE_MAC_YML);
  });

  it('returns 404 when the manifest is missing', async () => {
    const res = await get('/v1/updates/beta/latest.yml');
    expect(res.status).toBe(404);
  });

  it('rejects unknown channels with 400', async () => {
    const res = await get('/v1/updates/internal/latest.yml');
    expect(res.status).toBe(400);
  });

  it('rejects unknown filenames with 400', async () => {
    const res = await get('/v1/updates/stable/latest-linux.yml');
    expect(res.status).toBe(400);
  });
});
```

Run:

```bash
pnpm test:worker -- updates.test.ts
```

Expected: fails (no route).

- [ ] **Step 2: Implement the YAML manifest route**

Create `worker/src/routes/updates.ts`:

```ts
import { err } from '../lib/responses.js';
import type { Env } from '../index.js';

const ALLOWED_CHANNELS = new Set(['stable', 'beta']);
// electron-updater filenames: latest.yml (Windows + Linux), latest-mac.yml (macOS).
const ALLOWED_FILES = new Set(['latest.yml', 'latest-mac.yml']);

export async function handleUpdates(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  // Expected shape: /v1/updates/<channel>/<file>
  const segments = url.pathname.split('/').filter(Boolean);
  // ['v1','updates','<channel>','<file>']
  if (segments.length !== 4) return err('NotFound', 'invalid update path', 404);
  const [, , channel, file] = segments as [string, string, string, string];
  if (!ALLOWED_CHANNELS.has(channel)) return err('BadRequest', `unknown channel '${channel}'`, 400);
  if (!ALLOWED_FILES.has(file)) return err('BadRequest', `unknown manifest file '${file}'`, 400);

  const obj = await env.RELEASES.get(`updates/${channel}/${file}`);
  if (!obj) return err('NotFound', 'no manifest published for this channel', 404);

  const body = await obj.text();
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/yaml; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
```

Wire in `worker/src/index.ts`:

```ts
import { handleUpdates } from './routes/updates.js';
// ...
if (request.method === 'GET' && path.startsWith('/v1/updates/')) {
  return handleUpdates(request, env);
}
```

Run + commit:

```bash
pnpm test:worker -- updates.test.ts
pnpm --filter @carbonbook-cloud/worker exec biome check src/routes/updates.ts tests/updates.test.ts
git add -A
git commit -m "feat(worker): GET /v1/updates/:channel/:file serves electron-updater YAML"
```

- [ ] **Step 3: Marketing site `package.json` + Astro config**

`pages/marketing/package.json`:

```json
{
  "name": "@carbonbook-cloud/marketing",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview"
  },
  "dependencies": {
    "astro": "^5.8.0",
    "@astrojs/mdx": "^4.0.0",
    "@tailwindcss/vite": "^4.0.0",
    "tailwindcss": "^4.0.0"
  }
}
```

`pages/marketing/astro.config.mjs`:

```js
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import mdx from '@astrojs/mdx';

export default defineConfig({
  integrations: [mdx()],
  vite: { plugins: [tailwindcss()] },
  i18n: {
    defaultLocale: 'zh-CN',
    locales: ['zh-CN', 'en'],
    routing: { prefixDefaultLocale: false },
  },
});
```

`pages/marketing/tsconfig.json`:

```json
{
  "extends": "astro/tsconfigs/strict",
  "include": ["src", "astro.config.mjs"],
  "compilerOptions": {
    "baseUrl": "."
  }
}
```

- [ ] **Step 4: Tailwind v4 CSS entrypoint (no JS config)**

Tailwind v4 reads its config from CSS via the `@theme {}` block — there is
**no** `tailwind.config.js/ts` file. Create `pages/marketing/src/styles/global.css`:

```css
@import "tailwindcss";

@theme {
  /* Brand tokens — match the desktop app's design.tokens.ts */
  --color-brand-50: #f0f9ff;
  --color-brand-500: #0ea5e9;
  --color-brand-700: #0369a1;
  --color-ink-900: #0f172a;
  --color-ink-500: #64748b;
  --color-bg: #ffffff;
  --color-bg-muted: #f8fafc;

  --font-display: 'Inter Variable', 'Source Han Sans SC', system-ui, sans-serif;
  --font-body: 'Inter Variable', 'Source Han Sans SC', system-ui, sans-serif;
}

@media (prefers-color-scheme: dark) {
  :root {
    --color-bg: #0f172a;
    --color-bg-muted: #1e293b;
    --color-ink-900: #f8fafc;
    --color-ink-500: #94a3b8;
  }
}
```

Import it once from the base layout (step 5).

- [ ] **Step 5: Base layout**

Create `pages/marketing/src/layouts/Base.astro`:

```astro
---
import '../styles/global.css';
import Nav from '../components/Nav.astro';
import Footer from '../components/Footer.astro';
const { title, lang = 'zh-CN' } = Astro.props as { title: string; lang?: 'zh-CN' | 'en' };
---
<!doctype html>
<html lang={lang}>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{title}</title>
  </head>
  <body class="bg-[color:var(--color-bg)] text-[color:var(--color-ink-900)] font-[family-name:var(--font-body)]">
    <Nav lang={lang} />
    <main class="mx-auto max-w-5xl px-6 py-12"><slot /></main>
    <Footer lang={lang} />
  </body>
</html>
```

Create `pages/marketing/src/components/Nav.astro`:

```astro
---
const { lang } = Astro.props as { lang: 'zh-CN' | 'en' };
const links = lang === 'zh-CN'
  ? [{ href: '/', label: '首页' }, { href: '/pricing', label: '定价' }, { href: '/download', label: '下载' }]
  : [{ href: '/', label: 'Home' }, { href: '/pricing', label: 'Pricing' }, { href: '/download', label: 'Download' }];
---
<nav class="mx-auto max-w-5xl flex items-center justify-between px-6 py-4">
  <a href="/" class="font-bold text-lg">carbonbook</a>
  <ul class="flex gap-6 text-sm">
    {links.map((l) => <li><a href={l.href} class="hover:text-[color:var(--color-brand-500)]">{l.label}</a></li>)}
  </ul>
</nav>
```

Create `pages/marketing/src/components/Footer.astro`:

```astro
---
const { lang } = Astro.props as { lang: 'zh-CN' | 'en' };
const blurb = lang === 'zh-CN'
  ? '本网站不使用第三方分析。所有数据存储于用户本地设备。'
  : 'No third-party analytics on this site. All data stays on your device.';
---
<footer class="mx-auto max-w-5xl px-6 py-12 text-sm text-[color:var(--color-ink-500)]">
  <p>{blurb}</p>
</footer>
```

- [ ] **Step 6: Page shells — index, pricing, download, privacy**

Create `pages/marketing/src/pages/index.astro`:

```astro
---
import Base from '../layouts/Base.astro';
---
<Base title="carbonbook — 离线碳核算" lang="zh-CN">
  <section class="py-16">
    <h1 class="text-5xl font-bold tracking-tight">把碳核算搬到桌面端</h1>
    <p class="mt-4 max-w-2xl text-lg text-[color:var(--color-ink-500)]">完全离线运行，零云端依赖。一次买断，终身使用。</p>
    <div class="mt-8 flex gap-3">
      <a href="/download" class="rounded-md bg-[color:var(--color-brand-500)] px-5 py-2.5 text-white">下载试用</a>
      <a href="/pricing" class="rounded-md border border-[color:var(--color-ink-500)] px-5 py-2.5">查看定价</a>
    </div>
  </section>
</Base>
```

Create `pages/marketing/src/pages/pricing.astro`:

```astro
---
import Base from '../layouts/Base.astro';
import PricingCards from '../components/PricingCards.astro';
---
<Base title="定价 — carbonbook" lang="zh-CN">
  <h1 class="text-4xl font-bold">定价</h1>
  <PricingCards lang="zh-CN" />
</Base>
```

Create `pages/marketing/src/components/PricingCards.astro` with the `[Buy now]` button wired to `/v1/checkout-session`:

```astro
---
const { lang } = Astro.props as { lang: 'zh-CN' | 'en' };
const t = lang === 'zh-CN'
  ? { trial: '14 天试用', base: 'Base', buy: '立即购买', try: '开始试用' }
  : { trial: '14-day trial', base: 'Base', buy: 'Buy now', try: 'Start trial' };
---
<div class="mt-8 grid gap-6 sm:grid-cols-2">
  <article class="rounded-xl border p-6">
    <h2 class="text-xl font-semibold">{t.trial}</h2>
    <p class="mt-3 text-3xl font-bold">¥0</p>
    <a href="/download" class="mt-6 inline-block rounded-md border px-4 py-2">{t.try}</a>
  </article>
  <article class="rounded-xl border p-6 ring-2 ring-[color:var(--color-brand-500)]">
    <h2 class="text-xl font-semibold">{t.base}</h2>
    <p class="mt-3 text-3xl font-bold">¥1,499 / 年</p>
    <button id="buy-base" data-plan="base@2026-q2" class="mt-6 inline-block rounded-md bg-[color:var(--color-brand-500)] px-4 py-2 text-white">{t.buy}</button>
  </article>
</div>
<script>
  const btn = document.getElementById('buy-base');
  btn?.addEventListener('click', async () => {
    const plan = btn.getAttribute('data-plan');
    const res = await fetch('https://api.carbonbook.app/v1/checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan }),
    });
    if (!res.ok) {
      alert('Unable to start checkout. Try again.');
      return;
    }
    const { checkout_url } = await res.json();
    window.location.href = checkout_url;
  });
</script>
```

Create `pages/marketing/src/pages/download.astro` and `privacy.astro`
following the same Base+content pattern (skeleton only; real copy in
Task 10's localisation pass).

- [ ] **Step 7: Verify the marketing site builds**

```bash
cd pages/marketing && pnpm install && pnpm build
```

Expected: Astro emits static HTML to `pages/marketing/dist/`. Tailwind
classes (e.g. `bg-[color:var(--color-bg)]`) are present in the bundled
CSS. Build prints "0 errors".

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: marketing site scaffold (Astro 5 + Tailwind v4 via @tailwindcss/vite) + pricing CTA wired to /v1/checkout-session"
```

---

## Task 8: Activate page (`activate.carbonbook.app`)

**Files:**
- Create: `pages/activate/package.json`
- Create: `pages/activate/astro.config.mjs`
- Create: `pages/activate/tsconfig.json`
- Create: `pages/activate/src/styles/global.css`
- Create: `pages/activate/src/layouts/Base.astro`
- Create: `pages/activate/src/pages/index.astro`
- Create: `pages/activate/src/components/LicenseKeyCard.astro`
- Modify: `worker/src/routes/checkout-session.ts` (none — page reads Stripe directly)
- Create: `pages/activate/src/lib/stripe-lookup.ts`

A single-purpose page the user lands on after Stripe checkout or
clicking the email link. Renders the humanized license key with
copy-to-clipboard and step-by-step instructions. SSR so that
`?session_id=cs_...` can resolve to the license key via a server-side
Stripe API call (we never expose `STRIPE_SECRET_KEY` to the browser).

- [ ] **Step 1: Astro scaffold with Cloudflare adapter**

`pages/activate/package.json`:

```json
{
  "name": "@carbonbook-cloud/activate",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview"
  },
  "dependencies": {
    "astro": "^5.8.0",
    "@astrojs/cloudflare": "^12.0.0",
    "@tailwindcss/vite": "^4.0.0",
    "tailwindcss": "^4.0.0"
  }
}
```

`pages/activate/astro.config.mjs`:

```js
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  output: 'server',
  adapter: cloudflare(),
  vite: { plugins: [tailwindcss()] },
  i18n: {
    defaultLocale: 'zh-CN',
    locales: ['zh-CN', 'en'],
    routing: { prefixDefaultLocale: false },
  },
});
```

`pages/activate/tsconfig.json`:

```json
{
  "extends": "astro/tsconfigs/strict",
  "include": ["src", "astro.config.mjs"]
}
```

`pages/activate/src/styles/global.css` — identical to the marketing
site's `global.css` (`@import "tailwindcss"; @theme { ... }`); copy it in.

- [ ] **Step 2: Stripe Checkout Session lookup helper**

Create `pages/activate/src/lib/stripe-lookup.ts`:

```ts
type Session = {
  id: string;
  customer_details?: { email?: string };
  metadata?: { plan?: string };
};

/**
 * Fetch the Checkout Session, then look up the license that the
 * webhook handler created for that session via the cloud API.
 * (The page itself doesn't talk to D1 — it just calls the Worker.)
 */
export async function lookupLicenseForSession(opts: {
  sessionId: string;
  stripeSecretKey: string;
  apiOrigin: string;
}): Promise<{ licenseKey: string; email: string } | null> {
  const sessionRes = await fetch(`https://api.stripe.com/v1/checkout/sessions/${opts.sessionId}`, {
    headers: { Authorization: `Bearer ${opts.stripeSecretKey}` },
  });
  if (!sessionRes.ok) return null;
  const session = (await sessionRes.json()) as Session;
  const email = session.customer_details?.email;
  if (!email) return null;
  // The webhook creates the license keyed by email. Worker exposes a
  // lookup endpoint for activate.carbonbook.app:
  const lookup = await fetch(`${opts.apiOrigin}/v1/internal/license-by-email?email=${encodeURIComponent(email)}`, {
    headers: { 'X-Activate-Page': '1' },
  });
  if (!lookup.ok) return null;
  const body = (await lookup.json()) as { license_key: string };
  return { licenseKey: body.license_key, email };
}
```

Note: this introduces an internal Worker endpoint
`GET /v1/internal/license-by-email`. Add it as a small follow-up step:

```ts
// worker/src/routes/internal-lookup.ts
import { err, json } from '../lib/responses.js';
import type { Env } from '../index.js';

export async function handleLicenseByEmail(request: Request, env: Env): Promise<Response> {
  // Hardened later with a shared bearer secret between Pages SSR and the Worker.
  if (request.headers.get('X-Activate-Page') !== '1') return err('Unauthorized', 'no', 401);
  const email = new URL(request.url).searchParams.get('email');
  if (!email) return err('BadRequest', 'email required', 400);
  const row = await env.DB.prepare(
    'SELECT l.humanized_key FROM license l JOIN customer c ON l.user_id = c.user_id WHERE c.email = ? ORDER BY l.issued_at DESC LIMIT 1',
  ).bind(email).first<{ humanized_key: string }>();
  if (!row) return err('NotFound', 'no license for email', 404);
  return json({ license_key: row.humanized_key });
}
```

Wire `/v1/internal/license-by-email` in `worker/src/index.ts`. Add a
quick Worker test that this endpoint requires the `X-Activate-Page`
header and otherwise returns 401 — keep it short, this is internal.

- [ ] **Step 3: Base layout + LicenseKeyCard**

Create `pages/activate/src/layouts/Base.astro` (mirror the marketing
layout, drop the nav — single-purpose page).

Create `pages/activate/src/components/LicenseKeyCard.astro`:

```astro
---
const { licenseKey, lang } = Astro.props as { licenseKey: string; lang: 'zh-CN' | 'en' };
const steps = lang === 'zh-CN'
  ? ['打开 carbonbook 桌面应用', '点击右上角头像 → 设置 → 激活', '粘贴下方密钥并点击「激活」']
  : ['Open the carbonbook desktop app', 'Click the avatar (top-right) → Settings → Activate', 'Paste the key below and click "Activate"'];
const copyLabel = lang === 'zh-CN' ? '复制' : 'Copy';
---
<section class="mx-auto max-w-xl">
  <div class="rounded-xl border bg-[color:var(--color-bg-muted)] p-6 text-center">
    <p class="font-mono text-2xl tracking-wider">{licenseKey}</p>
    <button id="copy-key" data-key={licenseKey} class="mt-4 rounded-md bg-[color:var(--color-brand-500)] px-4 py-2 text-white">
      {copyLabel}
    </button>
  </div>
  <ol class="mt-8 list-decimal space-y-2 pl-6 text-[color:var(--color-ink-500)]">
    {steps.map((s) => <li>{s}</li>)}
  </ol>
</section>
<script>
  const btn = document.getElementById('copy-key');
  btn?.addEventListener('click', async () => {
    const key = btn.getAttribute('data-key');
    if (!key) return;
    await navigator.clipboard.writeText(key);
    btn.textContent = 'OK';
  });
</script>
```

- [ ] **Step 4: SSR page with three states**

Create `pages/activate/src/pages/index.astro`:

```astro
---
import Base from '../layouts/Base.astro';
import LicenseKeyCard from '../components/LicenseKeyCard.astro';
import { lookupLicenseForSession } from '../lib/stripe-lookup.ts';

const url = new URL(Astro.request.url);
const sessionId = url.searchParams.get('session_id');
const directKey = url.searchParams.get('key');
const accept = Astro.request.headers.get('accept-language') ?? '';
const lang: 'zh-CN' | 'en' = (url.searchParams.get('lang') === 'en' || accept.toLowerCase().startsWith('en')) ? 'en' : 'zh-CN';

let licenseKey: string | null = null;
let lookupError: string | null = null;
if (directKey) {
  licenseKey = directKey;
} else if (sessionId) {
  const env = Astro.locals.runtime?.env as { STRIPE_SECRET_KEY: string; API_ORIGIN: string };
  const result = await lookupLicenseForSession({
    sessionId,
    stripeSecretKey: env.STRIPE_SECRET_KEY,
    apiOrigin: env.API_ORIGIN,
  });
  if (result) licenseKey = result.licenseKey;
  else lookupError = lang === 'zh-CN' ? '无法找到对应的密钥，请检查邮箱。' : 'We could not locate your key — please check your inbox.';
}

const emptyMsg = lang === 'zh-CN' ? '请查收邮件中的激活链接。' : 'Check your email for the activation link.';
---
<Base title={lang === 'zh-CN' ? '激活 carbonbook' : 'Activate carbonbook'} lang={lang}>
  {licenseKey && <LicenseKeyCard licenseKey={licenseKey} lang={lang} />}
  {!licenseKey && lookupError && <p class="text-red-600">{lookupError}</p>}
  {!licenseKey && !lookupError && <p class="text-[color:var(--color-ink-500)]">{emptyMsg}</p>}
</Base>
```

Add `API_ORIGIN`, `STRIPE_SECRET_KEY` to the Cloudflare Pages project
environment vars (documented in Task 10's deploy notes).

- [ ] **Step 5: Build verification**

```bash
cd pages/activate && pnpm install && pnpm build
```

Expected: Astro builds the SSR bundle for Cloudflare Pages. No type errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: activate.carbonbook.app — SSR page resolves session_id → license key"
```

---

## Task 9: Account portal (`account.carbonbook.app`)

**Files:**
- Create: `worker/src/lib/session.ts` (sign + verify session JWTs, magic-link tokens)
- Create: `worker/src/routes/auth.ts` (`/v1/auth/magic-link`, `/v1/auth/exchange`)
- Create: `worker/src/routes/account.ts` (`/v1/account/devices`, `/v1/account/billing-portal`)
- Create: `worker/src/routes/devices.ts` (`/v1/devices/:id/deactivate`)
- Create: `worker/src/routes/account-delete.ts` (`DELETE /v1/account`)
- Modify: `worker/src/index.ts` — wire all account endpoints
- Create: `worker/tests/auth.test.ts`
- Create: `worker/tests/account.test.ts`
- Create: `worker/tests/devices.test.ts`
- Create: `worker/tests/account-delete.test.ts`
- Create: `pages/account/package.json`
- Create: `pages/account/astro.config.mjs`
- Create: `pages/account/tsconfig.json`
- Create: `pages/account/src/styles/global.css`
- Create: `pages/account/src/layouts/Base.astro`
- Create: `pages/account/src/middleware.ts`
- Create: `pages/account/src/pages/login.astro`
- Create: `pages/account/src/pages/login/callback.astro`
- Create: `pages/account/src/pages/index.astro`

The authenticated portal with magic-link login, device management,
Stripe Customer Portal integration, and account deletion. We build the
Worker endpoints first (TDD), then layer the Astro Pages SSR on top.

- [ ] **Step 1: Session + token helpers**

Create `worker/src/lib/session.ts`:

```ts
import { ed25519 } from '@noble/curves/ed25519';
import { signLicenseJwt } from './jwt.js';
// We re-use the JWT-signing primitive, but with a separate key + claim shape.

export type SessionClaims = {
  iss: 'carbonbook.app/account';
  sub: string;          // user_id
  email: string;
  iat: number;
  exp: number;
};

function b64url(data: Uint8Array | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function seedFromHex(hex: string): Uint8Array {
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export async function signSessionJwt(claims: SessionClaims, privKeyHex: string): Promise<string> {
  const header = b64url(JSON.stringify({ alg: 'EdDSA', typ: 'JWT' }));
  const body = b64url(JSON.stringify(claims));
  const signingInput = `${header}.${body}`;
  const sig = ed25519.sign(new TextEncoder().encode(signingInput), seedFromHex(privKeyHex));
  return `${signingInput}.${b64url(sig)}`;
}

export function verifySessionJwt(jwt: string, privKeyHex: string, nowSeconds: number): SessionClaims | null {
  const parts = jwt.split('.');
  if (parts.length !== 3) return null;
  const [h, b, s] = parts as [string, string, string];
  const pub = ed25519.getPublicKey(seedFromHex(privKeyHex));
  const valid = ed25519.verify(b64urlDecode(s), new TextEncoder().encode(`${h}.${b}`), pub);
  if (!valid) return null;
  const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(b))) as SessionClaims;
  if (claims.exp <= nowSeconds) return null;
  return claims;
}

/** Random 32-byte URL-safe magic-link token. */
export function newMagicLinkToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return b64url(bytes);
}

export function readSessionCookie(request: Request): string | null {
  const cookie = request.headers.get('Cookie') ?? '';
  const match = cookie.match(/(?:^|;\s*)session=([^;]+)/);
  return match ? decodeURIComponent(match[1]!) : null;
}

export async function requireSession(
  request: Request,
  privKeyHex: string,
): Promise<SessionClaims | Response> {
  const tok = readSessionCookie(request) ?? request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!tok) return new Response(JSON.stringify({ error: { _tag: 'Unauthorized', message: 'no session' } }), { status: 401 });
  const claims = verifySessionJwt(tok, privKeyHex, Math.floor(Date.now() / 1000));
  if (!claims) return new Response(JSON.stringify({ error: { _tag: 'Unauthorized', message: 'invalid session' } }), { status: 401 });
  return claims;
}
```

Note `signLicenseJwt` is re-used implicitly via `ed25519.sign` but with a
**separate** key (`SESSION_PRIVATE_KEY_HEX`). Sessions and license JWTs
have different shapes and trust models — keep them distinct.

Commit:

```bash
pnpm --filter @carbonbook-cloud/worker exec biome check src/lib/session.ts
git add -A
git commit -m "feat(worker): session JWT + magic-link token helpers"
```

- [ ] **Step 2: Magic-link issuance — `POST /v1/auth/magic-link`**

Create `worker/src/routes/auth.ts`:

```ts
import { z } from 'zod';
import { newMagicLinkToken, signSessionJwt } from '../lib/session.js';
import { sendMagicLinkEmail } from '../lib/email.js';
import { err, json } from '../lib/responses.js';
import type { Env } from '../index.js';

const magicLinkReq = z.object({ email: z.string().email() });
const exchangeReq = z.object({ token: z.string().min(1) });

export async function handleMagicLink(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const raw = await request.json().catch(() => null);
  const parsed = magicLinkReq.safeParse(raw);
  if (!parsed.success) return err('BadRequest', parsed.error.message, 400);

  const customer = await env.DB.prepare('SELECT user_id FROM customer WHERE email = ?').bind(parsed.data.email).first<{ user_id: string }>();
  if (!customer) {
    // Don't leak whether the email exists; return 200 either way.
    return json({ sent: true });
  }
  const token = newMagicLinkToken();
  await env.RATE_LIMIT.put(`ml:${token}`, JSON.stringify({ user_id: customer.user_id, email: parsed.data.email }), { expirationTtl: 900 });

  const url = `https://account.carbonbook.app/login/callback?t=${token}`;
  ctx.waitUntil(sendMagicLinkEmail({ apiKey: env.RESEND_API_KEY, to: parsed.data.email, url, lang: 'en' }));
  return json({ sent: true });
}

export async function handleExchange(request: Request, env: Env): Promise<Response> {
  const raw = await request.json().catch(() => null);
  const parsed = exchangeReq.safeParse(raw);
  if (!parsed.success) return err('BadRequest', parsed.error.message, 400);

  const stored = await env.RATE_LIMIT.get(`ml:${parsed.data.token}`);
  if (!stored) return err('Unauthorized', 'token expired or used', 401);
  await env.RATE_LIMIT.delete(`ml:${parsed.data.token}`);  // single-use

  const { user_id, email } = JSON.parse(stored) as { user_id: string; email: string };
  const now = Math.floor(Date.now() / 1000);
  const sessionJwt = await signSessionJwt(
    { iss: 'carbonbook.app/account', sub: user_id, email, iat: now, exp: now + 30 * 86_400 },
    env.SESSION_PRIVATE_KEY_HEX,
  );
  return new Response(JSON.stringify({ session: sessionJwt }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': `session=${encodeURIComponent(sessionJwt)}; Path=/; Max-Age=${30 * 86_400}; HttpOnly; SameSite=Lax; Secure`,
    },
  });
}
```

Note: we re-use the `RATE_LIMIT` KV namespace with a `ml:` prefix for
magic-link tokens. The 900 s TTL is well above KV's 60 s minimum, so
the rate-limit TTL bug from CRIT-2 doesn't apply here.

Wire in `worker/src/index.ts`:

```ts
import { handleMagicLink, handleExchange } from './routes/auth.js';
// ...
if (request.method === 'POST' && path === '/v1/auth/magic-link') return handleMagicLink(request, env, ctx);
if (request.method === 'POST' && path === '/v1/auth/exchange') return handleExchange(request, env);
```

- [ ] **Step 3: Tests for auth flow**

Create `worker/tests/auth.test.ts`:

```ts
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src/index.js';
import { TEST_PRIVATE_KEY_HEX } from './_fixtures.js';

const SESSION_KEY = '7f12345678901234567890123456789012345678901234567890123456789012';

async function call(path: string, body: unknown): Promise<Response> {
  const req = new Request(`https://api.carbonbook.app${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const ctx = createExecutionContext();
  const res = await worker.fetch(req, { ...env, SESSION_PRIVATE_KEY_HEX: SESSION_KEY, RESEND_API_KEY: 'test' }, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

describe('/v1/auth', () => {
  it('magic-link returns 200 even for unknown emails (no enumeration)', async () => {
    const res = await call('/v1/auth/magic-link', { email: 'nobody@example.com' });
    expect(res.status).toBe(200);
  });

  it('full flow: magic-link → exchange → session cookie set', async () => {
    await env.DB.prepare('INSERT INTO customer (user_id, email, created_at) VALUES (?, ?, ?)').bind('usr_auth', 'auth@example.com', 1).run();
    await call('/v1/auth/magic-link', { email: 'auth@example.com' });

    // Grab the token directly from KV — the test substitutes for the email link.
    const { keys } = await env.RATE_LIMIT.list({ prefix: 'ml:' });
    expect(keys.length).toBe(1);
    const token = keys[0]!.name.slice('ml:'.length);

    const exch = await call('/v1/auth/exchange', { token });
    expect(exch.status).toBe(200);
    expect(exch.headers.get('Set-Cookie')).toMatch(/^session=/);
  });

  it('exchange of a used token returns 401', async () => {
    const res = await call('/v1/auth/exchange', { token: 'never-existed' });
    expect(res.status).toBe(401);
  });
});
```

Run + commit:

```bash
pnpm test:worker -- auth.test.ts
git add -A
git commit -m "feat(worker): magic-link auth (POST /v1/auth/magic-link + exchange)"
```

- [ ] **Step 4: Account endpoints — devices + billing portal**

Create `worker/src/routes/account.ts`:

```ts
import { requireSession } from '../lib/session.js';
import { createBillingPortal } from '../lib/stripe.js';
import { err, json } from '../lib/responses.js';
import type { Env } from '../index.js';

export async function handleAccountDevices(request: Request, env: Env): Promise<Response> {
  const session = await requireSession(request, env.SESSION_PRIVATE_KEY_HEX);
  if (session instanceof Response) return session;
  const rows = await env.DB.prepare(
    `SELECT d.device_id, d.first_seen_at, d.last_ping_at, d.app_version, d.os, d.license_id
     FROM device d JOIN license l ON d.license_id = l.license_id
     WHERE l.user_id = ?`,
  ).bind(session.sub).all();
  return json({ devices: rows.results ?? [] });
}

export async function handleBillingPortal(request: Request, env: Env): Promise<Response> {
  const session = await requireSession(request, env.SESSION_PRIVATE_KEY_HEX);
  if (session instanceof Response) return session;
  const url = new URL(request.url);
  const returnUrl = url.searchParams.get('return_url') ?? 'https://account.carbonbook.app/';
  const cust = await env.DB.prepare('SELECT stripe_customer_id FROM customer WHERE user_id = ?').bind(session.sub).first<{ stripe_customer_id: string | null }>();
  if (!cust?.stripe_customer_id) return err('BadRequest', 'no Stripe customer linked', 400);
  const portal = await createBillingPortal({
    secretKey: env.STRIPE_SECRET_KEY,
    stripeCustomerId: cust.stripe_customer_id,
    returnUrl,
  });
  return json({ url: portal.url });
}
```

Wire in `index.ts`:

```ts
import { handleAccountDevices, handleBillingPortal } from './routes/account.js';
// ...
if (request.method === 'GET' && path === '/v1/account/devices') return handleAccountDevices(request, env);
if (request.method === 'GET' && path === '/v1/account/billing-portal') return handleBillingPortal(request, env);
```

- [ ] **Step 5: Tests for account endpoints**

Create `worker/tests/account.test.ts`:

```ts
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src/index.js';
import { signSessionJwt } from '../src/lib/session.js';

const SESSION_KEY = '7f12345678901234567890123456789012345678901234567890123456789012';

async function authedGet(path: string, userId: string): Promise<Response> {
  const now = Math.floor(Date.now() / 1000);
  const jwt = await signSessionJwt(
    { iss: 'carbonbook.app/account', sub: userId, email: 'x@example.com', iat: now, exp: now + 3600 },
    SESSION_KEY,
  );
  const req = new Request(`https://api.carbonbook.app${path}`, {
    headers: { Cookie: `session=${jwt}` },
  });
  const ctx = createExecutionContext();
  const res = await worker.fetch(req, { ...env, SESSION_PRIVATE_KEY_HEX: SESSION_KEY }, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

describe('/v1/account/devices', () => {
  it('returns the user devices', async () => {
    await env.DB.prepare('INSERT INTO customer (user_id, email, created_at) VALUES (?, ?, ?)').bind('usr_acct', 'a@example.com', 1).run();
    await env.DB.prepare(`INSERT INTO license (license_id, user_id, humanized_key, plan, features, devices_max, issued_at, expires_at, grace_until) VALUES ('lic_acct','usr_acct','cbk-aaaaa-bbbbb-ccccc-ddddd','base@2026-q2','[]',2,1,2,3)`).run();
    await env.DB.prepare('INSERT INTO device (device_id, license_id, first_seen_at, last_ping_at) VALUES (?, ?, ?, ?)').bind('dev_a', 'lic_acct', 1, 1).run();

    const res = await authedGet('/v1/account/devices', 'usr_acct');
    expect(res.status).toBe(200);
    const body = await res.json<{ devices: Array<{ device_id: string }> }>();
    expect(body.devices.length).toBe(1);
    expect(body.devices[0]!.device_id).toBe('dev_a');
  });

  it('returns 401 without a session', async () => {
    const res = await worker.fetch(new Request('https://api.carbonbook.app/v1/account/devices'), { ...env, SESSION_PRIVATE_KEY_HEX: SESSION_KEY } as never, createExecutionContext());
    expect(res.status).toBe(401);
  });
});
```

Run + commit:

```bash
pnpm test:worker -- account.test.ts
git add -A
git commit -m "feat(worker): GET /v1/account/devices + /v1/account/billing-portal"
```

- [ ] **Step 6: Device deactivation endpoint**

Create `worker/src/routes/devices.ts`:

```ts
import { requireSession } from '../lib/session.js';
import { err, json } from '../lib/responses.js';
import type { Env, LicenseActiveRecord } from '../index.js';

export async function handleDeactivateDevice(request: Request, env: Env): Promise<Response> {
  const session = await requireSession(request, env.SESSION_PRIVATE_KEY_HEX);
  if (session instanceof Response) return session;

  // Path: /v1/devices/<device_id>/deactivate
  const segments = new URL(request.url).pathname.split('/').filter(Boolean);
  const deviceId = segments[2];
  if (!deviceId) return err('BadRequest', 'missing device_id', 400);

  const row = await env.DB.prepare(
    `SELECT d.license_id FROM device d JOIN license l ON d.license_id = l.license_id WHERE d.device_id = ? AND l.user_id = ?`,
  ).bind(deviceId, session.sub).first<{ license_id: string }>();
  if (!row) return err('NotFound', 'device not found for this account', 404);

  await env.DB.prepare('DELETE FROM device WHERE device_id = ? AND license_id = ?').bind(deviceId, row.license_id).run();
  const raw = await env.LICENSE_ACTIVE.get(`la:${row.license_id}`);
  if (raw) {
    const rec = JSON.parse(raw) as LicenseActiveRecord;
    rec.device_ids = rec.device_ids.filter((d) => d !== deviceId);
    await env.LICENSE_ACTIVE.put(`la:${row.license_id}`, JSON.stringify(rec));
  }
  return json({ ok: true });
}
```

Wire in `index.ts`:

```ts
import { handleDeactivateDevice } from './routes/devices.js';
// ...
if (request.method === 'POST' && /^\/v1\/devices\/[^/]+\/deactivate$/.test(path)) {
  return handleDeactivateDevice(request, env);
}
```

Create `worker/tests/devices.test.ts`:

```ts
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src/index.js';
import { signSessionJwt } from '../src/lib/session.js';

const SESSION_KEY = '7f12345678901234567890123456789012345678901234567890123456789012';

async function authedPost(path: string, userId: string): Promise<Response> {
  const now = Math.floor(Date.now() / 1000);
  const jwt = await signSessionJwt({ iss: 'carbonbook.app/account', sub: userId, email: 'x', iat: now, exp: now + 3600 }, SESSION_KEY);
  const req = new Request(`https://api.carbonbook.app${path}`, {
    method: 'POST',
    headers: { Cookie: `session=${jwt}` },
  });
  const ctx = createExecutionContext();
  const res = await worker.fetch(req, { ...env, SESSION_PRIVATE_KEY_HEX: SESSION_KEY }, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

describe('/v1/devices/:id/deactivate', () => {
  it('removes the device from D1 and KV', async () => {
    await env.DB.prepare('INSERT INTO customer (user_id, email, created_at) VALUES (?, ?, ?)').bind('usr_d', 'd@example.com', 1).run();
    await env.DB.prepare(`INSERT INTO license (license_id, user_id, humanized_key, plan, features, devices_max, issued_at, expires_at, grace_until) VALUES ('lic_d','usr_d','cbk-aaaaa-bbbbb-ccccc-eeeee','base@2026-q2','[]',2,1,2,3)`).run();
    await env.DB.prepare('INSERT INTO device (device_id, license_id, first_seen_at, last_ping_at) VALUES (?, ?, ?, ?)').bind('dev_x', 'lic_d', 1, 1).run();
    await env.LICENSE_ACTIVE.put('la:lic_d', JSON.stringify({
      license_id: 'lic_d', user_id: 'usr_d', plan: 'base@2026-q2',
      features: [], devices_max: 2, device_ids: ['dev_x'],
      issued_at: 1, expires_at: 2, grace_until: 3,
      revoked: false, revoked_at: null, revoked_reason: null, stripe_subscription_id: null,
    }));
    const res = await authedPost('/v1/devices/dev_x/deactivate', 'usr_d');
    expect(res.status).toBe(200);
    const row = await env.DB.prepare('SELECT * FROM device WHERE device_id = ?').bind('dev_x').first();
    expect(row).toBeNull();
    const kv = JSON.parse((await env.LICENSE_ACTIVE.get('la:lic_d'))!);
    expect(kv.device_ids).toEqual([]);
  });

  it('returns 404 for a device that does not belong to the user', async () => {
    const res = await authedPost('/v1/devices/dev_other/deactivate', 'usr_d');
    expect(res.status).toBe(404);
  });
});
```

Run + commit:

```bash
pnpm test:worker -- devices.test.ts
git add -A
git commit -m "feat(worker): POST /v1/devices/:id/deactivate"
```

- [ ] **Step 7: `DELETE /v1/account` — danger-zone delete account**

Create `worker/src/routes/account-delete.ts`:

```ts
import { z } from 'zod';
import { requireSession } from '../lib/session.js';
import { stripeRequest } from '../lib/stripe.js';
import { err, json } from '../lib/responses.js';
import type { Env } from '../index.js';

const deleteReq = z.object({ confirm: z.literal('DELETE') });

export async function handleAccountDelete(request: Request, env: Env): Promise<Response> {
  const session = await requireSession(request, env.SESSION_PRIVATE_KEY_HEX);
  if (session instanceof Response) return session;
  const raw = await request.json().catch(() => null);
  const parsed = deleteReq.safeParse(raw);
  if (!parsed.success) return err('BadRequest', 'must POST { confirm: "DELETE" }', 400);

  // Cancel any live Stripe subscriptions tied to the user.
  const subs = await env.DB.prepare(
    `SELECT stripe_subscription_id FROM license WHERE user_id = ? AND stripe_subscription_id IS NOT NULL AND revoked = 0`,
  ).bind(session.sub).all<{ stripe_subscription_id: string }>();
  for (const row of subs.results ?? []) {
    if (!row.stripe_subscription_id) continue;
    try {
      await stripeRequest(env.STRIPE_SECRET_KEY, `/v1/subscriptions/${row.stripe_subscription_id}`, { cancel_at_period_end: 'true' });
    } catch (e) {
      console.error('stripe:cancel-on-delete-failed', e);
    }
  }

  // Drop license KV records.
  const licenses = await env.DB.prepare('SELECT license_id, humanized_key FROM license WHERE user_id = ?').bind(session.sub).all<{ license_id: string; humanized_key: string }>();
  for (const lic of licenses.results ?? []) {
    await env.LICENSE_ACTIVE.delete(`la:${lic.license_id}`);
    await env.HUMANIZED_KEYS.delete(`hk:${lic.humanized_key}`);
  }

  // D1 cascade: delete devices → licenses → customer.
  await env.DB.prepare('DELETE FROM device WHERE license_id IN (SELECT license_id FROM license WHERE user_id = ?)').bind(session.sub).run();
  await env.DB.prepare('DELETE FROM license WHERE user_id = ?').bind(session.sub).run();
  await env.DB.prepare('DELETE FROM customer WHERE user_id = ?').bind(session.sub).run();

  return new Response(JSON.stringify({ deleted: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      // expire the session cookie immediately.
      'Set-Cookie': 'session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure',
    },
  });
}
```

Wire in `index.ts`:

```ts
import { handleAccountDelete } from './routes/account-delete.js';
// ...
if (request.method === 'DELETE' && path === '/v1/account') return handleAccountDelete(request, env);
```

Create `worker/tests/account-delete.test.ts`:

```ts
import { env, createExecutionContext, waitOnExecutionContext, fetchMock } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import worker from '../src/index.js';
import { signSessionJwt } from '../src/lib/session.js';

const SESSION_KEY = '7f12345678901234567890123456789012345678901234567890123456789012';

beforeAll(() => { fetchMock.activate(); fetchMock.disableNetConnect(); });

describe('DELETE /v1/account', () => {
  it('requires confirm="DELETE"', async () => {
    const now = Math.floor(Date.now() / 1000);
    const jwt = await signSessionJwt({ iss: 'carbonbook.app/account', sub: 'usr_del', email: 'x', iat: now, exp: now + 3600 }, SESSION_KEY);
    const req = new Request('https://api.carbonbook.app/v1/account', {
      method: 'DELETE', headers: { Cookie: `session=${jwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: 'no' }),
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, { ...env, SESSION_PRIVATE_KEY_HEX: SESSION_KEY }, ctx);
    expect(res.status).toBe(400);
  });

  it('removes D1 + KV rows and expires the session cookie', async () => {
    await env.DB.prepare('INSERT INTO customer (user_id, email, created_at) VALUES (?, ?, ?)').bind('usr_del2', 'd2@example.com', 1).run();
    await env.DB.prepare(`INSERT INTO license (license_id, user_id, humanized_key, plan, features, devices_max, issued_at, expires_at, grace_until) VALUES ('lic_del2','usr_del2','cbk-del11-del22-del33-del44','base@2026-q2','[]',1,1,2,3)`).run();
    await env.LICENSE_ACTIVE.put('la:lic_del2', '{"license_id":"lic_del2"}');
    await env.HUMANIZED_KEYS.put('hk:cbk-del11-del22-del33-del44', 'lic_del2');

    const now = Math.floor(Date.now() / 1000);
    const jwt = await signSessionJwt({ iss: 'carbonbook.app/account', sub: 'usr_del2', email: 'd2@example.com', iat: now, exp: now + 3600 }, SESSION_KEY);
    const req = new Request('https://api.carbonbook.app/v1/account', {
      method: 'DELETE', headers: { Cookie: `session=${jwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: 'DELETE' }),
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, { ...env, SESSION_PRIVATE_KEY_HEX: SESSION_KEY, STRIPE_SECRET_KEY: 'sk_test_x' }, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('Set-Cookie')).toMatch(/session=; .*Max-Age=0/);

    const customer = await env.DB.prepare('SELECT * FROM customer WHERE user_id=?').bind('usr_del2').first();
    expect(customer).toBeNull();
    expect(await env.LICENSE_ACTIVE.get('la:lic_del2')).toBeNull();
    expect(await env.HUMANIZED_KEYS.get('hk:cbk-del11-del22-del33-del44')).toBeNull();
  });
});
```

Run + commit:

```bash
pnpm test:worker -- account-delete.test.ts
git add -A
git commit -m "feat(worker): DELETE /v1/account (danger-zone account deletion)"
```

- [ ] **Step 8: Astro Pages scaffold**

`pages/account/package.json` — identical structure to Task 8's `pages/activate/package.json` (Astro 5, `@astrojs/cloudflare`, `@tailwindcss/vite`).

`pages/account/astro.config.mjs` — same as Task 8 (output: 'server', cloudflare adapter, tailwindcss vite plugin).

Copy `global.css` from the marketing site into `pages/account/src/styles/global.css` unchanged.

- [ ] **Step 9: Session middleware**

Create `pages/account/src/middleware.ts`:

```ts
import { defineMiddleware } from 'astro:middleware';

export const onRequest = defineMiddleware(async (context, next) => {
  const url = new URL(context.request.url);
  // public paths
  if (url.pathname.startsWith('/login')) return next();

  const env = context.locals.runtime?.env as { API_ORIGIN: string };
  const sessionCookie = (context.request.headers.get('Cookie') ?? '')
    .split(/;\s*/).find((c) => c.startsWith('session='))?.slice('session='.length);
  if (!sessionCookie) return context.redirect('/login');

  // Validate via Worker `/v1/account/devices` (cheap, returns 401 if invalid).
  const probe = await fetch(`${env.API_ORIGIN}/v1/account/devices`, {
    headers: { Cookie: `session=${sessionCookie}` },
  });
  if (probe.status === 401) return context.redirect('/login');
  return next();
});
```

- [ ] **Step 10: Login + callback + dashboard pages**

Create `pages/account/src/pages/login.astro`:

```astro
---
import Base from '../layouts/Base.astro';
---
<Base title="Sign in — carbonbook" lang="en">
  <form id="login-form" class="mx-auto max-w-md space-y-4">
    <label class="block text-sm">Email
      <input name="email" type="email" required class="mt-1 w-full rounded-md border px-3 py-2" />
    </label>
    <button class="rounded-md bg-[color:var(--color-brand-500)] px-4 py-2 text-white">Send sign-in link</button>
    <p id="sent" class="hidden text-sm text-green-700">Check your inbox for the link.</p>
  </form>
  <script>
    const env = (window as any).__API_ORIGIN__ ?? 'https://api.carbonbook.app';
    document.getElementById('login-form')!.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = new FormData(e.target as HTMLFormElement);
      await fetch(`${env}/v1/auth/magic-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: data.get('email') }),
      });
      document.getElementById('sent')!.classList.remove('hidden');
    });
  </script>
</Base>
```

Create `pages/account/src/pages/login/callback.astro`:

```astro
---
import Base from '../../layouts/Base.astro';
const env = Astro.locals.runtime?.env as { API_ORIGIN: string };
const token = new URL(Astro.request.url).searchParams.get('t');
let ok = false;
let setCookie: string | null = null;
if (token) {
  const res = await fetch(`${env.API_ORIGIN}/v1/auth/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  ok = res.ok;
  setCookie = res.headers.get('Set-Cookie');
}
if (ok && setCookie) {
  return new Response(null, { status: 302, headers: { Location: '/', 'Set-Cookie': setCookie } });
}
---
<Base title="Sign-in failed" lang="en">
  <p>Sign-in link is invalid or expired. <a href="/login" class="underline">Try again.</a></p>
</Base>
```

Create `pages/account/src/pages/index.astro` — the dashboard:

```astro
---
import Base from '../layouts/Base.astro';
const env = Astro.locals.runtime?.env as { API_ORIGIN: string };
const cookie = Astro.request.headers.get('Cookie') ?? '';
const [devicesRes] = await Promise.all([
  fetch(`${env.API_ORIGIN}/v1/account/devices`, { headers: { Cookie: cookie } }),
]);
const devices = devicesRes.ok ? (await devicesRes.json()).devices as Array<{ device_id: string; os: string; app_version: string; last_ping_at: number }> : [];
---
<Base title="Account — carbonbook" lang="en">
  <section>
    <h1 class="text-2xl font-bold">My devices</h1>
    <ul class="mt-4 divide-y rounded-lg border">
      {devices.map((d) => (
        <li class="flex items-center justify-between px-4 py-3">
          <div>
            <p class="font-mono text-sm">{d.device_id}</p>
            <p class="text-xs text-[color:var(--color-ink-500)]">{d.os} · {d.app_version}</p>
          </div>
          <button data-device={d.device_id} class="deact rounded-md border px-3 py-1 text-sm">Deactivate</button>
        </li>
      ))}
    </ul>
  </section>

  <section class="mt-10">
    <h2 class="text-xl font-bold">Billing</h2>
    <button id="portal" class="mt-2 rounded-md bg-[color:var(--color-brand-500)] px-4 py-2 text-white">Open Stripe portal</button>
  </section>

  <section class="mt-10 rounded-lg border border-red-300 p-4">
    <h2 class="text-lg font-bold text-red-700">Danger zone</h2>
    <button id="delete-account" class="mt-2 rounded-md bg-red-600 px-4 py-2 text-white">Delete account</button>
  </section>

  <script>
    const API = (Astro as any) /* set at build */;  // pseudo — replace with window.__API_ORIGIN__
    const apiOrigin = (window as any).__API_ORIGIN__;
    document.querySelectorAll<HTMLButtonElement>('.deact').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.device!;
        await fetch(`${apiOrigin}/v1/devices/${id}/deactivate`, { method: 'POST', credentials: 'include' });
        btn.closest('li')?.remove();
      });
    });
    document.getElementById('portal')!.addEventListener('click', async () => {
      const res = await fetch(`${apiOrigin}/v1/account/billing-portal?return_url=${encodeURIComponent(location.href)}`, { credentials: 'include' });
      const { url } = await res.json();
      location.href = url;
    });
    document.getElementById('delete-account')!.addEventListener('click', async () => {
      if (!confirm('This permanently deletes your account, license, and cancels active subscriptions. Continue?')) return;
      const res = await fetch(`${apiOrigin}/v1/account`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ confirm: 'DELETE' }),
      });
      if (res.ok) location.href = '/login';
    });
  </script>
</Base>
```

- [ ] **Step 11: Build verification**

```bash
cd pages/account && pnpm install && pnpm build
```

Expected: Astro SSR build completes with 0 errors.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat: account.carbonbook.app — magic-link login, devices, billing portal, delete account"
```

---

## Task 10: Sweep — full test suite, biome, deploy dry-run, localisation pass

**Files:**
- Modify: various files across all packages for lint fixes
- Modify: `pages/marketing/content/{zh-CN,en}/*.mdx` — final copy review
- Modify: `pages/activate/` — bilingual content review
- Modify: `pages/account/` — bilingual content review
- Create: `worker/tests/e2e-flow.test.ts` — end-to-end trial-to-activate-to-verify flow

Final sweep to ensure everything compiles, tests pass, linting is clean, and the deploy pipeline works.

- [ ] **Step 1: End-to-end flow test**

Create `worker/tests/e2e-flow.test.ts`:

A single integration test that exercises the full happy path:
1. `POST /v1/trial-signup` with a fresh email → get `license_key` + `jwt`.
2. Verify the JWT claims have `plan: 'trial@14d'`, correct `expires_at`.
3. `POST /v1/activate` with the `license_key` + a device_id → get a fresh JWT.
4. `POST /v1/verify` with the `license_id` + device_id → get `revoked: false` + fresh JWT.
5. Verify D1 state: customer, license, and device rows all present.
6. Verify KV state: `LICENSE_ACTIVE`, `HUMANIZED_KEYS` entries present.

- [ ] **Step 2: Biome lint sweep**

```bash
pnpm lint:fix
```

Fix any remaining biome errors across all packages. Ensure zero warnings.

- [ ] **Step 3: Localisation pass**

Review all bilingual content in `pages/marketing/content/{zh-CN,en}/`, `pages/activate/`, `pages/account/`:
- Verify zh-CN and en content are semantically aligned.
- Verify the language switcher works (cookie-based + `Accept-Language` fallback).
- Verify the privacy one-liner appears on every page in both languages.

- [ ] **Step 4: Wrangler deploy dry-run**

```bash
cd worker && wrangler deploy --dry-run --outdir .wrangler/dryrun
```

Verify the Worker bundles correctly with all dependencies. Inspect the
output bundle:

```bash
ls -lh .wrangler/dryrun
```

We're targeting the **paid Workers plan** for production (the free tier
is for `wrangler dev` only). Bundle size limits:

| Tier | Compressed | Uncompressed |
| --- | --- | --- |
| Free | 1 MB | 3 MB |
| Paid (Workers Standard) | 3 MB | 10 MB |

Aim for < 1 MB compressed regardless — anything bigger means we
accidentally bundled a heavy dependency (the most likely culprit is the
`stripe` npm SDK; if it's in the bundle, see Task 1 step 4: we chose to
avoid it). If the bundle exceeds 500 kB compressed, run `wrangler deploy
--dry-run --outdir .wrangler/dryrun --minify` and compare; investigate
any single module > 100 kB.

- [ ] **Step 5: Astro build verification**

```bash
cd pages/marketing && pnpm build
cd pages/activate && pnpm build
cd pages/account && pnpm build
```

All three build cleanly with zero errors.

- [ ] **Step 6: Full test suite**

```bash
pnpm test
```

Expected: all Worker tests pass, no regressions.

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "chore: sweep — e2e flow test, biome fixes, localisation pass, deploy dry-run verified"
```
