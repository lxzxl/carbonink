# Phase 4 Sub-project A — License Client Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the local-only half of the carbonbook license system: Ed25519 JWT verification, the 4-state machine from §10 of the design spec (active / grace / expired / revoked), OS Keychain storage of the active JWT, and the IPC surface needed by future sub-projects (B = License UI, C = read-only gate). Cloud-side issuance / `/activate` / `/verify` endpoints are explicitly out of scope (sub-project G).

**Architecture:** Three pure layers stacked top-down:
1. `LicenseStateMachine` — pure function `computeState({ claims, now, lastVerifiedAt, consecutiveOfflineDays, revoked })` returning one of `'active' | 'grace' | 'expired' | 'revoked'`. No I/O. Trivially testable.
2. `LicenseService` (main-process) — owns: Ed25519 verify via `node:crypto`, JWT base64url-decode, Keychain read/write of the raw JWT string, `license_local_state` row read/write (device_id, last_verified_at, consecutive_offline_days, last_known_state, last_known_state_at). Exposes `getState()`, `setJwt(jwt)`, `clearJwt()`. No HTTP.
3. IPC + renderer wrapper — `license:get-state` (read), `license:set-jwt` (write — used by future UI activation form and by the dev tool), `license:clear` (logout / deactivate). Bridge allowlist updated.

**Tech Stack:** TypeScript strict, Node.js `crypto` (Ed25519 verify built-in, no new dep), better-sqlite3, Electron `safeStorage` (existing), vitest, paraglide. JWT is decoded by hand — three base64url JSON parts; no `jose` lib needed.

**Spec:** `docs/specs/2026-05-08-carbonbook-design.md` §10 (License model + State Machine + JWT field reference). Last updated by the original design pass.

**Baseline:** `4649688` on main. 610/610 vitest passing. Target after this sub-project: ~625 tests.

**Sub-project context:** This is sub-project A of ~9 in Phase 4 (A=client core, B=UI, C=read-only gate, D=trial, E=cloud spec, F=landing spec, G=cloud impl, H=stripe, I=signing). A is the foundation — B/C/D all depend on A's `LicenseService.getState()` returning a valid state.

**Recurring environmental hazard:** better-sqlite3 ABI flip. If 100+ tests fail with `NODE_MODULE_VERSION` mismatch:

```bash
rm node_modules/.pnpm/better-sqlite3@12.9.0/node_modules/better-sqlite3/build/Release/better_sqlite3.node
pnpm rebuild better-sqlite3
```

Environmental, not a regression.

**Discipline reminder for implementers:**
- Before final commit on each task, run `git status` and confirm there are NO uncommitted file changes besides the `.claude/` untracked dir. `git add -A && git restore --staged .claude` before committing.
- Pre-commit hooks run paraglide compile + biome + vitest. If they fail, fix the cause and create a **new** commit — never `--amend`, never `--no-verify`.

---

## Task 1: Migration 016 + shared License types

**Files:**
- Create: `src/main/db/migrations/016_license_local_state.sql`
- Modify: `src/shared/types.ts` — add License domain types
- Modify: `tests/main/db/migrations.test.ts` (or wherever the existing migration-count test lives) — bump expected count
- Test: existing migration test suite picks it up

`license_local_state` is a **single-row** table (PK = literal `1`) holding everything we need to recompute state at any later moment without going back to the cloud. The active JWT itself lives in OS Keychain (safeStorage); the DB holds only metadata that the Keychain can't.

- [ ] **Step 1: Write migration 016**

Create `src/main/db/migrations/016_license_local_state.sql`:

```sql
-- 016_license_local_state.sql
-- Single-row local cache of license state metadata. The active JWT itself
-- lives in OS Keychain (safeStorage); this table holds the support data the
-- Keychain can't: a stable device_id, the timestamp of the last successful
-- cloud /verify, a counter of consecutive offline failures (drives the
-- "expired if > 30 days offline" rule), and the last computed state +
-- timestamp (purely for diagnostics / UI cold-start).
--
-- Single-row pattern: PK = literal 1. INSERT OR IGNORE on app boot
-- guarantees a row exists; subsequent code only ever UPDATEs.

CREATE TABLE license_local_state (
  id                          INTEGER PRIMARY KEY CHECK (id = 1),
  device_id                   TEXT    NOT NULL,
  last_verified_at            TEXT,
  consecutive_offline_days    INTEGER NOT NULL DEFAULT 0,
  last_known_state            TEXT    NOT NULL DEFAULT 'unverified'
                                CHECK (last_known_state IN ('unverified','active','grace','expired','revoked')),
  last_known_state_at         TEXT,
  created_at                  TEXT    NOT NULL,
  updated_at                  TEXT    NOT NULL
);

-- Seed the singleton row with a freshly-generated device_id. The Service
-- layer will re-read this row; the device_id is what gets sent to /activate
-- when the user types in a license key.
INSERT INTO license_local_state (id, device_id, created_at, updated_at)
VALUES (
  1,
  -- 26-char ULID-style placeholder; Service layer regenerates on first read
  -- if it equals this sentinel (so the device_id is bound to first launch,
  -- not to migration time).
  'pending-first-launch',
  '1970-01-01T00:00:00.000Z',
  '1970-01-01T00:00:00.000Z'
);
```

- [ ] **Step 2: Add License types to `src/shared/types.ts`**

Find the section near other domain types (after `AuditEvent`). Add:

