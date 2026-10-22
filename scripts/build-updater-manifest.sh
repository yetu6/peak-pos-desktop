#!/bin/sh
# Build Tauri updater latest.json from collected release layout.
# Usage: build-updater-manifest.sh <semver> <public-base-url> <release-root> > latest.json
#
# Expects per-platform dirs under release-root:
#   linux-x86_64/, windows-x86_64/, darwin-aarch64/ and/or darwin-x86_64/
# each containing one updater binary + matching .sig

set -eu

VERSION=${1:-}
BASE_URL=${2:-}
DIR=${3:-}
if [ -z "$VERSION" ] || [ -z "$BASE_URL" ] || [ -z "$DIR" ]; then
	echo "usage: $0 <semver> <public-base-url> <release-root>" >&2
	exit 1
fi
VERSION=$(printf '%s' "$VERSION" | sed 's/^v//')
BASE_URL=$(printf '%s' "$BASE_URL" | sed 's|/*$||')

if [ ! -d "$DIR" ]; then
	echo "release root missing: $DIR" >&2
	exit 1
fi

emit_platform() {
	key=$1
	pdir="$DIR/$key"
	if [ ! -d "$pdir" ]; then
		return 1
	fi
	file=$(find "$pdir" -maxdepth 1 -type f ! -name '*.sig' ! -name '.*' | head -n 1)
	if [ -z "$file" ]; then
		echo "no updater binary in $pdir" >&2
		return 1
	fi
	sig="${file}.sig"
	if [ ! -f "$sig" ]; then
		echo "missing signature: $sig" >&2
		return 1
	fi
	name=$(basename "$file")
	sig_body=$(tr -d '\r\n' <"$sig")
	# URL lives under versioned public tree (same basename as staged file).
	# Encoded: the installers are named "Peak Terminal_...", and a raw space
	# in the manifest broke the release's own download check (v0.1.2).
	name_url=$(python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1]))' "$name")
	printf '%s\t%s\t%s\n' "$key" "$BASE_URL/$name_url" "$sig_body"
}

tmp=$(mktemp)
missing=0
for key in linux-x86_64 windows-x86_64; do
	if ! emit_platform "$key" >>"$tmp"; then
		echo "required platform missing or incomplete: $key" >&2
		missing=1
	fi
done

darwin_ok=0
for key in darwin-aarch64 darwin-x86_64; do
	if emit_platform "$key" >>"$tmp"; then
		darwin_ok=1
	fi
done
if [ "$darwin_ok" -ne 1 ]; then
	echo "required: at least one of darwin-aarch64 / darwin-x86_64" >&2
	missing=1
fi

if [ "$missing" -ne 0 ] || [ ! -s "$tmp" ]; then
	rm -f "$tmp"
	exit 1
fi

# Deduplicate keys (keep first)
dedup=$(mktemp)
awk -F '\t' '!seen[$1]++ {print}' "$tmp" >"$dedup"
mv "$dedup" "$tmp"

pub_date=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
printf '{\n  "version": "%s",\n  "notes": "Yetu POS Desktop %s",\n  "pub_date": "%s",\n  "platforms": {\n' "$VERSION" "$VERSION" "$pub_date"

first=1
while IFS="$(printf '\t')" read -r key url sig; do
	[ -n "$key" ] || continue
	if [ "$first" -eq 0 ]; then
		printf ',\n'
	fi
	first=0
	# Escape JSON string content minimally (urls/sigs are base64/url-safe).
	printf '    "%s": {\n      "url": "%s",\n      "signature": "%s"\n    }' "$key" "$url" "$sig"
done <"$tmp"
printf '\n  }\n}\n'
rm -f "$tmp"
