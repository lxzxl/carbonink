/**
 * Session JWT (Ed25519) + magic-link token helpers for the account portal.
 *
 * Sessions use a SEPARATE signing key (`SESSION_PRIVATE_KEY_HEX`) from the
 * license-issuance key. A leaked session key cannot be used to forge
 * licenses, and vice-versa — different trust models, different blast radius.
 */
import { ed25519 } from '@noble/curves/ed25519';

export type SessionClaims = {
  iss: 'carbonbook.app/account';
  sub: string; // user_id
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
  if (hex.length !== 64 && hex.length !== 128) {
    throw new Error(`Expected 64 or 128 hex chars for Ed25519 seed, got ${hex.length}`);
  }
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

export function verifySessionJwt(
  jwt: string,
  privKeyHex: string,
  nowSeconds: number,
): SessionClaims | null {
  const parts = jwt.split('.');
  if (parts.length !== 3) return null;
  const [h, b, s] = parts as [string, string, string];
  const pub = ed25519.getPublicKey(seedFromHex(privKeyHex));
  let valid = false;
  try {
    valid = ed25519.verify(b64urlDecode(s), new TextEncoder().encode(`${h}.${b}`), pub);
  } catch {
    return null;
  }
  if (!valid) return null;
  let claims: SessionClaims;
  try {
    claims = JSON.parse(new TextDecoder().decode(b64urlDecode(b))) as SessionClaims;
  } catch {
    return null;
  }
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
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

export async function requireSession(
  request: Request,
  privKeyHex: string,
): Promise<SessionClaims | Response> {
  const cookie = readSessionCookie(request);
  const bearer = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? null;
  const tok = cookie ?? bearer;
  if (!tok) {
    return new Response(
      JSON.stringify({ error: { _tag: 'Unauthorized', message: 'no session' } }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    );
  }
  const claims = verifySessionJwt(tok, privKeyHex, Math.floor(Date.now() / 1000));
  if (!claims) {
    return new Response(
      JSON.stringify({ error: { _tag: 'Unauthorized', message: 'invalid session' } }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    );
  }
  return claims;
}
