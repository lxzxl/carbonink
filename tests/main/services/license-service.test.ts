import { type KeyObject, generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import Database from 'better-sqlite3';
import type { SafeStorageLike } from '@main/credentials/safe-storage';
import { CredentialStore } from '@main/credentials/safe-storage';
import { runMigrations } from '@main/db/migrate';
import { LicenseService } from '@main/services/license-service';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * End-to-end LicenseService tests: the service is wired to a freshly-minted
 * Ed25519 keypair (treating one half as "the cloud's"), JWTs are signed by
 * the test using the matching private key, and verification + state
 * computation are exercised against an in-memory SQLite DB.
 *
 * No real Electron `safeStorage` is needed — the test passes a passthrough
 * `SafeStorageLike` that stores plaintext-as-Buffer so the encrypt/decrypt
 * pair round-trips identity-wise.
 */

const NOW_SEC = Math.floor(Date.parse('2026-06-01T00:00:00Z') / 1000);
const NOW_ISO = new Date(NOW_SEC * 1000).toISOString();

function passthroughSafeStorage(): SafeStorageLike {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(s, 'utf8'),
    decryptString: (b) => b.toString('utf8'),
  };
}

function inMemoryBlobStore(): {
  read: (key: string) => Buffer | null;
  write: (key: string, blob: Buffer) => void;
  del: (key: string) => void;
  size: () => number;
} {
  const map = new Map<string, Buffer>();
  return {
    read: (k) => map.get(k) ?? null,
    write: (k, b) => {
      map.set(k, b);
    },
    del: (k) => {
      map.delete(k);
    },
    size: () => map.size,
  };
}

function signJwt(privateKey: KeyObject, claims: object): string {
  const header = { alg: 'EdDSA', typ: 'JWT' };
  const b64 = (obj: object) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const signingInput = `${b64(header)}.${b64(claims)}`;
  const sig = cryptoSign(null, Buffer.from(signingInput), privateKey);
  return `${signingInput}.${sig.toString('base64url')}`;
}

function makeClaims(now: number, overrides: Record<string, unknown> = {}) {
  return {
    iss: 'carbonbook.app',
    license_id: 'lic_01',
    user_id: 'usr_01',
    plan: 'base@2026-q2',
    features: ['inventory', 'questionnaire', 'iso14064'],
    devices_max: 1,
    issued_at: now - 86400,
    expires_at: now + 86400 * 30,
    grace_until: now + 86400 * 60,
    revocation_check_after: now + 86400 * 7,
    ...overrides,
  };
}

describe('LicenseService', () => {
  let db: Database.Database;
  let publicKey: KeyObject;
  let privateKey: KeyObject;
  let blobs: ReturnType<typeof inMemoryBlobStore>;
  let svc: LicenseService;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);

    const kp = generateKeyPairSync('ed25519');
    publicKey = kp.publicKey;
    privateKey = kp.privateKey;

    blobs = inMemoryBlobStore();
    const store = new CredentialStore({
      safeStorage: passthroughSafeStorage(),
      readBlob: blobs.read,
      writeBlob: blobs.write,
      platform: 'darwin', // skips the linux guard
    });

    svc = new LicenseService({
      db,
      now: () => NOW_ISO,
      nowSeconds: () => NOW_SEC,
      publicKey,
      credentialStore: store,
      deleteBlob: blobs.del,
      newDeviceId: () => 'dev_test_device_01',
    });
  });

  afterEach(() => {
    db.close();
  });

  it('returns state=unverified on a fresh DB with no JWT in Keychain', () => {
    const view = svc.getState();
    expect(view.state).toBe('unverified');
    expect(view.claims).toBeNull();
    // First read replaces the migration sentinel device_id.
    expect(view.device_id).toBe('dev_test_device_01');
  });

  it('setJwt verifies signature + stores in Keychain + DB; getState reflects new claims', () => {
    const jwt = signJwt(privateKey, makeClaims(NOW_SEC));
    svc.setJwt(jwt);

    const view = svc.getState();
    expect(view.state).toBe('active');
    expect(view.claims?.license_id).toBe('lic_01');
    expect(view.claims?.plan).toBe('base@2026-q2');
    expect(view.last_verified_at).toBe(NOW_ISO);
    expect(blobs.size()).toBeGreaterThan(0);
  });

  it('setJwt rejects a JWT with a forged signature (different keypair)', () => {
    const otherKp = generateKeyPairSync('ed25519');
    const jwt = signJwt(otherKp.privateKey, makeClaims(NOW_SEC, { license_id: 'lic_forge' }));
    expect(() => svc.setJwt(jwt)).toThrow(/signature/i);
    // State stays unverified — bad JWT was not persisted.
    expect(svc.getState().state).toBe('unverified');
    expect(blobs.size()).toBe(0);
  });

  it('setJwt rejects a JWT whose claims fail schema validation', () => {
    // Missing required fields.
    const jwt = signJwt(privateKey, { iss: 'carbonbook.app', license_id: 'lic_03' });
    expect(() => svc.setJwt(jwt)).toThrow();
    expect(svc.getState().state).toBe('unverified');
    expect(blobs.size()).toBe(0);
  });

  it('setJwt rejects a malformed (non-3-part) JWT', () => {
    expect(() => svc.setJwt('not.a.real.jwt.toomany')).toThrow(/malformed|3 dot/i);
    expect(() => svc.setJwt('onlyonepart')).toThrow(/malformed|3 dot/i);
  });

  it('clearJwt removes the JWT from Keychain + DB; state becomes unverified', () => {
    svc.setJwt(signJwt(privateKey, makeClaims(NOW_SEC)));
    expect(svc.getState().state).toBe('active');

    svc.clearJwt();
    const view = svc.getState();
    expect(view.state).toBe('unverified');
    expect(view.claims).toBeNull();
    expect(view.last_verified_at).toBeNull();
    expect(blobs.size()).toBe(0);
  });

  it('getState surfaces "grace" when expires_at is in the past but grace_until is in the future', () => {
    const claims = makeClaims(NOW_SEC, {
      issued_at: NOW_SEC - 86400 * 60,
      expires_at: NOW_SEC - 86400, // 1 day past expiry
      grace_until: NOW_SEC + 86400 * 29,
    });
    svc.setJwt(signJwt(privateKey, claims));
    expect(svc.getState().state).toBe('grace');
  });

  it('persists the cached state to license_local_state.last_known_state', () => {
    svc.setJwt(signJwt(privateKey, makeClaims(NOW_SEC)));
    svc.getState(); // triggers the cached-state UPDATE
    const row = db
      .prepare(
        'SELECT last_known_state, last_known_state_at FROM license_local_state WHERE id = 1',
      )
      .get() as { last_known_state: string; last_known_state_at: string };
    expect(row.last_known_state).toBe('active');
    expect(row.last_known_state_at).toBe(NOW_ISO);
  });
});
