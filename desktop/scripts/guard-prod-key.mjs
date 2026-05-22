#!/usr/bin/env node
/**
 * Build-time guard: ensures the Ed25519 public key in
 * license-public-key.ts has been replaced with a real production key.
 * Exits non-zero if the placeholder is still present.
 *
 * Run as part of `pnpm dist:*` (distribution builds), NOT `pnpm build`
 * (dev builds need the dev key to work with issue-dev-license.mjs).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const keyFile = join(__dirname, '..', 'src', 'main', 'services', 'license-public-key.ts');
const content = readFileSync(keyFile, 'utf8');

const PLACEHOLDER = '0'.repeat(64);
const DEV_KEY = '45137100977d34b17e6ae61ded3db7810215559157de81a0cdf4b6bcb49fb745';

if (content.includes(PLACEHOLDER)) {
  process.stderr.write(
    '\n\x1b[31mERROR: license-public-key.ts still contains the all-zero placeholder.\n' +
      'Replace PUBLIC_KEY_HEX with the production Ed25519 public key before building a release.\x1b[0m\n\n',
  );
  process.exit(1);
}

if (content.includes(DEV_KEY)) {
  process.stderr.write(
    '\n\x1b[31mERROR: license-public-key.ts still contains the DEVELOPMENT key.\n' +
      'Replace PUBLIC_KEY_HEX with the production Ed25519 public key before building a release.\x1b[0m\n\n',
  );
  process.exit(1);
}

process.stderr.write('✓ Production public key guard passed.\n');
