#!/usr/bin/env bash
# Shared helpers for cloud deploy scripts.
# Source this from other scripts: `source "$(dirname "$0")/_lib.sh"`

set -euo pipefail

# Resolve cloud/ root regardless of where the calling script lives.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLOUD_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$CLOUD_ROOT/.." && pwd)"

# Load .env.local if present. We expect CLOUDFLARE_API_TOKEN in there at
# minimum; secret scripts also expect the worker secrets.
if [[ -f "$CLOUD_ROOT/.env.local" ]]; then
  # shellcheck disable=SC1091
  set -a; source "$CLOUD_ROOT/.env.local"; set +a
fi

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

# All four wranglers we ship.
WORKERS=(
  cloud/worker
  cloud/sites/marketing
  cloud/sites/activate
  cloud/sites/account
)
