#!/usr/bin/env bash
# Publish SHA-256 checksums next to a Peak POS release directory.
# Usage: scripts/checksum-release.sh dist/release/0.1.0
set -euo pipefail

dir="${1:-}"
if [[ -z "$dir" || ! -d "$dir" ]]; then
  echo "usage: $0 <release-directory>" >&2
  exit 1
fi

cd "$dir"
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

# Sorted so the same artifacts produce the same SHA256SUMS file.
find . -type f ! -name 'SHA256SUMS' ! -name 'SHA256SUMS.asc' \
  | sed 's|^\./||' \
  | LC_ALL=C sort \
  | while IFS= read -r file; do
      sha256sum -- "$file"
    done > "$tmp"

mv "$tmp" SHA256SUMS
echo "Wrote $dir/SHA256SUMS"
cat SHA256SUMS
