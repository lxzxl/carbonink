#!/usr/bin/env bash
# Deploy all 4 carbonink-cloud workers to Cloudflare.
#
# Auth: reads CLOUDFLARE_API_TOKEN from cloud/.env.local (or shell env).
# Auto-provisioning: wrangler 4.x auto-creates D1/KV/R2 resources on first
# deploy when their IDs are placeholders, and writes the real IDs back to
# wrangler.toml. So a clean first run does: cloud/worker deploy → creates
# carbonink-cloud D1 + 4 KV namespaces + carbonink-releases R2, then the
# 3 sites deploy as catch-all routes under carbonink.xyz.
#
# Usage:
#   ./cloud/scripts/deploy.sh              # deploy all 4
#   ./cloud/scripts/deploy.sh worker       # just the API worker
#   ./cloud/scripts/deploy.sh marketing    # just marketing site
#   ./cloud/scripts/deploy.sh --dry-run    # validate without deploying
#
# After first deploy:
#   1. cloud/scripts/push-secrets.sh   (sets the 5 worker secrets)
#   2. cd cloud/worker && pnpm exec wrangler d1 migrations apply DB --remote
#   3. Manually set Stripe webhook URL in Stripe dashboard:
#        https://carbonink.xyz/api/v1/stripe-webhook

source "$(dirname "$0")/_lib.sh"

require_env CLOUDFLARE_API_TOKEN

DRY_RUN=""
FILTER=""
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN="--dry-run" ;;
    worker|marketing|activate|account) FILTER="$arg" ;;
    *)
      echo "Unknown arg: $arg" >&2
      echo "Usage: $0 [worker|marketing|activate|account] [--dry-run]" >&2
      exit 1 ;;
  esac
done

# Map short name → directory (bash 3.2-compatible, no `declare -A`).
filter_to_dir() {
  case "$1" in
    worker)    echo cloud/worker ;;
    marketing) echo cloud/sites/marketing ;;
    activate)  echo cloud/sites/activate ;;
    account)   echo cloud/sites/account ;;
    *) echo "bug: unknown filter $1" >&2; exit 1 ;;
  esac
}

# Decide what to deploy
if [[ -n "$FILTER" ]]; then
  TARGETS=("$(filter_to_dir "$FILTER")")
else
  TARGETS=("${WORKERS[@]}")
fi

echo "==> wrangler version: $(cd "$REPO_ROOT/cloud/worker" && pnpm exec wrangler --version 2>&1 | head -1)"
echo "==> account: $(cd "$REPO_ROOT/cloud/worker" && pnpm exec wrangler whoami 2>&1 | grep -E 'email|account' | head -2 | tr '\n' ' ')"
echo ""

# For Astro sites, we need to build first (so dist/ exists).
build_if_static_site() {
  local dir="$1"
  if [[ "$dir" == cloud/sites/* ]]; then
    echo "==> Building $dir (Astro)..."
    (cd "$REPO_ROOT/$dir" && pnpm run build)
  fi
}

for dir in "${TARGETS[@]}"; do
  echo ""
  echo "===================================================================="
  echo " Deploying $dir"
  echo "===================================================================="
  build_if_static_site "$dir"
  wr "$dir" deploy $DRY_RUN
done

echo ""
echo "==> Done."
if [[ -z "$DRY_RUN" ]]; then
  echo ""
  echo "Next steps:"
  echo "  1. Push secrets:       ./cloud/scripts/push-secrets.sh"
  echo "  2. Apply D1 migrations: cd cloud/worker && pnpm exec wrangler d1 migrations apply DB --remote"
  echo "  3. Set Stripe webhook URL: https://carbonink.xyz/api/v1/stripe-webhook"
fi
