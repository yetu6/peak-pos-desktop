#!/bin/sh
# Collect Tauri bundle outputs into a stable layout for release + updater.
#
# Usage: collect-release-artifacts.sh <platform> <bundle-root> <out-dir>
#   platform: linux | windows | macos
#
# Writes:
#   <out-dir>/<updater-key>/<installer and .sig files>
#   <out-dir>/installers/          (deb/rpm/dmg/exe copies for human download)
#   <out-dir>/platform.txt         (updater key for this matrix cell)

set -eu

PLATFORM=${1:-}
BUNDLE=${2:-}
OUT=${3:-}

if [ -z "$PLATFORM" ] || [ -z "$BUNDLE" ] || [ -z "$OUT" ]; then
	echo "usage: $0 <linux|windows|macos> <bundle-root> <out-dir>" >&2
	exit 1
fi
if [ ! -d "$BUNDLE" ]; then
	echo "bundle root missing: $BUNDLE" >&2
	exit 1
fi

mkdir -p "$OUT/installers"

case "$PLATFORM" in
linux)
	KEY=linux-x86_64
	mkdir -p "$OUT/$KEY"
	# Human installers
	find "$BUNDLE" -type f \( -name '*.deb' -o -name '*.rpm' \) -exec cp -a {} "$OUT/installers/" \;
	# Updater primary: AppImage + signature
	appimage=$(find "$BUNDLE" -type f -name '*.AppImage' ! -name '*.sig' | head -n 1)
	if [ -z "$appimage" ] || [ ! -f "$appimage.sig" ]; then
		echo "linux AppImage + .sig required for updater" >&2
		find "$BUNDLE" -type f | head -50 >&2
		exit 1
	fi
	cp -a "$appimage" "$appimage.sig" "$OUT/$KEY/"
	cp -a "$appimage" "$OUT/installers/"
	;;
windows)
	KEY=windows-x86_64
	mkdir -p "$OUT/$KEY"
	find "$BUNDLE" -type f \( -name '*.msi' -o -name '*.exe' \) ! -name '*.sig' -exec cp -a {} "$OUT/installers/" \;
	# Prefer NSIS zip for updater; fall back to MSI.
	primary=$(find "$BUNDLE" -type f -name '*.nsis.zip' ! -name '*.sig' | head -n 1)
	if [ -z "$primary" ]; then
		primary=$(find "$BUNDLE" -type f -name '*.msi' ! -name '*.sig' | head -n 1)
	fi
	if [ -z "$primary" ] || [ ! -f "$primary.sig" ]; then
		echo "windows updater artifact + .sig required (nsis.zip or msi)" >&2
		find "$BUNDLE" -type f | head -50 >&2
		exit 1
	fi
	cp -a "$primary" "$primary.sig" "$OUT/$KEY/"
	cp -a "$primary" "$OUT/installers/" 2>/dev/null || true
	;;
macos)
	arch=$(uname -m)
	case "$arch" in
	arm64 | aarch64) KEY=darwin-aarch64 ;;
	x86_64 | amd64) KEY=darwin-x86_64 ;;
	*)
		echo "unsupported macOS arch: $arch" >&2
		exit 1
		;;
	esac
	mkdir -p "$OUT/$KEY"
	find "$BUNDLE" -type f -name '*.dmg' ! -name '*.sig' -exec cp -a {} "$OUT/installers/" \;
	primary=$(find "$BUNDLE" -type f -name '*.app.tar.gz' ! -name '*.sig' | head -n 1)
	if [ -z "$primary" ] || [ ! -f "$primary.sig" ]; then
		echo "macOS .app.tar.gz + .sig required for updater" >&2
		find "$BUNDLE" -type f | head -50 >&2
		exit 1
	fi
	cp -a "$primary" "$primary.sig" "$OUT/$KEY/"
	cp -a "$primary" "$OUT/installers/"
	;;
*)
	echo "unknown platform: $PLATFORM" >&2
	exit 1
	;;
esac

printf '%s\n' "$KEY" >"$OUT/platform.txt"
echo "collected $PLATFORM -> $KEY"
find "$OUT" -type f | LC_ALL=C sort
