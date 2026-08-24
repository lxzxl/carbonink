#!/usr/bin/env bash
# Sanity check the CF deploy state — token works, account ID resolves,
# what's deployed, what routes are attached.
#
# Run this anytime you're not sure if a deploy is healthy.

source "$(dirname "$0")/_lib.sh"

require_env CLOUDFLARE_API_TOKEN

echo "==> wrangler whoami"
wr cloud/web whoami || true
echo ""

echo "==> Workers deployed"
wr cloud/web deployments list 2>/dev/null | head -5 || true
echo ""

echo "==> Workers in the account (carbonink*)"
# No wrangler command lists account-wide scripts; use the API.
curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$(wr cloud/web whoami 2>/dev/null | grep -oE 'account id [a-f0-9]{32}' | grep -oE '[a-f0-9]{32}' | head -1)/workers/scripts" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); [print(' -', s['id']) for s in d.get('result') or [] if 'carbonink' in s['id']]" || true