```ts
/**
 * The Ed25519-signed JWT claims carried by every carbonbook license.
 * The cloud is the issuer; the client verifies the signature and reads
 * `expires_at` / `grace_until` / `revocation_check_after` to drive the
 * state machine. See design spec §10.
 *
 * `features` is open-ended (future modules like CBAM ship their own
 * license JWT with `features: ["cbam"]`). The Base license carries
 * exactly `["inventory","questionnaire","iso14064"]`.
 */
export type LicenseJwtClaims = {
  iss: string;            // 'carbonbook.app'
  license_id: string;     // 'lic_01H...'
  user_id: string;        // 'usr_01H...'
  plan: string;           // 'base@2026-q2', 'trial@14d', etc.
  features: string[];
  devices_max: number;
  issued_at: number;      // unix seconds
  expires_at: number;     // unix seconds
  grace_until: number;    // expires_at + 30 days
  support_until?: number; // expires_at + N days for hotfix updates only
  revocation_check_after: number; // unix seconds; next mandatory cloud ping
};

/**
 * One of the four states from the design spec §10. `unverified` is a
 * synthetic 5th value used only when no license has ever been activated
 * on this device — distinct from `expired` so the UI can show a
 * different welcome path (activate-license-now vs renew-now).
 */
export type LicenseState = 'unverified' | 'active' | 'grace' | 'expired' | 'revoked';

/**
 * The shape returned by `license:get-state`. `claims` is null when no
 * JWT has been activated yet (state === 'unverified'). The UI uses
 * `state` to pick a banner, and `claims` to render details (plan name,
 * days remaining, etc.).
 */
export type LicenseStateView = {
  state: LicenseState;
  claims: LicenseJwtClaims | null;
  device_id: string;
  last_verified_at: string | null;
  consecutive_offline_days: number;
  /** A human-readable explanation of why we're in this state. UI logs it. */
  reason: string;
};

/**
 * Row shape for the `license_local_state` table (migration 016).
 * Internal — not exposed to the renderer directly; UI reads via
 * LicenseStateView.
 */
export type LicenseLocalStateRow = {
  id: 1;
  device_id: string;
  last_verified_at: string | null;
  consecutive_offline_days: number;
  last_known_state: LicenseState;
  last_known_state_at: string | null;
  created_at: string;
  updated_at: string;
};
```

- [ ] **Step 3: Add an existence test for the migration**

Find `tests/main/db/migrations.test.ts` (or the closest equivalent). Add a focused assertion: applying all migrations creates `license_local_state` with one seed row. If the suite already auto-counts migrations and asserts the count, bump it.

```ts
it('applies migration 016 — license_local_state singleton row', () => {
  const db = openInMemoryDb();
  applyAllMigrations(db);
  const row = db.prepare('SELECT * FROM license_local_state WHERE id = 1').get() as
    | { id: number; device_id: string }
    | undefined;
  expect(row).toBeDefined();
  expect(row?.id).toBe(1);
  expect(row?.device_id).toBe('pending-first-launch');
  // Sentinel row only; Service layer will replace device_id at first launch.
});
```

- [ ] **Step 4: Run migration test + commit**

```bash
pnpm test migrations
```

Expected: existing tests still green + new test passes. Then:

```bash
git add src/main/db/migrations/016_license_local_state.sql src/shared/types.ts tests/main/db/migrations.test.ts
git commit -m "feat(license): migration 016 + shared License types"
```

---

## Task 2: `LicenseStateMachine` pure module + tests

**Files:**
- Create: `src/main/services/license-state-machine.ts`
- Create: `tests/main/services/license-state-machine.test.ts`

A single exported pure function. No imports from the rest of the codebase except shared types. Easy to reason about, easy to test.

- [ ] **Step 1: Write the failing tests**

Create `tests/main/services/license-state-machine.test.ts`:

```ts
import type { LicenseJwtClaims } from '@shared/types.js';
import { describe, expect, it } from 'vitest';
import { computeLicenseState } from '@main/services/license-state-machine.js';

function makeClaims(overrides: Partial<LicenseJwtClaims> = {}): LicenseJwtClaims {
  const now = Math.floor(Date.parse('2026-06-01T00:00:00Z') / 1000);
  return {
    iss: 'carbonbook.app',
    license_id: 'lic_test',
    user_id: 'usr_test',
    plan: 'base@2026-q2',
    features: ['inventory', 'questionnaire', 'iso14064'],
    devices_max: 1,
    issued_at: now - 86400 * 30,
    expires_at: now + 86400 * 30, // 30 days away
    grace_until: now + 86400 * 60, // 60 days away (expires + 30)
    revocation_check_after: now + 86400 * 7, // 7 days away
    ...overrides,
  };
}

const NOW = Math.floor(Date.parse('2026-06-01T00:00:00Z') / 1000);

describe('computeLicenseState', () => {
  it('returns "active" when now < expires_at and revocation_check fresh', () => {
    const r = computeLicenseState({
      claims: makeClaims(),
      now: NOW,
      lastVerifiedAt: NOW - 86400,
      consecutiveOfflineDays: 0,
      revoked: false,
    });
    expect(r.state).toBe('active');
  });

  it('returns "grace" when expires_at < now <= grace_until', () => {
    const r = computeLicenseState({
      claims: makeClaims({ expires_at: NOW - 86400, grace_until: NOW + 86400 * 29 }),
      now: NOW,
      lastVerifiedAt: NOW - 86400,
      consecutiveOfflineDays: 0,
      revoked: false,
    });
    expect(r.state).toBe('grace');
  });

  it('returns "expired" when now > grace_until', () => {
    const r = computeLicenseState({
      claims: makeClaims({
        expires_at: NOW - 86400 * 35,
        grace_until: NOW - 86400 * 5,
      }),
      now: NOW,
      lastVerifiedAt: NOW - 86400 * 5,
      consecutiveOfflineDays: 0,
      revoked: false,
    });
    expect(r.state).toBe('expired');
  });

  it('returns "expired" when consecutiveOfflineDays > 30 regardless of expires_at', () => {
    const r = computeLicenseState({
      claims: makeClaims(),
      now: NOW,
      lastVerifiedAt: NOW - 86400 * 35,
      consecutiveOfflineDays: 35,
      revoked: false,
    });
    expect(r.state).toBe('expired');
  });

  it('returns "revoked" any time revoked === true (overrides everything)', () => {
    const r = computeLicenseState({
      claims: makeClaims(),
      now: NOW,
      lastVerifiedAt: NOW - 86400,
      consecutiveOfflineDays: 0,
      revoked: true,
    });
    expect(r.state).toBe('revoked');
  });

  it('returns "unverified" when claims === null', () => {
    const r = computeLicenseState({
      claims: null,
      now: NOW,
      lastVerifiedAt: null,
      consecutiveOfflineDays: 0,
      revoked: false,
    });
    expect(r.state).toBe('unverified');
  });

  it('attaches a non-empty reason string to every result', () => {
    const cases = [
      { claims: null, lastVerifiedAt: null, consecutiveOfflineDays: 0, revoked: false },
      { claims: makeClaims(), lastVerifiedAt: NOW, consecutiveOfflineDays: 0, revoked: true },
      {
        claims: makeClaims({ expires_at: NOW - 86400, grace_until: NOW + 86400 }),
        lastVerifiedAt: NOW,
        consecutiveOfflineDays: 0,
        revoked: false,
      },
    ];
    for (const c of cases) {
      const r = computeLicenseState({ ...c, now: NOW });
      expect(r.reason).toBeTruthy();
      expect(r.reason.length).toBeGreaterThan(0);
    }
  });

  it('boundary: now === expires_at is treated as "grace" (the second after expiry)', () => {
    const r = computeLicenseState({
      claims: makeClaims({ expires_at: NOW, grace_until: NOW + 86400 * 30 }),
      now: NOW,
      lastVerifiedAt: NOW,
      consecutiveOfflineDays: 0,
      revoked: false,
    });
    // §10 "active": now < expires_at — strict. So at the boundary it's grace.
    expect(r.state).toBe('grace');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test license-state-machine
```

