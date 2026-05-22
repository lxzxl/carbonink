import { createPublicKey, verify as cryptoVerify, type KeyObject } from 'node:crypto';
import type { CredentialStore } from '@main/credentials/safe-storage.js';
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
 * Zod schema mirroring `LicenseJwtClaims`. The decoded JSON body is
 * validated BEFORE any downstream code trusts a field — a JWT with a
 * missing `expires_at` would otherwise crash the state machine.
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

const CRED_KEY_JWT = 'license.jwt';
const CRED_KEY_REVOKED = 'license.revoked';

/**
 * Constructor dependencies. Follows the same factor-out-IO pattern as the
 * rest of the services: DB + `now()` come from `ServiceContext`; everything
 * keychain-related is injected via `CredentialStore` + `deleteBlob` (mirrors
 * `CredentialService` — the deletion path lives outside the store because
 * Phase 0's abstraction intentionally only knows set/get).
 */
export type LicenseServiceDeps = ServiceContext & {
  /** Unix seconds — needed alongside `ServiceContext.now()` (which is ISO). */
  nowSeconds: () => number;
  /** The Ed25519 public key trusted as the issuer. Build-time embedded. */
  publicKey: KeyObject;
  /** Phase 0's safeStorage-wrapping credential store. Reused, not re-built. */
  credentialStore: CredentialStore;
  /**
   * Filesystem-level blob deletion (free function from `safe-storage-backend`).
   * Same shape `CredentialService` uses; let the caller wire the real one.
   */
  deleteBlob: (key: string) => void;
  /** Override for tests; production passes `() => 'dev_' + newId()`. */
  newDeviceId?: () => string;
};

/**
 * Main-process service for the Phase 4 license system.
 *
 * Responsibilities (this sub-project A):
 *   - Read the active JWT from OS Keychain (via `CredentialStore`)
 *   - Verify Ed25519 signature against the embedded public key
 *   - Decode + zod-validate the claims
 *   - Compute the current state via `computeLicenseState`
 *   - Persist DB-side metadata (device_id, last_verified_at,
 *     consecutive_offline_days, last_known_state)
 *
 * Out of scope (deferred to sub-project G — cloud impl):
 *   - HTTP /activate / /verify calls
 *   - Background ping scheduling
 *   - revocation checks
 */
export class LicenseService {
  private readonly db: ServiceContext['db'];
  private readonly nowIso: () => string;
  private readonly nowSec: () => number;
  private readonly publicKey: KeyObject;
  private readonly cred: CredentialStore;
  private readonly deleteBlob: (key: string) => void;
  private readonly newDeviceId: () => string;

  constructor(deps: LicenseServiceDeps) {
    this.db = deps.db;
    this.nowIso = deps.now;
    this.nowSec = deps.nowSeconds;
    this.publicKey = deps.publicKey;
    this.cred = deps.credentialStore;
    this.deleteBlob = deps.deleteBlob;
    this.newDeviceId = deps.newDeviceId ?? (() => `dev_${newId()}`);
  }

