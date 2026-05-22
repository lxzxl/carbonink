# Phase 4 Sub-project G — carbonbook-cloud Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the `carbonbook-cloud` repo — a Cloudflare-native backend + static web surface that issues Ed25519 license JWTs, processes Stripe payments, serves auto-update manifests, and hosts the marketing / activation / account portal pages at `carbonbook.app`. When complete, the Electron client's `LicenseService.setJwt()` and future `/activate` + `/verify` HTTP wrappers have a live server to talk to.

**Architecture:** One Cloudflare Worker dispatches all API routes (`/v1/activate`, `/v1/verify`, `/v1/trial-signup`, `/v1/stripe-webhook`, `/v1/updates/{channel}/manifest.json`, and account-portal edge functions). Three Cloudflare Pages projects (`pages/marketing`, `pages/activate`, `pages/account`) handle the public-facing web surfaces. D1 is the source of truth; KV is the hot-path cache for license lookups + rate limiting; R2 stores release binaries.

```
carbonbook-cloud/
  worker/                  ← Cloudflare Worker (API)
    src/
      index.ts             ← Router entrypoint
      routes/              ← activate.ts, verify.ts, trial-signup.ts, stripe-webhook.ts, updates.ts, devices.ts
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

**Tech Stack:** TypeScript strict, Cloudflare Workers (wrangler 4.x), D1 (edge SQLite), Workers KV, R2, Cloudflare Pages, Astro 5, Tailwind CSS v4, Stripe SDK (stripe for server, @stripe/stripe-js for client-side Checkout redirect), @noble/ed25519 + @noble/curves for EdDSA JWT signing, Resend for transactional email, vitest + miniflare for Worker testing, biome for lint+format, pnpm workspaces.

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
- Client verifies via `node:crypto` Ed25519 SPKI — cloud signs with matching private key via `@noble/ed25519`

**Discipline reminder for implementers:**
- This is a NEW repo. Task 1 scaffolds it from scratch.
- Each task is independently committable. Run `biome check` and `vitest run` before every commit.
- Worker tests use `unstable_dev` / miniflare — no live Cloudflare account needed during development.
- Secrets (`LICENSE_PRIVATE_KEY_PEM`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_SECRET_KEY`, `RESEND_API_KEY`, `SESSION_PRIVATE_KEY_PEM`) are never committed; `.dev.vars` holds dev values and is gitignored.

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
mkdir -p carbonbook-cloud && cd carbonbook-cloud
git init
```

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
    "stripe": "^17.0.0",
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

  // Write back with TTL = remaining window + small buffer
  const ttlS = Math.max(counter.resetAt - nowSeconds, 1) + 5;
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
- Create: `worker/src/routes/activate.ts`
- Create: `worker/src/routes/verify.ts`
- Modify: `worker/src/index.ts` — wire routes
- Create: `worker/tests/activate.test.ts`
- Create: `worker/tests/verify.test.ts`

These are the two endpoints the Electron client talks to. `/activate` is called when the user pastes a license key; `/verify` is the background ping every 7 days.

- [ ] **Step 1: `/v1/activate` route handler**

Create `worker/src/routes/activate.ts`:

Implements the flow from cloud spec section 4:
1. Zod-parse the request body with `activateRequestSchema`.
2. Normalize the humanized key via `normalizeHumanizedKey`.
3. Look up `HUMANIZED_KEYS[normalized]` to get the `license_id`.
4. Read `LICENSE_ACTIVE[license_id]` for the `LicenseActiveRecord`.
5. If not found → 404 `UnknownKey`.
6. If `revoked` → 403 `RevokedLicense`.
7. Rate limit check: `RATE_LIMIT` scope `activate`, identifier = normalized key, config = `RATE_LIMIT_ACTIVATE`. If blocked → 429 `RateLimited`.
8. If `device_ids.length >= devices_max` AND `device_id` not already in list → 409 `DeviceCapReached`.
9. Append `device_id` (idempotent — skip if already present).
10. Upsert `device` row in D1 (`INSERT OR REPLACE`).
11. Update `LICENSE_ACTIVE` KV with the new `device_ids` array.
12. Sign a fresh JWT via `signLicenseJwt` with `revocation_check_after = now + 7d`.
13. Return `{ jwt, claims }`.

- [ ] **Step 2: `/v1/verify` route handler**

Create `worker/src/routes/verify.ts`:

Implements the flow from cloud spec section 4:
1. Zod-parse with `verifyRequestSchema`.
2. Read `LICENSE_ACTIVE[license_id]`.
3. If not found → 404.
4. Rate limit check: scope `verify`, identifier = `device_id`, config = `RATE_LIMIT_VERIFY`.
5. If `revoked` → return `{ revoked: true, reason }`.
6. Sign a fresh JWT with `revocation_check_after = now + 7d`.
7. Update D1 `device.last_ping_at` and `device.app_version`.
8. Return `{ jwt, claims, revoked: false }`.

- [ ] **Step 3: Wire routes in index.ts**

Add route dispatch to `worker/src/index.ts`:

```ts
if (request.method === 'POST' && path === '/v1/activate') {
  return handleActivate(request, env, ctx);
}
if (request.method === 'POST' && path === '/v1/verify') {
  return handleVerify(request, env, ctx);
}
```

- [ ] **Step 4: Integration tests for /activate**

Create `worker/tests/activate.test.ts`:

Seed D1 with a customer + license + KV entries (`LICENSE_ACTIVE`, `HUMANIZED_KEYS`) in `beforeEach`. Test:
- Successful activation returns 200 with valid JWT.
- Unknown key returns 404 with `_tag: 'UnknownKey'`.
- Revoked license returns 403 with `_tag: 'RevokedLicense'`.
- Device cap reached returns 409 with `_tag: 'DeviceCapReached'`.
- Second activation with same device_id is idempotent (still 200, device_ids unchanged).
- Rate limiting kicks in after 10 rapid requests.

- [ ] **Step 5: Integration tests for /verify**

Create `worker/tests/verify.test.ts`:

Seed same way. Test:
- Successful verify returns 200 with `revoked: false` and a fresh JWT.
- Revoked license returns `{ revoked: true, reason }`.
- Unknown license_id returns 404.
- Rate limiting kicks in after 6 rapid requests.

- [ ] **Step 6: Run tests + commit**

```bash
pnpm test:worker && pnpm lint
git add -A
git commit -m "feat: /v1/activate and /v1/verify endpoints with rate limiting"
```

---

## Task 5: `/v1/trial-signup` endpoint + email integration

**Files:**
- Create: `worker/src/routes/trial-signup.ts`
- Create: `worker/src/lib/email.ts`
- Modify: `worker/src/index.ts` — wire route
- Create: `worker/tests/trial-signup.test.ts`

Trial signup creates a customer, issues a 14-day trial license, and (best-effort) sends a welcome email with the license key.

- [ ] **Step 1: Resend email client**

Create `worker/src/lib/email.ts`:

A thin wrapper around Resend's HTTP API (no SDK needed — single `POST /emails`):
- `sendActivationEmail(apiKey, to, licenseKey, lang)` — sends the humanized key + instructions.
- `sendMagicLinkEmail(apiKey, to, url, lang)` — used later by the account portal.
- Both are fire-and-forget (`ctx.waitUntil(...)`) — failure doesn't block the API response.
- Template strings are bilingual (zh-CN / en) based on `lang` parameter.

- [ ] **Step 2: `/v1/trial-signup` route handler**

Create `worker/src/routes/trial-signup.ts`:

Implements the flow from cloud spec section 4:
1. Zod-parse with `trialSignupRequestSchema`.
2. Rate limit: scope `trial`, identifier = request IP (`request.headers.get('cf-connecting-ip')`), config = `RATE_LIMIT_TRIAL`. If blocked → 429.
3. Check D1 for existing customer by email.
   - If exists AND has a trial license → return existing `{ license_key, jwt }` (idempotent). If the trial was issued > 7 days ago, re-sign the JWT with refreshed `revocation_check_after`.
   - If exists but NOT trial (paid customer) → return 409 `AlreadyPaid`.
4. Generate `usr_` + ULID, `lic_` + ULID, humanized key.
5. Insert `customer` row, `license` row with `plan='trial@14d'`, `expires_at = now + 14d`, `grace_until = now + 44d`, `devices_max = 1`.
6. Insert `device` row.
7. Write KV: `HUMANIZED_KEYS[key] = license_id`, `LICENSE_ACTIVE[license_id] = {...}`.
8. Sign JWT, return `{ license_key, jwt }`.
9. `ctx.waitUntil(sendActivationEmail(...))`.

- [ ] **Step 3: Integration tests**

Create `worker/tests/trial-signup.test.ts`:

- Successful signup returns 200 with `license_key` matching `cbk-*` format and a valid JWT.
- Same email again returns the same license (idempotent).
- IP rate limit blocks after 5 signups per day.
- Invalid email format returns 400.
- Verify the D1 customer + license rows were created.

- [ ] **Step 4: Run tests + commit**

```bash
pnpm test:worker && pnpm lint
git add -A
git commit -m "feat: /v1/trial-signup endpoint with Resend email + IP rate limiting"
```

---

## Task 6: `/v1/stripe-webhook` endpoint

**Files:**
- Create: `worker/src/routes/stripe-webhook.ts`
- Create: `worker/src/lib/stripe.ts`
- Modify: `worker/src/index.ts` — wire route
- Create: `worker/tests/stripe-webhook.test.ts`

Handles Stripe webhook events: checkout completion (new license), invoice payment (renewal), subscription deletion (deferred revocation), and charge refund (deferred revocation).

- [ ] **Step 1: Stripe signature verification helper**

Create `worker/src/lib/stripe.ts`:

- `verifyStripeSignature(payload, sigHeader, secret)` — HMAC-SHA256 verification using Web Crypto API (no Stripe SDK needed for just verification). Returns `{ valid: boolean, event?: Stripe.Event }`.
- `createCheckoutSession(secretKey, params)` — thin fetch wrapper for creating a Stripe Checkout Session (used by the pricing page's server-side redirect).

- [ ] **Step 2: Webhook handler**

Create `worker/src/routes/stripe-webhook.ts`:

1. Read raw body + `stripe-signature` header.
2. Verify signature via `verifyStripeSignature`. If invalid → 400.
3. Switch on `event.type`:

   **`checkout.session.completed`**:
   - Extract `metadata.plan`, `customer_details.email`, `subscription` from the event.
   - Look up or create `customer` row by email.
   - Create `license` row with the plan's features/duration/grace.
   - Generate humanized key, write KV entries.
   - Sign JWT.
   - `ctx.waitUntil(sendActivationEmail(...))`.
   - Return 200.

   **`invoice.payment_succeeded`**:
   - Find `license` by `stripe_subscription_id`.
   - Bump `expires_at += 1 year`, `grace_until += 1 year`.
   - Re-sign JWT, update KV `LICENSE_ACTIVE`.
   - Return 200.

   **`customer.subscription.deleted`**:
   - Find `license` by `stripe_subscription_id`.
   - Schedule revocation: set `revoked = true`, `revoked_at = event_time + 30d buffer`, `revoked_reason = 'subscription_cancelled'`.
   - Update KV `LICENSE_ACTIVE` and `REVOCATION_SET`.
   - Return 200.

   **`charge.refunded`**:
   - Same revocation flow as `subscription.deleted` but with `revoked_reason = 'refund'`.

4. Unknown event type → log + return 200 (don't reject).

- [ ] **Step 3: Tests**

Create `worker/tests/stripe-webhook.test.ts`:

- Mock Stripe events with valid HMAC signatures (compute in test using the test webhook secret).
- Test `checkout.session.completed` creates customer + license + KV entries.
- Test `invoice.payment_succeeded` bumps `expires_at`.
- Test `customer.subscription.deleted` sets `revoked = true` in KV.
- Test invalid signature returns 400.
- Test unknown event type returns 200 (no error).

- [ ] **Step 4: Run tests + commit**

```bash
pnpm test:worker && pnpm lint
git add -A
git commit -m "feat: Stripe webhook handler — checkout, renewal, cancellation, refund"
```

---

## Task 7: `/v1/updates/{channel}/manifest.json` + marketing site scaffold

**Files:**
- Create: `worker/src/routes/updates.ts`
- Modify: `worker/src/index.ts` — wire route
- Create: `worker/tests/updates.test.ts`
- Create: `pages/marketing/package.json`
- Create: `pages/marketing/astro.config.ts`
- Create: `pages/marketing/tsconfig.json`
- Create: `pages/marketing/tailwind.config.ts`
- Create: `pages/marketing/src/layouts/Base.astro`
- Create: `pages/marketing/src/pages/index.astro`
- Create: `pages/marketing/src/pages/pricing.astro`
- Create: `pages/marketing/src/pages/download.astro`
- Create: `pages/marketing/src/pages/privacy.astro`
- Create: `pages/marketing/src/components/Nav.astro`
- Create: `pages/marketing/src/components/Footer.astro`
- Create: `pages/marketing/src/components/Hero.astro`
- Create: `pages/marketing/src/components/ProblemSection.astro`
- Create: `pages/marketing/src/components/SolutionSteps.astro`
- Create: `pages/marketing/src/components/PricingCards.astro`
- Create: `pages/marketing/content/{zh-CN,en}/home.mdx`
- Create: `pages/marketing/content/{zh-CN,en}/pricing.mdx`

Two deliverables in one task: the auto-update manifest endpoint (simple, tests existing Worker) and the marketing site scaffold (Astro 5 project with all page shells).

- [ ] **Step 1: Auto-update manifest route**

Create `worker/src/routes/updates.ts`:

1. Parse channel from URL path (`/v1/updates/{channel}/manifest.json`). Valid channels: `stable`, `beta`.
2. Read manifest from R2: `RELEASES.get(`updates/${channel}/manifest.json`)`.
3. If not found → 404.
4. Return the JSON with appropriate cache headers (`Cache-Control: public, max-age=300` — 5 min).
5. The manifest shape follows `electron-updater`'s `latest.yml` format but served as JSON:

```json
{
  "version": "0.5.0",
  "files": [
    {
      "url": "https://releases.carbonbook.app/darwin-arm64/0.5.0/carbonbook-0.5.0-arm64.dmg",
      "sha512": "...",
      "size": 84629184
    }
  ],
  "releaseDate": "2026-06-01T00:00:00Z"
}
```

Wire in `index.ts`:

```ts
if (request.method === 'GET' && path.startsWith('/v1/updates/')) {
  return handleUpdates(request, env, ctx);
}
```

- [ ] **Step 2: Update manifest tests**

Create `worker/tests/updates.test.ts`:

- Seed R2 with a test manifest in `beforeEach`.
- `GET /v1/updates/stable/manifest.json` returns 200 with correct body.
- `GET /v1/updates/beta/manifest.json` returns 404 when no beta manifest exists.
- Invalid channel returns 400.
- Response has `Cache-Control` header.

- [ ] **Step 3: Marketing site Astro scaffold**

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
    "@astrojs/tailwind": "^6.0.0",
    "tailwindcss": "^4.1.0"
  }
}
```