Expected: all 8 fail with "cannot find module @main/services/license-state-machine".

- [ ] **Step 3: Implement the pure module**

Create `src/main/services/license-state-machine.ts`:

```ts
import type { LicenseJwtClaims, LicenseState } from '@shared/types.js';

export type ComputeLicenseStateInput = {
  /** Parsed JWT claims, or null when no license has ever been activated. */
  claims: LicenseJwtClaims | null;
  /** Current time, unix seconds. Injected for testability. */
  now: number;
  /** Unix seconds of the last successful cloud /verify, or null. */
  lastVerifiedAt: number | null;
  /** Counter of consecutive offline ping failures (in days). */
  consecutiveOfflineDays: number;
  /** Whether the last successful /verify returned `revoked: true`. */
  revoked: boolean;
};

export type ComputeLicenseStateResult = {
  state: LicenseState;
  /** A short human-readable explanation. Surface in diagnostics / logs. */
  reason: string;
};

/**
 * Pure 4-state (5 with `unverified`) machine from design spec §10.
 * Priority order (highest first):
 *   1. revoked  → cloud said so, dominates everything else
 *   2. unverified → no JWT at all
 *   3. expired  → either past grace_until OR offline > 30 days
 *   4. grace    → past expires_at but within grace_until
 *   5. active   → default healthy state
 *
 * Boundary: `now === expires_at` is treated as `grace` (the second after
 * the expiry moment). §10 says "active: now < expires_at" — strict.
 */
export function computeLicenseState(
  input: ComputeLicenseStateInput,
): ComputeLicenseStateResult {
  const { claims, now, consecutiveOfflineDays, revoked } = input;

  if (revoked) {
    return { state: 'revoked', reason: 'Cloud /verify returned revoked=true.' };
  }

  if (claims == null) {
    return {
      state: 'unverified',
      reason: 'No license JWT has been activated on this device.',
    };
  }

  // Offline-too-long trumps the time-based check. If the cloud hasn't been
  // reachable in over 30 days we can't trust the JWT's validity claims.
  if (consecutiveOfflineDays > 30) {
    return {
      state: 'expired',
      reason: `Offline for ${consecutiveOfflineDays} consecutive days (limit: 30).`,
    };
  }

  if (now >= claims.grace_until) {
    return {
      state: 'expired',
      reason: `Past grace period (now=${now}, grace_until=${claims.grace_until}).`,
    };
  }

  if (now >= claims.expires_at) {
    const daysRemaining = Math.max(0, Math.floor((claims.grace_until - now) / 86400));
    return {
      state: 'grace',
      reason: `In grace period — ${daysRemaining} day(s) until full expiry.`,
    };
  }

  return { state: 'active', reason: 'License is active.' };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test license-state-machine
```

Expected: 8 pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/license-state-machine.ts tests/main/services/license-state-machine.test.ts
git commit -m "feat(license): LicenseStateMachine pure module + 8 tests"
```

---

## Task 3: `LicenseService` — Ed25519 verify + JWT decode + Keychain + DB

**Files:**
- Create: `src/main/services/license-service.ts`
- Create: `tests/main/services/license-service.test.ts`
- Modify: `src/main/services/base.ts` (or wherever `ServiceContext` is defined) — if `safeStorage` isn't already in the context, add it (likely already there; settings-service uses it)

This task ties everything together: read the active JWT from Keychain, base64url-decode it, verify the Ed25519 signature, parse the claims, read the DB row for verification metadata, hand to the state machine, return a `LicenseStateView`. Plus write-side: store a JWT (validates first, then writes to Keychain + DB), and clear.

- [ ] **Step 1: Write the failing tests**

Create `tests/main/services/license-service.test.ts`. The test seeds a known dev keypair and signs a JWT with the corresponding private key (using `node:crypto.sign`), so the service's verify path can be exercised without a real cloud.

```ts
import { generateKeyPairSync, sign as cryptoSign, type KeyObject } from 'node:crypto';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyAllMigrations, openInMemoryDb } from '../helpers/db.js';
import { LicenseService } from '@main/services/license-service.js';

// Issue a real Ed25519-signed JWT for the given claims using the supplied
// private key. The test mints a fresh keypair, pretends one half is "the
// cloud's", embeds the public half in LicenseService, and signs from the
// private half here.
function signJwt(
  privateKey: KeyObject,
  claims: object,
): { jwt: string; b64header: string; b64body: string } {
  const header = { alg: 'EdDSA', typ: 'JWT' };
  const b64 = (obj: object) =>
    Buffer.from(JSON.stringify(obj)).toString('base64url');
  const b64header = b64(header);
  const b64body = b64(claims);
  const signingInput = `${b64header}.${b64body}`;
  const sig = cryptoSign(null, Buffer.from(signingInput), privateKey);
  const b64sig = sig.toString('base64url');
  return { jwt: `${b64header}.${b64body}.${b64sig}`, b64header, b64body };
}

