#!/usr/bin/env bash
# Push worker secrets from cloud/.env.local (or cloud/.env) to the two
# deployed workers via `wrangler secret bulk`.
#
# Routing of which secret goes where:
#
#   carbonink-cloud-api  (cloud/worker)        ← all 4 keys
#     LICENSE_PRIVATE_KEY_HEX   — license JWT signing
#     SESSION_PRIVATE_KEY_HEX   — session JWT signing
#     STRIPE_SECRET_KEY         — Stripe webhook signature check + internal
#                                 license-by-email lookup
#     STRIPE_WEBHOOK_SECRET     — Stripe webhook signature secret
#
#   carbonink-cloud-web  (cloud/web)           ← only STRIPE_SECRET_KEY
#     STRIPE_SECRET_KEY         — used by /activate SSR route to resolve a
#                                 Stripe checkout session into a license key
#
# Web does NOT need LICENSE/SESSION private keys (it never signs JWTs
# itself; the API worker is the only signer) and does NOT need the
# webhook secret (Stripe webhooks all hit /api/*).
#
# Idempotent — safe to re-run (`wrangler secret bulk` overwrites
# existing entries). Empty/unset env vars are skipped with a clear
# warning rather than silently zero-ing out a previously-set secret.
#
# Usage:
#   ./cloud/scripts/push-secrets.sh
#
# To set a single secret interactively (and update .env.local separately):
#   cd cloud/worker && pnpm exec wrangler secret put STRIPE_WEBHOOK_SECRET
#   cd cloud/web    && pnpm exec wrangler secret put STRIPE_SECRET_KEY

source "$(dirname "$0")/_lib.sh"

require_env CLOUDFLARE_API_TOKEN

TMPDIR_X=$(mktemp -d)
trap 'rm -rf "$TMPDIR_X"' EXIT
API_SECRETS="$TMPDIR_X/api-secrets.json"
WEB_SECRETS="$TMPDIR_X/web-secrets.json"

# Use Node to safely emit JSON (handles edge cases in secret values,
# escaping quotes / newlines / etc.). Two output files: one with the
# full set for the API worker, one with the web-only subset.
SUMMARY=$(node -e "
const fs = require('fs');
const API_KEYS = [
  'LICENSE_PRIVATE_KEY_HEX',
  'SESSION_PRIVATE_KEY_HEX',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
];
const WEB_KEYS = ['STRIPE_SECRET_KEY'];

function bucket(keys) {
  const out = {};
  const skipped = [];
  for (const k of keys) {
    if (process.env[k]) out[k] = process.env[k];
    else skipped.push(k);
  }
  return { out, skipped };
}

const api = bucket(API_KEYS);
const web = bucket(WEB_KEYS);

fs.writeFileSync(process.argv[1], JSON.stringify(api.out, null, 2));
fs.writeFileSync(process.argv[2], JSON.stringify(web.out, null, 2));

console.log('API   pushed: ' + (Object.keys(api.out).join(',') || '(none)'));
console.log('API   skipped:' + (api.skipped.join(',') || ' (none)'));
console.log('WEB   pushed: ' + (Object.keys(web.out).join(',') || '(none)'));
console.log('WEB   skipped:' + (web.skipped.join(',') || ' (none)'));
" "$API_SECRETS" "$WEB_SECRETS")

echo "$SUMMARY"
echo ""

# A target is empty when its JSON file holds {}; the file is always
# created. We bail per-worker rather than aborting the whole script —
# the user might only have the API-side secrets set up yet.
push_if_nonempty() {
  local dir="$1" file="$2" label="$3"
  if grep -q '^{}$' <"$file"; then
    echo "==> Skipping $label — no secrets to push."
    return
  fi
  echo "==> Pushing to $label..."
  wr "$dir" secret bulk "$file"
  echo ""
}

push_if_nonempty cloud/worker "$API_SECRETS" "carbonink-cloud-api"
push_if_nonempty cloud/web    "$WEB_SECRETS" "carbonink-cloud-web"

echo "==> Done. Verify:"
echo "    cd cloud/worker && pnpm exec wrangler secret list"
echo "    cd cloud/web    && pnpm exec wrangler secret list"
