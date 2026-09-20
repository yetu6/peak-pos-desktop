#!/bin/sh
# Flatten collected per-platform artifact trees into a single release directory.
# Usage: flatten-release-artifacts.sh <artifacts-root> <out-dir>
#
# artifacts-root contains yetu-pos-linux/, yetu-pos-windows/, yetu-pos-macos/
# (or a single collected tree). Copies installers/ + platform updater files flat.

set -eu

SRC=${1:-}
OUT=${2:-}
if [ -z "$SRC" ] || [ -z "$OUT" ]; then
	echo "usage: $0 <artifacts-root> <out-dir>" >&2
	exit 1
fi

mkdir -p "$OUT"
# Copy every non-directory file under platform keys and installers.
find "$SRC" -type f \( \
	-path '*/installers/*' -o \
	-path '*/linux-x86_64/*' -o \
	-path '*/windows-x86_64/*' -o \
	-path '*/darwin-aarch64/*' -o \
	-path '*/darwin-x86_64/*' \
	\) -exec cp -a {} "$OUT"/ \;

# Also accept already-flat inputs.
find "$SRC" -maxdepth 2 -type f \( -name '*.AppImage' -o -name '*.AppImage.sig' -o -name '*.deb' -o -name '*.rpm' -o -name '*.msi' -o -name '*.msi.sig' -o -name '*.exe' -o -name '*.nsis.zip' -o -name '*.nsis.zip.sig' -o -name '*.dmg' -o -name '*.app.tar.gz' -o -name '*.app.tar.gz.sig' \) \
	-exec cp -a {} "$OUT"/ \; 2>/dev/null || true

count=$(find "$OUT" -type f | wc -l)
if [ "$count" -lt 1 ]; then
	echo "no artifacts flattened from $SRC" >&2
	find "$SRC" -type f | head -80 >&2
	exit 1
fi
echo "flattened $count files into $OUT"
find "$OUT" -type f | LC_ALL=C sort
