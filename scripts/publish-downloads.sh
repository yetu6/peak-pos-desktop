#!/bin/sh
# Atomically publish POS installers + updater manifest to the VPS download tree.
# Piped over SSH from GitHub Actions after a signed release is staged remotely.
#
# Required env:
#   PEAK_POS_VERSION    semver with or without leading v
#   PEAK_POS_STAGE_DIR  remote directory filled with flat release files + latest.json
# Optional:
#   PEAK_POS_DOWNLOADS_ROOT  the pos/ tree Caddy serves (default /var/www/yetu-downloads/pos);
#                            the people's download page is written one level up.

set -eu

VERSION=${PEAK_POS_VERSION:-}
STAGE=${PEAK_POS_STAGE_DIR:-}
ROOT=${PEAK_POS_DOWNLOADS_ROOT:-/var/www/yetu-downloads/pos}
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

# The page people open at the bare address: this version's installers, in words.
# Written last and swapped in whole, so a release that failed above never
# changes it. Updater files (.sig, .tar.gz, latest.json) are for tills, not people.
SITE=$(dirname "$ROOT")
python3 - "$VERSION_DIR" "$VERSION" "$STAGING/latest.json" >"$SITE/.index.html.$$" <<'PY'
import datetime, html, json, os, sys
from urllib.parse import quote
folder, version, manifest = sys.argv[1], sys.argv[2], sys.argv[3]
names = sorted(os.listdir(folder))
def link(name):
    return f"pos/{quote(version)}/{quote(name)}"
def first(test):
    return next((n for n in names if test(n)), None)
released = ""
try:
    when = datetime.datetime.fromisoformat(json.load(open(manifest))["pub_date"].replace("Z", "+00:00"))
    released = f" · released {when:%a} {when.day} {when:%b %Y}"
except (KeyError, ValueError, OSError):
    pass
setup = first(lambda n: n.endswith("-setup.exe"))
rows = []
def row(label, name):
    if name:
        rows.append(f'<li><a href="{link(name)}">{html.escape(label)}</a> <span>{html.escape(name)}</span></li>')
row("Windows installer package (.msi)", first(lambda n: n.endswith(".msi")))
row("macOS, Apple silicon (.dmg)", first(lambda n: n.endswith(".dmg") and "aarch64" in n))
row("macOS, Intel (.dmg)", first(lambda n: n.endswith(".dmg") and "x64" in n))
row("Linux (.AppImage)", first(lambda n: n.endswith(".AppImage")))
row("Linux, Ubuntu and Debian (.deb)", first(lambda n: n.endswith(".deb")))
row("Linux, Fedora (.rpm)", first(lambda n: n.endswith(".rpm")))
row("Checksums (SHA256SUMS)", first(lambda n: n == "SHA256SUMS"))
primary = f'<a class="primary" href="{link(setup)}">Download for Windows</a>' if setup else ""
print(f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Download Yetu Till</title>
<style>
:root {{ --ink: #10417c; --text: #10202f; --muted: #5a6577; --paper: #fcfdfe; --line: #dbe1ea; --pay: #c24309; --on-pay: #ffffff; }}
@media (prefers-color-scheme: dark) {{ :root {{ --ink: #6aa6ef; --text: #e9eff7; --muted: #9db0c7; --paper: #0f2033; --line: #22405f; --pay: #f75e2d; --on-pay: #1a0d08; }} }}
body {{ margin: 0; background: var(--paper); color: var(--text); font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }}
main {{ max-width: 40rem; margin: 0 auto; padding: 48px 16px; }}
h1 {{ margin: 0 0 4px; color: var(--ink); font-size: 32px; }}
p {{ margin: 0 0 24px; color: var(--muted); }}
.primary {{ box-sizing: border-box; display: inline-flex; align-items: center; min-height: 48px; padding: 12px 24px; border-radius: 8px; background: var(--pay); color: var(--on-pay); font-weight: 700; text-decoration: none; }}
.primary:focus-visible, a:focus-visible {{ outline: 3px solid var(--ink); outline-offset: 2px; }}
ul {{ list-style: none; margin: 32px 0 0; padding: 0; border-top: 1px solid var(--line); }}
li {{ padding: 12px 0; border-bottom: 1px solid var(--line); }}
li a {{ color: var(--ink); font-weight: 600; }}
li span {{ display: block; color: var(--muted); font-size: 14px; overflow-wrap: anywhere; }}
</style>
</head>
<body>
<main>
<h1>Yetu Till</h1>
<p>Version {html.escape(version)}{released}. Installed tills update themselves overnight.</p>
{primary}
<ul>
{chr(10).join(rows)}
</ul>
</main>
</body>
</html>""")
PY
chmod a+r "$SITE/.index.html.$$"
mv -f "$SITE/.index.html.$$" "$SITE/index.html"

echo "published $VERSION"
echo "  versioned: $VERSION_DIR"
echo "  latest:    $LATEST_DIR"
echo "  updater:   $PUBLIC_BASE/stable/latest.json"
ls -la "$STABLE_DIR" "$LATEST_DIR" "$VERSION_DIR"
