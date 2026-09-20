#!/bin/sh
# Refuse to cut a release whose git tag does not match package/tauri/cargo version.
# Usage: verify-release-version.sh [v0.1.0|0.1.0]

set -eu

TAG=${1:-${GITHUB_REF_NAME:-}}
if [ -z "$TAG" ]; then
	echo "tag argument or GITHUB_REF_NAME required" >&2
	exit 1
fi
WANT=$(printf '%s' "$TAG" | sed 's/^v//')

pkg=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' package.json | head -n 1)
tc=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' src-tauri/tauri.conf.json | head -n 1)
cargo=$(sed -n 's/^version *= *"\([^"]*\)".*/\1/p' src-tauri/Cargo.toml | head -n 1)

ok=1
for pair in "package.json:$pkg" "tauri.conf.json:$tc" "Cargo.toml:$cargo"; do
	name=${pair%%:*}
	got=${pair#*:}
	if [ "$got" != "$WANT" ]; then
		echo "$name version $got != tag $WANT" >&2
		ok=0
	fi
done
if [ "$ok" -ne 1 ]; then
	exit 1
fi
echo "version ok: $WANT"
