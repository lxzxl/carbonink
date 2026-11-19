#!/usr/bin/env bash
# Fetches the CJK font the report experiment embeds. The font is 17 MB, so it
# is not committed; the PDF fixtures are.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dir="$root/internal/spike/fixtures/fonts"
out="$dir/NotoSansSC.ttf"

mkdir -p "$dir"
if [[ -s "$out" ]]; then
  echo "already present: $out"
  exit 0
fi

echo "downloading Noto Sans SC (variable TTF)…"
curl -fL --retry 3 --retry-delay 2 \
  -o "$out.tmp" \
  "https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf"
mv "$out.tmp" "$out"
echo "wrote $out"
