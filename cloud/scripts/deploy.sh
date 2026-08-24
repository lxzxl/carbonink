#!/usr/bin/env bash
# Deploy the carbonink-cloud web site (the only deployed worker) to Cloudflare.
#
# Auth: reads CLOUDFLARE_API_TOKEN from cloud/.env.local (or shell env).
#
# Usage:
#   ./cloud/scripts/deploy.sh              # deploy
#   ./cloud/scripts/deploy.sh --dry-run    # validate without deploying

source "$(dirname "$0")/_lib.sh"

require_env CLOUDFLARE_API_TOKEN

DRY_RUN=""
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN="--dry-run" ;;
    *)
      echo "Unknown arg: $arg" >&2
      echo "Usage: $0 [--dry-run]" >&2
      exit 1 ;;
  esac
done

echo "==> wrangler version: $(cd "$REPO_ROOT/cloud/web" && pnpm exec wrangler --version 2>&1 | head -1)"
echo "==> account: $(cd "$REPO_ROOT/cloud/web" && pnpm exec wrangler whoami 2>&1 | grep -E 'email|account' | head -2 | tr '\n' ' ')"
echo ""

echo "===================================================================="
echo " Building + deploying cloud/web"
echo "===================================================================="

# The Astro worker needs `pnpm build` first so `dist/` exists for
# wrangler to pick up the SSR entry + static assets.
echo "==> Building cloud/web (Astro)..."
(cd "$REPO_ROOT/cloud/web" && pnpm run build)

wr cloud/web deploy $DRY_RUN

echo ""
echo "==> Done."
