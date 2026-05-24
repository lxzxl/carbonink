#!/usr/bin/env node
/**
 * Generate one Ed25519 keypair for use as LICENSE_PRIVATE_KEY_HEX or
 * SESSION_PRIVATE_KEY_HEX. Prints:
 *   - private key (32-byte seed, hex)
 *   - public key (32-byte derived, hex)
 *
 * The worker's `signLicenseJwt` accepts the 32-byte seed alone — it
 * derives the pubkey internally via @noble/curves. The pubkey is what
 * you embed in the Electron client so it can VERIFY signatures it
 * receives from the worker.
 *
 * Usage:
 *   pnpm exec node scripts/gen-keypair.mjs            # one keypair
 *   pnpm exec node scripts/gen-keypair.mjs --label LICENSE
 *   pnpm exec node scripts/gen-keypair.mjs --label SESSION
 *
 * NEVER paste the private key into git, chat, or anywhere logged.
 */
import { ed25519 } from '@noble/curves/ed25519';

function bytesToHex(bytes) {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

const labelIdx = process.argv.indexOf('--label');
const label = labelIdx >= 0 ? process.argv[labelIdx + 1] : 'KEY';

const seed = ed25519.utils.randomPrivateKey();
const pubkey = ed25519.getPublicKey(seed);

const seedHex = bytesToHex(seed);
const pubkeyHex = bytesToHex(pubkey);

console.log(`# ${label} keypair — generated ${new Date().toISOString()}`);
console.log(`# Paste the private line into cloud/.env (or .env.local).`);
console.log(`# The pubkey goes into the Electron client's verifier.`);
console.log('');
console.log(`${label}_PRIVATE_KEY_HEX=${seedHex}`);
console.log(`${label}_PUBLIC_KEY_HEX=${pubkeyHex}    # informational — not used by worker`);