  /**
   * Read the current license state. Cheap; safe to call on every UI render
   * via the IPC `license:get-state` channel (one keychain read + one SQLite
   * SELECT + Ed25519 verify).
   *
   * A tampered or corrupted JWT is treated as `unverified` — we deliberately
   * do NOT auto-clear it. Clearing is an explicit `clearJwt()` call so the
   * UI can warn the user before destroying their license record.
   */
  getState(): LicenseStateView {
    const row = this.readOrInitLocalState();
    const jwt = this.readJwt();
    let claims: LicenseJwtClaims | null = null;
    if (jwt !== null) {
      try {
        claims = this.verifyAndDecode(jwt);
      } catch {
        claims = null;
      }
    }
    const revoked = this.cred.get(CRED_KEY_REVOKED) === 'true';
    const { state, reason } = computeLicenseState({
      claims,
      now: this.nowSec(),
      lastVerifiedAt:
        row.last_verified_at != null ? Math.floor(Date.parse(row.last_verified_at) / 1000) : null,
      consecutiveOfflineDays: row.consecutive_offline_days,
      revoked,
    });
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
   * the revoked flag (a fresh activation always wipes any stale revoke
   * marker). Throws if verification fails — the IPC handler maps the error
   * into a tagged `{ ok: false, error }` result.
   */
  setJwt(jwt: string): void {
    // verifyAndDecode throws on bad signature or bad schema.
    this.verifyAndDecode(jwt);
    this.cred.set(CRED_KEY_JWT, jwt);
    this.deleteBlob(CRED_KEY_REVOKED);
    // A successful set implies a successful cloud round-trip from the
    // caller's POV (sub-project G will be the one doing the /activate
    // request and calling setJwt with the response). Reset offline counter.
    this.db
      .prepare(
        `UPDATE license_local_state
            SET last_verified_at = ?, consecutive_offline_days = 0, updated_at = ?
          WHERE id = 1`,
      )
      .run(this.nowIso(), this.nowIso());
  }

  /**
   * Wipe the active JWT + reset DB metadata. After this returns, getState
   * reports `unverified`. Idempotent.
   */
  clearJwt(): void {
    this.deleteBlob(CRED_KEY_JWT);
    this.deleteBlob(CRED_KEY_REVOKED);
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

  private readJwt(): string | null {
    return this.cred.get(CRED_KEY_JWT);
  }

  /**
   * Hand-decode a JWT (`header.body.signature` base64url), verify the
   * Ed25519 signature against `signingInput = header.body`, then zod-parse
   * the body. Returns the validated claims object.
   *
   * Throws if signature invalid OR body fails schema validation. We
   * deliberately reject the `none` algorithm by not even looking at the
   * header — the only call path that constructs a JWT for this service is
   * cloud-side issuance with our private key.
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
    const parsed = licenseJwtClaimsSchema.parse(parsedBody);
    // exactOptionalPropertyTypes: drop the key when it's undefined rather
    // than carrying an explicit `support_until: undefined` that the type
    // alias (which only allows the key to be *absent*) rejects.
    const { support_until, ...rest } = parsed;
    return support_until !== undefined ? { ...rest, support_until } : rest;
  }

  private readOrInitLocalState(): LicenseLocalStateRow {
    const row = this.db.prepare('SELECT * FROM license_local_state WHERE id = 1').get() as
      | LicenseLocalStateRow
      | undefined;
    if (!row) {
      // Migration should have seeded this. Missing row = broken DB; bubble up.
      throw new Error('license_local_state singleton row missing; migration 016 not applied?');
    }
    if (row.device_id === 'pending-first-launch') {
      const fresh = this.newDeviceId();
      const ts = this.nowIso();
      this.db
        .prepare(
          `UPDATE license_local_state
              SET device_id = ?, created_at = ?, updated_at = ?
            WHERE id = 1`,
        )
        .run(fresh, ts, ts);
      return { ...row, device_id: fresh, created_at: ts, updated_at: ts };
    }
    return row;
  }

  private updateCachedState(state: LicenseState): void {
    const ts = this.nowIso();
    this.db
      .prepare(
        `UPDATE license_local_state
            SET last_known_state = ?, last_known_state_at = ?, updated_at = ?
          WHERE id = 1`,
      )
      .run(state, ts, ts);
  }
}

/**
 * Helper: build a `KeyObject` from the raw 32-byte Ed25519 public key bytes
 * embedded at build time. Exposed so the bootstrap site can construct the
 * service without hand-rolling DER wrapping at every call site.
 */
export function publicKeyFromRawBytes(rawBytes: Buffer): KeyObject {
  // Ed25519 SPKI prefix (12 bytes) + 32-byte raw key = 44-byte DER blob.
  // 302a (SEQUENCE 42 bytes)
  //   3005 (SEQUENCE 5 bytes)
  //     0603 2b6570 (OID 1.3.101.112 = id-Ed25519)
  //   0321 00 (BIT STRING 33 bytes, 0 unused bits)
  const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
  if (rawBytes.length !== 32) {
    throw new Error(`Expected 32-byte Ed25519 public key, got ${rawBytes.length} bytes.`);
  }
  const der = Buffer.concat([SPKI_PREFIX, rawBytes]);
  return createPublicKey({ key: der, format: 'der', type: 'spki' });
}
