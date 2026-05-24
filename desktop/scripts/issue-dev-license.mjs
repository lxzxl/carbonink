#!/usr/bin/env node
// Mint a dev license JWT for local testing of the License UI / state machine.
//
// Usage:
//   node scripts/issue-dev-license.mjs                          # 365-day base
//   node scripts/issue-dev-license.mjs --plan trial --days 14   # trial
//   node scripts/issue-dev-license.mjs --days -1                # already-expired
//
// Output: a single JWT string on stdout. Pipe into the License UI's
// activation form (once sub-project B ships), or — for now — paste into
// a Node REPL that calls `licenseApi.setJwt({ jwt })`.
//
// The matching public key lives in `src/main/services/license-public-key.ts`
// (kept in sync at sub-project A Task 5). Production builds will replace
// both with the cloud-issued prod keypair.

import { createPrivateKey, sign as cryptoSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KEYPATH = join(__dirname, 'dev', 'license-keypair', 'private.pem');

function parseArgs(argv) {
  const args = {
    plan: 'base',
    days: 365,
    userId: 'usr_dev_local',
    licenseId: 'lic_dev_local',
    features: 'inventory,questionnaire,iso14064',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--plan') args.plan = argv[++i];
    else if (a === '--days') args.days = Number(argv[++i]);
    else if (a === '--user-id') args.userId = argv[++i];
    else if (a === '--license-id') args.licenseId = argv[++i];
    else if (a === '--features') args.features = argv[++i];
    else if (a === '--help' || a === '-h') {
      process.stderr.write(
        [
          'Usage: node scripts/issue-dev-license.mjs [options]',
          '  --plan <name>          base | trial | cbam (default: base)',
          '  --days <n>             days until expiry (default: 365)',
          '  --user-id <id>         (default: usr_dev_local)',
          '  --license-id <id>      (default: lic_dev_local)',
          '  --features <csv>       comma-separated; default: inventory,questionnaire,iso14064',
          '',
          'Tips:',
          '  --days -1 produces an already-expired JWT (handy for testing the grace banner).',
          '  --days -31 produces a fully-expired JWT (past grace_until).',
        ].join('\n') + '\n',
      );
      process.exit(0);
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

const now = Math.floor(Date.now() / 1000);
const claims = {
  iss: 'carbonink.xyz',
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

process.stdout.write(`${signingInput}.${sig.toString('base64url')}\n`);