`pages/marketing/astro.config.ts`:

```ts
import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';

export default defineConfig({
  integrations: [tailwind()],
  i18n: {
    defaultLocale: 'zh-CN',
    locales: ['zh-CN', 'en'],
    routing: { prefixDefaultLocale: false },
  },
});
```

- [ ] **Step 4: Layout + page shells**

Create `Base.astro` layout with:
- `<html lang={...}>`, dark mode via `prefers-color-scheme`.
- Inter (variable) + Source Han Sans fonts.
- Shared color tokens via CSS custom properties (matching desktop app).
- `<Nav>` with logo, lang switcher, Download CTA.
- `<Footer>` with links: About, Pricing, Docs, Privacy, Terms, Support.
- Privacy one-liner at bottom of every page.

Create page shells for:
- `index.astro` — Hero + Problem + Solution + Differentiators + Pricing summary.
- `pricing.astro` — Plan cards (Trial / Base / CBAM coming soon) + FAQ accordion.
- `download.astro` — Platform detection, download buttons for macOS/Windows.
- `privacy.astro` — Full privacy disclosure table.

All pages render bilingual content from `content/{zh-CN,en}/*.mdx` files.

- [ ] **Step 5: Verify marketing site builds**

```bash
cd pages/marketing && pnpm install && pnpm build
```