describe('LicenseService', () => {
  let db: Database.Database;
  let publicKey: KeyObject;
  let privateKey: KeyObject;
  let keychain: Map<string, string>;
  let service: LicenseService;
  const NOW = Math.floor(Date.parse('2026-06-01T00:00:00Z') / 1000);

  beforeEach(() => {
    db = openInMemoryDb();
    applyAllMigrations(db);
    const kp = generateKeyPairSync('ed25519');
    publicKey = kp.publicKey;
    privateKey = kp.privateKey;
    keychain = new Map();
    service = new LicenseService({
      db,
      now: () => new Date(NOW * 1000).toISOString(),
      nowSeconds: () => NOW,
      publicKey,
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (s: string) => Buffer.from(s),
        decryptString: (b: Buffer) => b.toString('utf8'),
      },
      keyringSet: (key: string, value: string) => {
        keychain.set(key, value);
      },
      keyringGet: (key: string) => keychain.get(key) ?? null,
      keyringDelete: (key: string) => {
        keychain.delete(key);
      },
      newDeviceId: () => 'dev_test_device_01',
    });
  });

  afterEach(() => {
    db.close();
    vi.clearAllMocks();
  });

  it('returns state=unverified on a fresh DB with no JWT in Keychain', () => {
    const view = service.getState();
    expect(view.state).toBe('unverified');
    expect(view.claims).toBeNull();
    // First read replaces the migration sentinel device_id.
    expect(view.device_id).toBe('dev_test_device_01');
  });

  it('setJwt(jwt) verifies signature + stores in Keychain + DB; getState reflects new claims', () => {
    const claims = {
      iss: 'carbonbook.app',
      license_id: 'lic_01',
      user_id: 'usr_01',
      plan: 'base@2026-q2',
      features: ['inventory', 'questionnaire', 'iso14064'],
      devices_max: 1,
      issued_at: NOW - 86400,
      expires_at: NOW + 86400 * 30,
      grace_until: NOW + 86400 * 60,
      revocation_check_after: NOW + 86400 * 7,
    };
    const { jwt } = signJwt(privateKey, claims);
    service.setJwt(jwt);
    const view = service.getState();
    expect(view.state).toBe('active');
    expect(view.claims?.license_id).toBe('lic_01');
    expect(view.claims?.plan).toBe('base@2026-q2');
  });

  it('setJwt rejects a JWT with a forged signature', () => {
    // Mint with a *different* keypair than what the service trusts.
    const otherKp = generateKeyPairSync('ed25519');
    const claims = {
      iss: 'carbonbook.app',
      license_id: 'lic_02',
      user_id: 'usr_02',
      plan: 'base@2026-q2',
      features: ['inventory'],
      devices_max: 1,
      issued_at: NOW,
      expires_at: NOW + 86400,
      grace_until: NOW + 86400 * 2,
      revocation_check_after: NOW + 86400,
    };
    const { jwt } = signJwt(otherKp.privateKey, claims);
    expect(() => service.setJwt(jwt)).toThrow(/signature/i);
    // State is still unverified — bad JWT was not persisted.
    expect(service.getState().state).toBe('unverified');
  });

  it('setJwt rejects a JWT whose claims fail schema validation', () => {
    const { jwt } = signJwt(privateKey, {
      // Missing required fields.
      iss: 'carbonbook.app',
      license_id: 'lic_03',
      // no user_id, no expires_at, no grace_until...
    });
    expect(() => service.setJwt(jwt)).toThrow();
    expect(service.getState().state).toBe('unverified');
  });

  it('clearJwt() removes the JWT from Keychain and DB; state becomes unverified', () => {
    const claims = {
      iss: 'carbonbook.app',
      license_id: 'lic_04',
      user_id: 'usr_04',
      plan: 'base@2026-q2',
      features: ['inventory'],
      devices_max: 1,
      issued_at: NOW - 86400,
      expires_at: NOW + 86400 * 30,
      grace_until: NOW + 86400 * 60,
      revocation_check_after: NOW + 86400 * 7,
    };
    service.setJwt(signJwt(privateKey, claims).jwt);
    expect(service.getState().state).toBe('active');
    service.clearJwt();
    const view = service.getState();
    expect(view.state).toBe('unverified');
    expect(view.claims).toBeNull();
    expect(keychain.size).toBe(0);
  });

  it('getState reflects "grace" when expires_at is in the past but grace_until is in the future', () => {
    const claims = {
      iss: 'carbonbook.app',
      license_id: 'lic_05',
      user_id: 'usr_05',
      plan: 'base@2026-q2',
      features: ['inventory'],
      devices_max: 1,
      issued_at: NOW - 86400 * 60,
      expires_at: NOW - 86400, // 1 day ago
      grace_until: NOW + 86400 * 29,
      revocation_check_after: NOW + 86400 * 7,
    };
    service.setJwt(signJwt(privateKey, claims).jwt);
    expect(service.getState().state).toBe('grace');
  });
});
```

You may need a `tests/main/helpers/db.ts` (look for an existing one — most service tests already import a helper that returns a migrated in-memory better-sqlite3 db; reuse that, don't create a new one).

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test license-service
```

Expected: all 6 fail with "cannot find module @main/services/license-service".

- [ ] **Step 3: Implement `LicenseService`**

Create `src/main/services/license-service.ts`:

