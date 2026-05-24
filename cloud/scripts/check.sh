#!/usr/bin/env bash
# Sanity check the CF deploy state — token works, account ID resolves,
# what's deployed, what bindings are bound.
#
# Run this anytime you're not sure if a deploy is healthy.

source "$(dirname "$0")/_lib.sh"

require_env CLOUDFLARE_API_TOKEN

echo "==> wrangler whoami"
wr cloud/worker whoami || true
echo ""

echo "==> Workers deployed"
wr cloud/worker deployments list --name carbonink-cloud-api 2>/dev/null | head -5 || echo "  (carbonink-cloud-api not deployed yet)"
echo ""

echo "==> D1 databases"
wr cloud/worker d1 list 2>&1 | grep -E "carbonink|name" | head -10 || true
echo ""

echo "==> KV namespaces"
wr cloud/worker kv namespace list 2>&1 | grep -E "carbonink|LICENSE|REVOCATION|HUMANIZED|RATE" | head -10 || true
echo ""

echo "==> R2 buckets"
wr cloud/worker r2 bucket list 2>&1 | grep -E "carbonink" || echo "  (no carbonink-releases bucket yet)"
echo ""

echo "==> Worker secrets (names only, never values)"
wr cloud/worker secret list 2>&1 || true