Expected: Astro outputs static HTML to `dist/`. No runtime errors.

- [ ] **Step 6: Run all tests + commit**

```bash
pnpm test:worker && pnpm lint
git add -A
git commit -m "feat: auto-update manifest endpoint + marketing site scaffold (Astro 5)"
```

---

## Task 8: Activate page (`activate.carbonbook.app`)

**Files:**
- Create: `pages/activate/package.json`
- Create: `pages/activate/astro.config.ts`
- Create: `pages/activate/tsconfig.json`
- Create: `pages/activate/src/layouts/Base.astro`
- Create: `pages/activate/src/pages/index.astro`
- Create: `pages/activate/src/components/LicenseKeyCard.astro`

A single-purpose page the user lands on after Stripe checkout or clicking the email link. Renders the humanized license key with copy-to-clipboard and step-by-step instructions.

- [ ] **Step 1: Astro project scaffold**

Same pattern as marketing: Astro 5 + Tailwind v4. Shared base layout from the same design tokens.

`pages/activate/astro.config.ts`:

```ts
import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  integrations: [tailwind()],
  output: 'server',            // SSR for edge function (session_id lookup)
  adapter: cloudflare(),
  i18n: {
    defaultLocale: 'zh-CN',
    locales: ['zh-CN', 'en'],
    routing: { prefixDefaultLocale: false },
  },
});
```

