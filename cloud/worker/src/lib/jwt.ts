import type { LicenseJwtClaims } from '@carbonink-cloud/shared';
import { JWT_HEADER, JWT_ISSUER } from '@carbonink-cloud/shared';
import { ed25519 } from '@noble/curves/ed25519';

/** Base64url encode a Uint8Array or string. */
function b64url(data: Uint8Array | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Parse 64 or 128 hex chars into a 32-byte Ed25519 seed. */
function parsePrivateKeyHex(hex: string): Uint8Array {
  if (hex.length !== 64 && hex.length !== 128) {
    throw new Error(`Expected 64 or 128 hex chars for Ed25519 private key, got ${hex.length}`);
  }
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Sign a license JWT with Ed25519 (EdDSA).
 * Verifiable by the Electron client using node:crypto.verify with the matching pubkey.
 */
export async function signLicenseJwt(
  claims: LicenseJwtClaims,
  privateKeyHex: string,
): Promise<string> {
  const header = b64url(JSON.stringify(JWT_HEADER));
  const body = b64url(JSON.stringify(claims));
  const signingInput = `${header}.${body}`;
  const seed = parsePrivateKeyHex(privateKeyHex);
  const signature = ed25519.sign(new TextEncoder().encode(signingInput), seed);
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
    revocation_check_after: opts.nowSeconds + opts.revocationCheckIntervalS,
  };
}
