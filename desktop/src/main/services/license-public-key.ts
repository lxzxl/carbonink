import { publicKeyFromRawBytes } from './license-service.js';

/**
 * Ed25519 public key for verifying license JWTs.
 *
 * **BUILD-TIME SWAP TARGET** — the CI release workflow (or a local
 * `pnpm dist:mac` / `pnpm dist:win`) must replace the hex below with
 * the production public key before packaging. The guard script
 * `scripts/guard-prod-key.mjs` enforces this for distribution builds.
 *
 * For local development, `scripts/issue-dev-license.mjs` regenerates
 * a dev keypair and rewrites this constant; the matching private key
 * lives at `scripts/dev/license-keypair/private.pem`.
 *
 * Sanity guard: `loadLicensePublicKey()` throws if the hex is all-zero
 * so a release accidentally shipped with the placeholder is loud-failing
 * on first launch rather than silently accepting any forged JWT.
 */
const PUBLIC_KEY_HEX = '45137100977d34b17e6ae61ded3db7810215559157de81a0cdf4b6bcb49fb745';

export function loadLicensePublicKey() {
  if (/^0+$/.test(PUBLIC_KEY_HEX)) {
    throw new Error(
      'license public key not initialised — see src/main/services/license-public-key.ts',
    );
  }
  const bytes = Buffer.from(PUBLIC_KEY_HEX, 'hex');
  return publicKeyFromRawBytes(bytes);
}