- [ ] **Step 2: Activate page with edge function logic**

The page handles three URL states:

1. `?session_id=cs_...` — POST-Stripe-Checkout. The edge function calls Stripe's Checkout Session API to get `metadata.license_key` (set by the webhook handler), renders it.
2. `?key=cbk-...` — Direct link from email. Render the key directly (no lookup).
3. Neither — Empty state with "Check your email for the activation link" message.

`LicenseKeyCard.astro` component:
- Large monospace display of `cbk-XXXXX-XXXXX-XXXXX-XXXXX`.
- Copy button (small client-side `<script>` using `navigator.clipboard.writeText`).
- Numbered instructions: (1) Open carbonbook (2) Avatar -> Settings (3) Paste key.
- Download links if the app isn't installed yet.

- [ ] **Step 3: Bilingual content**

Both zh-CN and en variants for all copy. Language detection from `Accept-Language` header, overridable by `?lang=` query param.

- [ ] **Step 4: Build + commit**

```bash
cd pages/activate && pnpm install && pnpm build
pnpm lint
git add -A
git commit -m "feat: activate.carbonbook.app — license key delivery page"
```

---

## Task 9: Account portal (`account.carbonbook.app`)

**Files:**
- Create: `pages/account/package.json`
- Create: `pages/account/astro.config.ts`
- Create: `pages/account/tsconfig.json`
- Create: `pages/account/src/layouts/Base.astro`
- Create: `pages/account/src/pages/login.astro`
- Create: `pages/account/src/pages/login/callback.astro`
- Create: `pages/account/src/pages/index.astro` (dashboard)
- Create: `pages/account/src/components/DeviceList.astro`
- Create: `pages/account/src/components/PlanCard.astro`
- Create: `pages/account/src/middleware.ts` (session cookie validation)
- Create: `worker/src/routes/devices.ts` — `POST /v1/devices/{device_id}/deactivate`
- Modify: `worker/src/index.ts` — wire devices route
- Create: `worker/tests/devices.test.ts`

