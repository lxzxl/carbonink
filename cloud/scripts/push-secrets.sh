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
require_env LICENSE_PRIVATE_KEY_HEX
require_env SESSION_PRIVATE_KEY_HEX
require_env STRIPE_SECRET_KEY
require_env STRIPE_WEBHOOK_SECRET
require_env RESEND_API_KEY

# Build the JSON file in a tempdir so it's auto-cleaned and never touches
# the repo tree (defense in depth — .gitignore covers .env.local but not
# everything you might accidentally `git add`).
TMPDIR_X=$(mktemp -d)
trap 'rm -rf "$TMPDIR_X"' EXIT
SECRETS_JSON="$TMPDIR_X/secrets.json"

# Use Node to safely emit JSON (handles edge cases in secret values).
node -e "
const fs = require('fs');
fs.writeFileSync(process.argv[1], JSON.stringify({
  LICENSE_PRIVATE_KEY_HEX: process.env.LICENSE_PRIVATE_KEY_HEX,
  SESSION_PRIVATE_KEY_HEX: process.env.SESSION_PRIVATE_KEY_HEX,
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
}, null, 2));
" "$SECRETS_JSON"

echo "==> Pushing 5 secrets to carbonink-cloud-api worker..."
wr cloud/worker secret bulk "$SECRETS_JSON"
echo "==> Done. Verify with: cd cloud/worker && pnpm exec wrangler secret list"
