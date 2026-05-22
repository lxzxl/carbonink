import { REVOCATION_CHECK_INTERVAL_S } from '@carbonbook-cloud/shared';
import { ed25519 } from '@noble/curves/ed25519';
import { describe, expect, it } from 'vitest';
import { buildClaims, signLicenseJwt } from '../src/lib/jwt.js';

// Hex-encode a byte array without using node:Buffer (not available in Workers
// without nodejs_compat, which we intentionally don't enable — see wrangler.toml).
function bytesToHex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

const seed = ed25519.utils.randomPrivateKey();
const pubkey = ed25519.getPublicKey(seed);
const seedHex = bytesToHex(seed);

function b64urlDecode(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function splitJwt(jwt: string): [string, string, string] {
  const parts = jwt.split('.');
  if (parts.length !== 3) throw new Error(`expected 3 JWT parts, got ${parts.length}`);
  return [parts[0] as string, parts[1] as string, parts[2] as string];
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
    expect(jwt.split('.').length).toBe(3);
  });

  it('header has alg=EdDSA, typ=JWT', async () => {
    const jwt = await signLicenseJwt(claims, seedHex);
    const [h] = splitJwt(jwt);
    const header = JSON.parse(new TextDecoder().decode(b64urlDecode(h)));
    expect(header.alg).toBe('EdDSA');
    expect(header.typ).toBe('JWT');
  });

  it('body round-trips the claims', async () => {
    const jwt = await signLicenseJwt(claims, seedHex);
    const [, b] = splitJwt(jwt);
    const body = JSON.parse(new TextDecoder().decode(b64urlDecode(b)));
    expect(body.iss).toBe('carbonbook.app');
    expect(body.license_id).toBe('lic_test');
    expect(body.plan).toBe('base@2026-q2');
    expect(body.features).toEqual(['inventory', 'questionnaire', 'iso14064']);
  });

  it('signature is verifiable with the matching public key', async () => {
    const jwt = await signLicenseJwt(claims, seedHex);
    const [h, b, s] = splitJwt(jwt);
    const sigInput = new TextEncoder().encode(`${h}.${b}`);
    const sig = b64urlDecode(s);
    expect(ed25519.verify(sig, sigInput, pubkey)).toBe(true);
  });

  it('rejects a tampered body', async () => {
    const jwt = await signLicenseJwt(claims, seedHex);
    const [h, b, s] = splitJwt(jwt);
    const tamperedB = `${b}x`;
    const sigInput = new TextEncoder().encode(`${h}.${tamperedB}`);
    const sig = b64urlDecode(s);
    expect(ed25519.verify(sig, sigInput, pubkey)).toBe(false);
  });
});