The authenticated portal with magic-link login, device management, and Stripe Customer Portal integration.

- [ ] **Step 1: Magic-link auth flow**

`/login` page:
- Email input + "Send login link" button.
- POST to Worker: generates a 15-minute single-use token (random 32 bytes, stored in KV with TTL 900), emails `https://account.carbonbook.app/login/callback?t={token}` via Resend.
- Returns "Check your email" confirmation.

`/login/callback` page (edge function):
- Reads `?t=` token, looks up in KV, validates not expired.
- Exchanges token for a session cookie: a JWT signed with `SESSION_PRIVATE_KEY_HEX` (distinct from license key), containing `{ user_id, email, iat, exp }`. Cookie: `session`, 30 days, HttpOnly, SameSite=Lax, Secure.
- Deletes the token from KV (single-use).
- Redirects to `/`.

Wire Worker endpoints:
- `POST /v1/auth/magic-link` — generates token + sends email.
- `POST /v1/auth/exchange` — exchanges token for session JWT.

- [ ] **Step 2: Session middleware**

`pages/account/src/middleware.ts`:
- Reads `session` cookie from request.
- Verifies JWT signature with session public key (derived from `SESSION_PRIVATE_KEY_HEX`).
- If valid, sets `locals.user = { user_id, email }`.
- If invalid/missing + path !== `/login` → redirect to `/login`.

