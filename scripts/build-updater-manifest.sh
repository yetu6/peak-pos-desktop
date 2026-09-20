#!/bin/sh
# Build Tauri updater latest.json from signed release artifacts in a directory.
# Usage: build-updater-manifest.sh <semver> <public-base-url> <artifact-dir> > latest.json
#
# Expects sibling .sig files produced by `tauri build` with createUpdaterArtifacts.

set -eu

VERSION=${1:-}
BASE_URL=${2:-}
DIR=${3:-}
if [ -z "$VERSION" ] || [ -z "$BASE_URL" ] || [ -z "$DIR" ]; then
	echo "usage: $0 <semver> <public-base-url> <artifact-dir>" >&2
	exit 1
fi
VERSION=$(printf '%s' "$VERSION" | sed 's/^v//')
BASE_URL=$(printf '%s' "$BASE_URL" | sed 's|/*$||')

if [ ! -d "$DIR" ]; then
	echo "artifact dir missing: $DIR" >&2
	exit 1
fi

add_platform() {
	key=$1
	file=$2
	sig=$3
	if [ ! -f "$file" ] || [ ! -f "$sig" ]; then
		return 0
	fi
	name=$(basename "$file")
	sig_body=$(tr -d '\r\n' <"$sig")
	printf '{"key":"%s","url":"%s/%s","signature":"%s"}\n' "$key" "$BASE_URL" "$name" "$sig_body"
}

tmp=$(mktemp)
# shellcheck disable=SC2038
find "$DIR" -maxdepth 1 -type f \( -name '*.AppImage' -o -name '*.msi' -o -name '*.nsis.zip' -o -name '*.app.tar.gz' \) -print |
	while IFS= read -r file; do
		sig="${file}.sig"
		base=$(basename "$file")
		case "$base" in
		*.AppImage)
			add_platform "linux-x86_64" "$file" "$sig" >>"$tmp"
			;;
		*_x64_*.msi | *_x64-*.msi | *.msi)
			add_platform "windows-x86_64" "$file" "$sig" >>"$tmp"
			;;
		*_aarch64.app.tar.gz | *aarch64*.app.tar.gz)
			add_platform "darwin-aarch64" "$file" "$sig" >>"$tmp"
			;;
		*_x64.app.tar.gz | *x64*.app.tar.gz | *.app.tar.gz)
			add_platform "darwin-x86_64" "$file" "$sig" >>"$tmp"
			;;
		esac
	done

if [ ! -s "$tmp" ]; then
	echo "no signed updater artifacts found in $DIR" >&2
	rm -f "$tmp"
	exit 1
fi

pub_date=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
printf '{\n  "version": "%s",\n  "notes": "Yetu POS Desktop %s",\n  "pub_date": "%s",\n  "platforms": {\n' "$VERSION" "$VERSION" "$pub_date"

first=1
while IFS= read -r line; do
	key=$(printf '%s' "$line" | sed -n 's/.*"key":"\([^"]*\)".*/\1/p')
	url=$(printf '%s' "$line" | sed -n 's/.*"url":"\([^"]*\)".*/\1/p')
	sig=$(printf '%s' "$line" | sed -n 's/.*"signature":"\([^"]*\)".*/\1/p')
	if [ "$first" -eq 0 ]; then
		printf ',\n'
	fi
	first=0
	printf '    "%s": {\n      "url": "%s",\n      "signature": "%s"\n    }' "$key" "$url" "$sig"
done <"$tmp"
printf '\n  }\n}\n'
rm -f "$tmp"