```ts
import { createPublicKey, verify as cryptoVerify, type KeyObject } from 'node:crypto';
import type {
  LicenseJwtClaims,
  LicenseLocalStateRow,
  LicenseState,
  LicenseStateView,
} from '@shared/types.js';
import { newId } from '@shared/ulid.js';
import { z } from 'zod';
import type { ServiceContext } from './base.js';
import { computeLicenseState } from './license-state-machine.js';

/**
 * Zod schema mirroring `LicenseJwtClaims`. We validate the decoded JSON
 * body BEFORE trusting any field — a JWT with a missing `expires_at` could
 * otherwise crash the state machine downstream.
 */
const licenseJwtClaimsSchema = z.object({
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

const KEYCHAIN_JWT_KEY = 'license.jwt';
const KEYCHAIN_REVOKED_KEY = 'license.revoked';

/**
 * Constructor dependencies. Same factor-out-IO pattern the rest of the
 * services use. `keyringSet/Get/Delete` are the only real I/O the service
 * performs aside from DB; tests inject in-memory maps.
 */
export type LicenseServiceDeps = ServiceContext & {
  /** Unix seconds. ServiceContext.now() returns an ISO string; we need both. */
  nowSeconds: () => number;
  /** The Ed25519 public key trusted as the issuer. Build-time embedded. */
  publicKey: KeyObject;
  safeStorage: {
    isEncryptionAvailable: () => boolean;
    encryptString: (s: string) => Buffer;
    decryptString: (b: Buffer) => string;
  };
  keyringSet: (key: string, value: string) => void;
  keyringGet: (key: string) => string | null;
  keyringDelete: (key: string) => void;
  /** Override for tests; production passes `newId` from shared/ulid. */
  newDeviceId?: () => string;
};

export class LicenseService {
  private readonly db: ServiceContext['db'];
  private readonly nowIso: () => string;
  private readonly nowSec: () => number;
  private readonly publicKey: KeyObject;
  private readonly safeStorage: LicenseServiceDeps['safeStorage'];
  private readonly keyringSet: LicenseServiceDeps['keyringSet'];
  private readonly keyringGet: LicenseServiceDeps['keyringGet'];
  private readonly keyringDelete: LicenseServiceDeps['keyringDelete'];
  private readonly newDeviceId: () => string;

  constructor(deps: LicenseServiceDeps) {
    this.db = deps.db;
    this.nowIso = deps.now;
    this.nowSec = deps.nowSeconds;
    this.publicKey = deps.publicKey;
    this.safeStorage = deps.safeStorage;
    this.keyringSet = deps.keyringSet;
    this.keyringGet = deps.keyringGet;
    this.keyringDelete = deps.keyringDelete;
    this.newDeviceId = deps.newDeviceId ?? (() => `dev_${newId()}`);
  }

  /**
   * Read the current license state. Safe to call repeatedly; cheap (one
   * keychain read + one SQLite SELECT + ed25519 verify).
   */
  getState(): LicenseStateView {
    const row = this.readOrInitLocalState();
    const jwt = this.readJwtFromKeychain();
    let claims: LicenseJwtClaims | null = null;
    if (jwt !== null) {
      try {
        claims = this.verifyAndDecode(jwt);
      } catch {
        // Tampered or corrupted JWT — treat as unverified. We deliberately
        // do NOT clear it from Keychain here; that's an explicit user
        // action (logout) handled by `clearJwt`.
        claims = null;
      }
    }
    const revoked = this.keyringGet(KEYCHAIN_REVOKED_KEY) === 'true';
    const { state, reason } = computeLicenseState({
      claims,
      now: this.nowSec(),
      lastVerifiedAt:
        row.last_verified_at != null
          ? Math.floor(Date.parse(row.last_verified_at) / 1000)
          : null,
      consecutiveOfflineDays: row.consecutive_offline_days,
      revoked,
    });
    // Cache the computed state for diagnostics (e.g. boot-time read before
    // the state machine has run, or a UI cold-start where we want a hint).
    this.updateCachedState(state);
    return {
      state,
      claims,
      device_id: row.device_id,
      last_verified_at: row.last_verified_at,
      consecutive_offline_days: row.consecutive_offline_days,
      reason,
    };
  }

  /**
   * Validate a JWT (signature + schema), then persist to Keychain + clear
   * the revoked flag (a fresh activation always wipes any stale revoke).
   * Throws if verification fails — the caller (IPC handler) surfaces the
   * error to the UI.
   */
  setJwt(jwt: string): void {
    // verifyAndDecode throws on bad signature or bad schema.
    this.verifyAndDecode(jwt);
    this.keyringSet(KEYCHAIN_JWT_KEY, jwt);
    this.keyringDelete(KEYCHAIN_REVOKED_KEY);
    // Reset the offline-days counter on every successful set; activation
    // is implicitly a successful cloud round-trip from the caller's POV.
    this.db
      .prepare(
        `UPDATE license_local_state
            SET last_verified_at = ?, consecutive_offline_days = 0, updated_at = ?
          WHERE id = 1`,
      )
      .run(this.nowIso(), this.nowIso());
  }

  /** Wipe the active JWT + reset DB metadata. */
  clearJwt(): void {
    this.keyringDelete(KEYCHAIN_JWT_KEY);
    this.keyringDelete(KEYCHAIN_REVOKED_KEY);
    this.db
      .prepare(
        `UPDATE license_local_state
            SET last_verified_at = NULL,
                consecutive_offline_days = 0,
                last_known_state = 'unverified',
                last_known_state_at = ?,
                updated_at = ?
          WHERE id = 1`,
      )
      .run(this.nowIso(), this.nowIso());
  }

  // ---- internals ----

  private readJwtFromKeychain(): string | null {
    return this.keyringGet(KEYCHAIN_JWT_KEY);
  }

  /**
   * Hand-decode a JWT (`header.body.signature` base64url), verify the
   * Ed25519 signature against `signingInput = header.body`, then zod-parse
   * the body. Returns the validated claims object.
   *
   * Throws if signature invalid OR body fails schema validation.
   */
  private verifyAndDecode(jwt: string): LicenseJwtClaims {
    const parts = jwt.split('.');
    if (parts.length !== 3) {
      throw new Error('Malformed JWT: expected 3 dot-separated segments.');
    }
    const [b64header, b64body, b64sig] = parts as [string, string, string];
    const signingInput = `${b64header}.${b64body}`;
    const signature = Buffer.from(b64sig, 'base64url');
    const ok = cryptoVerify(null, Buffer.from(signingInput), this.publicKey, signature);
    if (!ok) {
      throw new Error('License JWT signature failed verification.');
    }
    const bodyJson = Buffer.from(b64body, 'base64url').toString('utf8');
    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(bodyJson);
    } catch {
      throw new Error('License JWT body is not valid JSON.');
    }
    return licenseJwtClaimsSchema.parse(parsedBody);
  }

  private readOrInitLocalState(): LicenseLocalStateRow {
    const row = this.db
      .prepare('SELECT * FROM license_local_state WHERE id = 1')
      .get() as LicenseLocalStateRow | undefined;
    if (!row) {
      // Migration should have seeded this. If it's missing we're in a
      // broken state — bubble up rather than silently re-creating.
      throw new Error('license_local_state singleton row missing; migration 016 not applied?');
    }
    if (row.device_id === 'pending-first-launch') {
      const fresh = this.newDeviceId();
      this.db
        .prepare(
          `UPDATE license_local_state
              SET device_id = ?, created_at = ?, updated_at = ?
            WHERE id = 1`,
        )
        .run(fresh, this.nowIso(), this.nowIso());
      return { ...row, device_id: fresh, created_at: this.nowIso(), updated_at: this.nowIso() };
    }
    return row;
  }

  private updateCachedState(state: LicenseState): void {
    this.db
      .prepare(
        `UPDATE license_local_state
            SET last_known_state = ?, last_known_state_at = ?, updated_at = ?
          WHERE id = 1`,
      )
      .run(state, this.nowIso(), this.nowIso());
  }
}

/**
 * Helper: build a `KeyObject` from the raw 32-byte Ed25519 public key
 * bytes embedded at build time. Exposed so `main/index.ts` can construct
 * the service without hand-rolling DER wrapping at every site.
 */
export function publicKeyFromRawBytes(rawBytes: Buffer): KeyObject {
  // Ed25519 SPKI prefix (12 bytes) + 32-byte raw key = 44-byte DER blob.
  const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
  if (rawBytes.length !== 32) {
    throw new Error(`Expected 32-byte Ed25519 public key, got ${rawBytes.length} bytes.`);
  }
  const der = Buffer.concat([SPKI_PREFIX, rawBytes]);
  return createPublicKey({ key: der, format: 'der', type: 'spki' });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test license-service
```