- [ ] **Step 3: Dashboard page**

`/` (post-login):
- **My Plan card**: plan name, expiry date, days remaining. Buttons: [Renew] [Switch to annual] [Cancel] — all three redirect to Stripe Customer Portal URL (fetched from Worker: `GET /v1/account/billing-portal?return_url=...`).
- **My Devices list**: fetched from Worker (`GET /v1/account/devices`). Each row shows device_id (truncated), app version, OS, last seen. [Deactivate] button calls `POST /v1/devices/{device_id}/deactivate`.
- **Invoices**: link to Stripe Customer Portal invoices section.
- **Danger zone**: Cancel subscription, Delete account.

- [ ] **Step 4: Device deactivation Worker endpoint**

Create `worker/src/routes/devices.ts`:

`POST /v1/devices/{device_id}/deactivate`:
1. Requires session authentication (session JWT in cookie or Authorization header).
2. Look up the license associated with the authenticated user.
3. Remove `device_id` from `LICENSE_ACTIVE[license_id].device_ids`.
4. Delete the `device` row from D1.
5. Return 200.

Wire in `index.ts`.

- [ ] **Step 5: Worker account endpoints**

Add to Worker:
- `GET /v1/account/devices` — returns devices for the authenticated user.
- `GET /v1/account/billing-portal` — creates a Stripe Billing Portal session, returns the URL.
- `POST /v1/auth/magic-link` — generates + emails the magic link.
- `POST /v1/auth/exchange` — exchanges token for session cookie.

All require session authentication except the auth endpoints.

- [ ] **Step 6: Tests for device deactivation**

Create `worker/tests/devices.test.ts`:

- Successful deactivation removes device from KV and D1.
- Deactivating a non-existent device returns 404.
- Unauthenticated request returns 401.
- After deactivation, `device_ids` length decreases by 1.

- [ ] **Step 7: Build + commit**

```bash
cd pages/account && pnpm install && pnpm build
pnpm test:worker && pnpm lint
git add -A
git commit -m "feat: account.carbonbook.app — magic-link auth, device management, Stripe portal"
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
cd worker && wrangler deploy --dry-run
```

Verify the Worker bundles correctly with all dependencies. Check bundle size stays under the 1 MB free-tier limit.

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
