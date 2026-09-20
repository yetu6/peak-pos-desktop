#!/bin/sh
# Atomically publish POS installers + updater manifest to the VPS download tree.
# Piped over SSH from GitHub Actions after a signed release is staged remotely.
#
# Required env:
#   PEAK_POS_VERSION    semver with or without leading v
#   PEAK_POS_STAGE_DIR  remote directory filled with flat release files + latest.json

set -eu

VERSION=${PEAK_POS_VERSION:-}
STAGE=${PEAK_POS_STAGE_DIR:-}
ROOT=/var/www/yetu-downloads/pos
PUBLIC_BASE=${PEAK_POS_PUBLIC_BASE:-https://downloads.yetu.fbcsoftwares.com/pos}

if [ -z "$VERSION" ] || [ -z "$STAGE" ]; then
	echo "PEAK_POS_VERSION and PEAK_POS_STAGE_DIR are required" >&2
	exit 1
fi
VERSION=$(printf '%s' "$VERSION" | sed 's/^v//')

if [ ! -d "$ROOT" ]; then
	echo "missing required path: $ROOT" >&2
	echo "bootstrap: create $ROOT owned by the deploy user; serve over HTTPS" >&2
	exit 1
fi
if [ ! -d "$STAGE" ]; then
	echo "stage dir missing: $STAGE" >&2
	exit 1
fi
if [ ! -f "$STAGE/latest.json" ]; then
	echo "latest.json missing from stage" >&2
	exit 1
fi
if [ ! -f "$STAGE/SHA256SUMS" ]; then
	echo "SHA256SUMS missing from stage" >&2
	exit 1
fi

# Fail closed on checksum mismatch before touching public trees.
(
	cd "$STAGE"
	sha256sum -c SHA256SUMS
)

# Validate updater manifest JSON shape (python is on peak-prod).
python3 - "$STAGE/latest.json" "$VERSION" <<'PY'
import json, sys
path, want = sys.argv[1], sys.argv[2]
data = json.load(open(path))
if data.get("version") != want:
    raise SystemExit(f"latest.json version {data.get('version')!r} != {want!r}")
platforms = data.get("platforms") or {}
for key in ("linux-x86_64", "windows-x86_64"):
    if key not in platforms:
        raise SystemExit(f"latest.json missing platform {key}")
    entry = platforms[key]
    if not entry.get("url") or not entry.get("signature"):
        raise SystemExit(f"latest.json incomplete for {key}")
if not any(k.startswith("darwin-") for k in platforms):
    raise SystemExit("latest.json missing darwin platform")
print(f"manifest ok version={want} platforms={sorted(platforms)}")
PY

VERSION_DIR="$ROOT/$VERSION"
LATEST_DIR="$ROOT/latest"
STABLE_DIR="$ROOT/stable"
STAGING="$ROOT/.staging-$VERSION-$$"

cleanup() {
	rm -rf "$STAGING"
}
trap cleanup EXIT

rm -rf "$STAGING"
mkdir -p "$STAGING"
# Flat copy of everything staged (installers, sigs, sums, latest.json).
find "$STAGE" -maxdepth 1 -type f -exec cp -a {} "$STAGING"/ \;

mkdir -p "$VERSION_DIR" "$LATEST_DIR" "$STABLE_DIR"

# Versioned tree: additive history (overwrite same version if re-published).
find "$STAGING" -maxdepth 1 -type f -exec cp -a {} "$VERSION_DIR"/ \;

# latest/: replace contents so removed artifacts do not linger.
find "$LATEST_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
find "$STAGING" -maxdepth 1 -type f -exec cp -a {} "$LATEST_DIR"/ \;

# stable updater endpoint (single file the till polls).
cp -a "$STAGING/latest.json" "$STABLE_DIR/latest.json"

# Ensure world-readable for Caddy (files owned by peak).
chmod -R a+rX "$VERSION_DIR" "$LATEST_DIR" "$STABLE_DIR"

echo "published $VERSION"
echo "  versioned: $VERSION_DIR"
echo "  latest:    $LATEST_DIR"
echo "  updater:   $PUBLIC_BASE/stable/latest.json"
ls -la "$STABLE_DIR" "$LATEST_DIR" "$VERSION_DIR"