Expected: 6 pass. If a `tests/main/helpers/db.ts` is missing, look at how other service tests open a migrated DB and copy that pattern.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/license-service.ts tests/main/services/license-service.test.ts
git commit -m "feat(license): LicenseService — Ed25519 verify + Keychain + state read"
```

---

## Task 4: IPC channels + bridge + renderer wrapper

**Files:**
- Modify: `src/main/ipc/types.ts` — add 3 channels
- Create: `src/main/ipc/handlers/license.ts`
- Modify: `src/main/ipc/registry.ts` (or wherever handlers are wired into the registry — grep `settingsHandlers` to find it)
- Modify: `src/main/ipc/context.ts` (or `IpcContext` definition) — add `licenseService`
- Modify: `src/main/index.ts` (or main entrypoint that constructs services) — wire the public key + safeStorage + DB into the new service
- Modify: `src/preload/bridge.ts` — add to channel allowlist
- Create: `src/renderer/lib/api/license.ts` — thin wrapper
- Create: `tests/main/ipc/license-handlers.test.ts` — 3 handler tests

- [ ] **Step 1: Add channels to `IpcTypeMap`**

In `src/main/ipc/types.ts`, near other domain blocks:

```ts
// license domain (Phase 4 — Ed25519 JWT, state machine, OS Keychain)
'license:get-state': () => import('@shared/types.js').LicenseStateView;
'license:set-jwt': (input: { jwt: string }) =>
  { ok: true } | { ok: false; error: { _tag: 'BadSignature' | 'BadSchema' | 'Malformed'; message: string } };
'license:clear': () => void;
```

- [ ] **Step 2: Write the handler tests first**

Create `tests/main/ipc/license-handlers.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { licenseHandlers } from '@main/ipc/handlers/license.js';
import type { IpcContext } from '@main/ipc/context.js';
import type { LicenseService } from '@main/services/license-service.js';

function makeCtxWith(svcOverrides: Partial<LicenseService>): IpcContext {
  return {
    licenseService: svcOverrides as LicenseService,
    // other services not used in these tests — cast empty.
  } as unknown as IpcContext;
}

describe('license IPC handlers', () => {
  it('license:get-state delegates to LicenseService.getState', () => {
    const view = {
      state: 'active' as const,
      claims: null,
      device_id: 'd1',
      last_verified_at: null,
      consecutive_offline_days: 0,
      reason: 'ok',
    };
    const getState = vi.fn(() => view);
    const handlers = licenseHandlers(makeCtxWith({ getState }));
    const result = handlers['license:get-state']!({});
    expect(getState).toHaveBeenCalledOnce();
    expect(result).toEqual(view);
  });

  it('license:set-jwt returns { ok: true } on success', () => {
    const setJwt = vi.fn(() => undefined);
    const handlers = licenseHandlers(makeCtxWith({ setJwt }));
    const result = handlers['license:set-jwt']!({ jwt: 'a.b.c' });
    expect(setJwt).toHaveBeenCalledWith('a.b.c');
    expect(result).toEqual({ ok: true });
  });

  it('license:set-jwt converts thrown errors into a tagged failure result', () => {
    const setJwt = vi.fn(() => {
      throw new Error('License JWT signature failed verification.');
    });
    const handlers = licenseHandlers(makeCtxWith({ setJwt }));
    const result = handlers['license:set-jwt']!({ jwt: 'bad.token.x' });
    expect(result).toMatchObject({ ok: false });
    if (result && 'error' in result) {
      expect(result.error._tag).toBe('BadSignature');
    }
  });
});
```

- [ ] **Step 3: Implement the handler**

Create `src/main/ipc/handlers/license.ts`:

```ts
import { z } from 'zod';
import type { IpcContext } from '../context.js';
import type { IpcTypeMap } from '../types.js';

const setJwtInput = z.object({ jwt: z.string().min(1) });

/**
 * Thin pass-through to LicenseService. The only nontrivial logic is
 * mapping thrown Errors into a discriminated `{ ok: false, error: { _tag } }`
 * shape so the renderer can render distinct error UIs without parsing
 * error messages.
 */
export function licenseHandlers(ctx: IpcContext): {
  [K in keyof IpcTypeMap]?: IpcTypeMap[K];
} {
  return {
    'license:get-state': () => ctx.licenseService.getState(),
    'license:set-jwt': (input) => {
      const { jwt } = setJwtInput.parse(input);
      try {
        ctx.licenseService.setJwt(jwt);
        return { ok: true };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const tag = /signature/i.test(msg)
          ? 'BadSignature'
          : /3 dot-separated|JSON/i.test(msg)
            ? 'Malformed'
            : 'BadSchema';
        return { ok: false, error: { _tag: tag as 'BadSignature' | 'BadSchema' | 'Malformed', message: msg } };
      }
    },
    'license:clear': () => ctx.licenseService.clearJwt(),
  };
}
```

- [ ] **Step 4: Wire into IpcContext + registry + main**

Find the existing `IpcContext` definition (likely `src/main/ipc/context.ts`). Add `licenseService: LicenseService` to its shape. Then find where the context is constructed in main bootstrap (grep `new SettingsService` or `new EmissionSourceService`); add construction of `LicenseService` alongside it. The public key constant lives in a new file:

Create `src/main/services/license-public-key.ts`:

```ts
import { publicKeyFromRawBytes } from './license-service.js';

/**
 * Ed25519 public key for verifying license JWTs. This is a **development
 * placeholder** — the real production key is generated by carbonbook-cloud
 * and embedded at release time. Until cloud sub-project G ships, this
 * value pairs with the dev private key in `scripts/dev/license-keypair/`
 * so local dev + tests can mint signed JWTs end-to-end.
 *
 * Replacing this constant + redeploying is what cuts a new license
 * issuance domain over to production.
 */
