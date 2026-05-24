#!/usr/bin/env bash
# Push the 5 worker secrets from cloud/.env.local to the deployed
# carbonink-cloud-api worker via `wrangler secret bulk`.
#
# Idempotent — safe to re-run (overwrites previous values).
#
# Usage:
#   ./cloud/scripts/push-secrets.sh
#
# To set a single secret interactively (and update .env.local separately):
#   cd cloud/worker && pnpm exec wrangler secret put STRIPE_WEBHOOK_SECRET

source "$(dirname "$0")/_lib.sh"

require_env CLOUDFLARE_API_TOKEN

# Push only secrets that are actually set in the env — skipping (with a
# warning) any that are empty. Re-run this script anytime you fill in
# more values; `wrangler secret bulk` overwrites existing entries, so
# it's safe to re-run.
TMPDIR_X=$(mktemp -d)
trap 'rm -rf "$TMPDIR_X"' EXIT
SECRETS_JSON="$TMPDIR_X/secrets.json"

# Use Node to safely emit JSON (handles edge cases in secret values).
# Skips any env var that's empty or unset.
PUSHED=$(node -e "
const fs = require('fs');
const KEYS = [
  'LICENSE_PRIVATE_KEY_HEX',
  'SESSION_PRIVATE_KEY_HEX',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
];
const out = {};
const skipped = [];
for (const k of KEYS) {
  if (process.env[k]) out[k] = process.env[k];
  else skipped.push(k);
}
fs.writeFileSync(process.argv[1], JSON.stringify(out, null, 2));
console.log('PUSHED:', Object.keys(out).join(',') || '(none)');
console.log('SKIPPED:', skipped.join(',') || '(none)');
" "$SECRETS_JSON")

echo "$PUSHED"
echo ""

# Bail if there's nothing to push (don't bother wrangler).
if grep -q "PUSHED: (none)" <<< "$PUSHED"; then
  echo "Nothing to push. Set at least one of the 5 secrets in cloud/.env first."
  exit 1
fi

echo "==> Pushing to carbonink-cloud-api worker..."
wr cloud/worker secret bulk "$SECRETS_JSON"
echo ""
echo "==> Done. Verify: cd cloud/worker && pnpm exec wrangler secret list"
