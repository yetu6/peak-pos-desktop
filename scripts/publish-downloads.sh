#!/bin/sh
# Publish POS installers + updater manifest to the VPS download tree.
# Piped over SSH from GitHub Actions after a GitHub Release is created.
#
# Required env:
#   PEAK_POS_VERSION   semver with or without leading v (e.g. 0.1.0)
#   PEAK_POS_STAGE_DIR directory on the remote already filled with release files
#                      (or leave unset and stream via stdin tar — see CI job)

set -eu

VERSION=${PEAK_POS_VERSION:-}
STAGE=${PEAK_POS_STAGE_DIR:-/tmp/yetu-pos-release-stage}
ROOT=/var/www/yetu-downloads/pos
PUBLIC_BASE=${PEAK_POS_PUBLIC_BASE:-https://downloads.yetu.fbcsoftwares.com/pos}

if [ -z "$VERSION" ]; then
	echo "PEAK_POS_VERSION is required" >&2
	exit 1
fi
VERSION=$(printf '%s' "$VERSION" | sed 's/^v//')

for path in "$ROOT" "$STAGE"; do
	if [ ! -e "$path" ] && [ "$path" != "$STAGE" ]; then
		echo "missing required path: $path" >&2
		echo "bootstrap: create $ROOT owned by the deploy user; serve over HTTPS" >&2
		exit 1
	fi
done

if [ ! -d "$STAGE" ]; then
	echo "stage dir missing: $STAGE" >&2
	exit 1
fi

# Verify checksums when present.
if [ -f "$STAGE/SHA256SUMS" ]; then
	(
		cd "$STAGE"
		sha256sum -c SHA256SUMS
	)
fi

VERSION_DIR="$ROOT/$VERSION"
LATEST_DIR="$ROOT/latest"
STABLE_DIR="$ROOT/stable"

mkdir -p "$VERSION_DIR" "$LATEST_DIR" "$STABLE_DIR"
# Refresh versioned + latest trees from the staged release (no delete of older versions).
find "$STAGE" -maxdepth 1 -type f -exec cp -a {} "$VERSION_DIR"/ \;
find "$STAGE" -maxdepth 1 -type f -exec cp -a {} "$LATEST_DIR"/ \;

# Prefer a pre-built latest.json from CI; otherwise refuse (signing must happen at build time).
if [ ! -f "$STAGE/latest.json" ]; then
	echo "latest.json missing from stage (CI must build the updater manifest)" >&2
	exit 1
fi
cp -a "$STAGE/latest.json" "$STABLE_DIR/latest.json"
cp -a "$STAGE/latest.json" "$VERSION_DIR/latest.json"
cp -a "$STAGE/latest.json" "$LATEST_DIR/latest.json"

# Ensure public URL prefix matches what tills expect.
echo "published $VERSION to $VERSION_DIR, $LATEST_DIR, $STABLE_DIR"
echo "updater endpoint: $PUBLIC_BASE/stable/latest.json"
ls -la "$STABLE_DIR" "$LATEST_DIR" "$VERSION_DIR"