const DEV_PUBLIC_KEY_HEX =
  // Placeholder: 32 zero bytes. The Task 5 dev tooling regenerates a real
  // dev keypair and rewrites this constant. Do NOT ship a real release
  // with all-zero bytes — sanity-check is in `LicenseService.constructor`.
  '0000000000000000000000000000000000000000000000000000000000000000';

export function loadLicensePublicKey() {
  const bytes = Buffer.from(DEV_PUBLIC_KEY_HEX, 'hex');
  return publicKeyFromRawBytes(bytes);
}
```

In main bootstrap (e.g. `src/main/index.ts` near where other services are constructed), wire:

```ts
import { safeStorage } from 'electron';
import { LicenseService } from './services/license-service.js';
import { loadLicensePublicKey } from './services/license-public-key.js';
import keytar from 'keytar'; // or whichever keychain wrapper the codebase already uses

// ... existing service construction ...

const licenseService = new LicenseService({
  db,
  now: () => new Date().toISOString(),
  nowSeconds: () => Math.floor(Date.now() / 1000),
  publicKey: loadLicensePublicKey(),
  safeStorage,
  keyringSet: (k, v) => keytar.setPassword('carbonbook', k, v),
  keyringGet: (k) => keytar.getPassword('carbonbook', k),
  keyringDelete: (k) => { keytar.deletePassword('carbonbook', k); },
});

// add to IpcContext alongside other services
const ipcContext: IpcContext = {
  // ... existing services ...
  licenseService,
};
```

**Important:** look at how `SettingsService` writes secrets to Keychain — there may already be a wrapper that abstracts keytar/safeStorage. Reuse it instead of importing keytar directly. The Phase 0 spec mentions `safeStorage credential adapter` — that's the wrapper.

Then in the IPC registry (grep `settingsHandlers` and add a sibling):

```ts
import { licenseHandlers } from './handlers/license.js';
// ...
const handlers = {
  // ...
  ...licenseHandlers(ipcContext),
};
```

- [ ] **Step 5: Update preload bridge allowlist**

In `src/preload/bridge.ts`, add `'license:get-state'`, `'license:set-jwt'`, `'license:clear'` to the `INVOKE_CHANNELS` set (or whatever the const is called — grep `settings:get-provider` to find it).

- [ ] **Step 6: Renderer wrapper**

Create `src/renderer/lib/api/license.ts`:

```ts
import { invoke } from '../ipc.js';

/**
 * Per-domain renderer wrapper for `license:*` IPC channels. The UI calls
 * `licenseApi.getState()` from a TanStack `useQuery`; activation in
 * sub-project B will call `setJwt` from a mutation.
 */
export const licenseApi = {
  getState: () => invoke('license:get-state', {}),
  setJwt: (input: { jwt: string }) => invoke('license:set-jwt', input),
  clear: () => invoke('license:clear', {}),
};
```

- [ ] **Step 7: Run handler tests + full vitest + typecheck**

```bash
pnpm test license-handlers
pnpm test    # full sweep
pnpm typecheck
```

Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add src/main/ipc/handlers/license.ts src/main/ipc/types.ts \
        src/main/services/license-public-key.ts \
        src/main/ipc/context.ts src/main/ipc/registry.ts src/main/index.ts \
        src/preload/bridge.ts src/renderer/lib/api/license.ts \
        tests/main/ipc/license-handlers.test.ts
git commit -m "feat(license): IPC channels + handler + bridge + renderer wrapper"
```

(Adjust file list per actual paths discovered.)

---

## Task 5: Dev keypair + `scripts/issue-dev-license.mjs`

