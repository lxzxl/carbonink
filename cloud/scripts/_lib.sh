#!/usr/bin/env bash
# Shared helpers for cloud deploy scripts.
# Source this from other scripts: `source "$(dirname "$0")/_lib.sh"`

set -euo pipefail

# Resolve cloud/ root regardless of where the calling script lives.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLOUD_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$CLOUD_ROOT/.." && pwd)"

# Load .env then .env.local (latter wins) — both are gitignored at repo
# root. We expect CLOUDFLARE_API_TOKEN at minimum; secret scripts also
# expect the worker secrets.
for env_file in "$CLOUD_ROOT/.env" "$CLOUD_ROOT/.env.local"; do
  if [[ -f "$env_file" ]]; then
    # shellcheck disable=SC1091,SC1090
    set -a; source "$env_file"; set +a
  fi
done

require_env() {
  local var="$1"
  if [[ -z "${!var:-}" ]]; then
    echo "ERROR: required env var $var is not set." >&2
    echo "       set it in cloud/.env.local or export it before running." >&2
    exit 1
  fi
}

# Run wrangler from a specific worker directory.
#   wr <worker-dir> <args...>
wr() {
  local dir="$1"; shift
  (cd "$REPO_ROOT/$dir" && pnpm exec wrangler "$@")
}

# The two wranglers we ship.
#
# After the 3-site merge → 1-site rename, only one Astro worker
# remains:
#   - cloud/worker   → carbonink-cloud-api (handles /api/*)
#   - cloud/web      → carbonink-cloud-web (handles everything else)
WORKERS=(
  cloud/worker
  cloud/web
)