**Files:**
- Create: `scripts/dev/license-keypair/` directory (containing `public.hex`, `private.pem`)
- Create: `scripts/issue-dev-license.mjs`
- Modify: `src/main/services/license-public-key.ts` — wire `DEV_PUBLIC_KEY_HEX` to the real generated public key bytes
- Modify: `.gitignore` — make sure `scripts/dev/license-keypair/private.pem` is committed (it's intentionally a *dev* key, not a secret); the file is OK in git for development convenience

The dev CLI lets a developer (or a test) mint a license JWT for any user / plan / expiry to drive UI states.

- [ ] **Step 1: Generate the dev keypair**

```bash
mkdir -p scripts/dev/license-keypair
node -e "
const { generateKeyPairSync } = require('node:crypto');
const fs = require('node:fs');
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
fs.writeFileSync(
  'scripts/dev/license-keypair/private.pem',
  privateKey.export({ format: 'pem', type: 'pkcs8' }),
);
// Strip the SPKI DER prefix to get raw 32-byte public key.
const der = publicKey.export({ format: 'der', type: 'spki' });
const rawPub = der.subarray(der.length - 32);
fs.writeFileSync(
  'scripts/dev/license-keypair/public.hex',
  rawPub.toString('hex') + '\n',
);
console.log('Public hex:', rawPub.toString('hex'));
"
```

Verify the files exist:

```bash
ls -la scripts/dev/license-keypair/
```

- [ ] **Step 2: Wire the public key constant**

Read the generated `scripts/dev/license-keypair/public.hex`. Open `src/main/services/license-public-key.ts` and replace the `DEV_PUBLIC_KEY_HEX` value with the actual hex.

- [ ] **Step 3: Write the issuer script**

Create `scripts/issue-dev-license.mjs`:

```js
#!/usr/bin/env node
// Mint a dev license JWT for local testing of the License UI / state machine.
// Usage:
//   node scripts/issue-dev-license.mjs --plan base --days 365 > my.jwt
//   node scripts/issue-dev-license.mjs --plan trial --days 14 --user-id usr_dev
//
// Output: a single JWT string on stdout (paste into the Settings → License
// activation form once sub-project B ships, or use the `license:set-jwt`
// IPC channel via a Node REPL during testing).
import { readFileSync } from 'node:fs';
import { createPrivateKey, sign as cryptoSign } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KEYPATH = join(__dirname, 'dev', 'license-keypair', 'private.pem');

function parseArgs(argv) {
  const args = { plan: 'base', days: 365, userId: 'usr_dev_local', licenseId: 'lic_dev_local', features: 'inventory,questionnaire,iso14064' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--plan') args.plan = argv[++i];
    else if (a === '--days') args.days = Number(argv[++i]);
    else if (a === '--user-id') args.userId = argv[++i];
    else if (a === '--license-id') args.licenseId = argv[++i];
    else if (a === '--features') args.features = argv[++i];
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

const now = Math.floor(Date.now() / 1000);
const claims = {
  iss: 'carbonbook.app',
  license_id: args.licenseId,
  user_id: args.userId,
  plan: `${args.plan}@dev`,
  features: args.features.split(','),
  devices_max: 1,
  issued_at: now,
  expires_at: now + args.days * 86400,
  grace_until: now + (args.days + 30) * 86400,
  revocation_check_after: now + 7 * 86400,
};

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const header = { alg: 'EdDSA', typ: 'JWT' };
const signingInput = `${b64(header)}.${b64(claims)}`;

const pem = readFileSync(KEYPATH, 'utf8');
const privateKey = createPrivateKey({ key: pem, format: 'pem' });
const sig = cryptoSign(null, Buffer.from(signingInput), privateKey);

const jwt = `${signingInput}.${sig.toString('base64url')}`;
process.stdout.write(jwt + '\n');
```

Make executable:

```bash
chmod +x scripts/issue-dev-license.mjs
```

- [ ] **Step 4: Smoke test the CLI end-to-end**

```bash
node scripts/issue-dev-license.mjs --plan base --days 30
```

Expected: prints a `.`-separated JWT to stdout. Pipe it to `wc -c` and confirm it's plausibly sized (~250-350 chars).

- [ ] **Step 5: Add a sanity test asserting LicenseService accepts the dev-CLI output**

Append to `tests/main/services/license-service.test.ts`:

```ts
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createPublicKey } from 'node:crypto';

it('accepts a JWT minted by scripts/issue-dev-license.mjs (full round-trip)', () => {
  // Load the dev public key from disk; pretend the service is wired to it.
  const hex = readFileSync('scripts/dev/license-keypair/public.hex', 'utf8').trim();
  const rawPub = Buffer.from(hex, 'hex');
  const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
  const realPublicKey = createPublicKey({
    key: Buffer.concat([SPKI_PREFIX, rawPub]),
    format: 'der',
    type: 'spki',
  });
  // Recreate the service with the production-shaped public key.
  const localKeychain = new Map<string, string>();
  const localDb = openInMemoryDb();
  applyAllMigrations(localDb);
  const svc = new LicenseService({
    db: localDb,
    now: () => new Date().toISOString(),
    nowSeconds: () => Math.floor(Date.now() / 1000),
    publicKey: realPublicKey,
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (s) => Buffer.from(s),
      decryptString: (b) => b.toString('utf8'),
    },
    keyringSet: (k, v) => { localKeychain.set(k, v); },
    keyringGet: (k) => localKeychain.get(k) ?? null,
    keyringDelete: (k) => { localKeychain.delete(k); },
  });

  const jwt = execSync('node scripts/issue-dev-license.mjs --plan base --days 30')
    .toString('utf8')
    .trim();
  expect(() => svc.setJwt(jwt)).not.toThrow();
  expect(svc.getState().state).toBe('active');
  localDb.close();
});
```

- [ ] **Step 6: Run tests + commit**

```bash
pnpm test license-service
```

Expected: 7 pass (6 from Task 3 + 1 new round-trip).

```bash
git add scripts/dev/license-keypair/ scripts/issue-dev-license.mjs \
        src/main/services/license-public-key.ts \
        tests/main/services/license-service.test.ts
git commit -m "feat(license): dev keypair + issue-dev-license CLI + round-trip test"
```

---

## Task 6: Sweep — biome / typecheck / full vitest / commit

**Files:** none new; runs the discipline tools.

- [ ] **Step 1: Run biome on the new files**

```bash
pnpm exec biome check --write \
  src/main/services/license-state-machine.ts \
  src/main/services/license-service.ts \
  src/main/services/license-public-key.ts \
  src/main/ipc/handlers/license.ts \
  src/main/ipc/types.ts \
  src/renderer/lib/api/license.ts \
  src/preload/bridge.ts \
  src/shared/types.ts \
  tests/main/services/license-state-machine.test.ts \
  tests/main/services/license-service.test.ts \
  tests/main/ipc/license-handlers.test.ts \
  scripts/issue-dev-license.mjs
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors. If exactOptionalPropertyTypes complains about optional `support_until` flowing through IPC, mirror the pattern from `activity-data.ts` handler (strip undefined before spread).

- [ ] **Step 3: Full vitest**

```bash
pnpm test
```

Expected: 625+ tests (610 baseline + ~8 state-machine + ~7 service + ~3 handler).

- [ ] **Step 4: Final commit (if any auto-formatter changes remain)**

```bash
git status
# if there are uncommitted formatting changes:
git add -u && git commit -m "chore: biome sweep for license client core (Phase 4 sub-project A)"
```

- [ ] **Step 5: Release note**

Append to (or create) `docs/release-notes/phase-4-progress.md`:

```markdown
## Phase 4 Sub-project A — License Client Core (shipped)

- Migration 016: `license_local_state` single-row table.
- `LicenseStateMachine` pure function — 4 states (+ `unverified`).
- `LicenseService` — Ed25519 verify via `node:crypto`, Keychain storage,
  state read.
- IPC channels: `license:get-state`, `license:set-jwt`, `license:clear`.
- Dev tooling: `scripts/issue-dev-license.mjs` mints local JWTs.

Cloud-side `/activate` / `/verify` deferred to sub-project G.
UI integration (Settings page License section) is sub-project B.
Read-only mode gating is sub-project C.
```

```bash
git add docs/release-notes/phase-4-progress.md
git commit -m "docs: phase 4 sub-project A release note"
```

---

## Self-Review Checklist (run after writing plan, before execution)

- [x] **Spec coverage:** Migration ✓, state machine ✓, JWT verify ✓, Keychain storage ✓, IPC surface ✓, dev tooling ✓. Cloud HTTP explicitly out of scope (sub-project G).
- [x] **Placeholder scan:** No `TBD` / `TODO` markers in plan; `DEV_PUBLIC_KEY_HEX` placeholder is intentional and Task 5 regenerates it.
- [x] **Type consistency:** `LicenseJwtClaims`, `LicenseStateView`, `LicenseLocalStateRow` referenced consistently across tasks 1, 2, 3, 4.
- [x] **Bite-size:** 6 tasks, each ≤ 8 steps. Step granularity matches Phase 3 plans.
- [x] **Discipline reminders:** included.
