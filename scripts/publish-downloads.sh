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
def size(name):
    mb = os.path.getsize(os.path.join(folder, name)) / 1_000_000
    return f"{mb:.0f} MB" if mb >= 1 else "under 1 MB"
released = ""
try:
    when = datetime.datetime.fromisoformat(json.load(open(manifest))["pub_date"].replace("Z", "+00:00"))
    released = f", released {when:%a} {when.day} {when:%b %Y}"
except (KeyError, ValueError, OSError):
    pass
# Windows tills update with the .msi (latest.json), so the page offers the same installer:
# a till installed another way would get the update as a second copy.
msi = first(lambda n: n.endswith(".msi"))
icon = first(lambda n: n == "yetu-icon.png")
rows = []
def row(system, detail, name):
    if name:
        rows.append(f'<li><a href="{link(name)}"><span class="system">{html.escape(system)}</span>'
                    f'<span class="detail">{html.escape(detail)} · {size(name)}</span></a></li>')
row("macOS", "Apple silicon (.dmg)", first(lambda n: n.endswith(".dmg") and "aarch64" in n))
row("macOS", "Intel (.dmg)", first(lambda n: n.endswith(".dmg") and "x64" in n))
row("Linux", "Any distribution (.AppImage)", first(lambda n: n.endswith(".AppImage")))
row("Linux", "Ubuntu and Debian (.deb)", first(lambda n: n.endswith(".deb")))
row("Linux", "Fedora (.rpm)", first(lambda n: n.endswith(".rpm")))
mark = f'<img src="{link(icon)}" alt="" width="40" height="40">' if icon else ""
primary = (f'<a class="primary" href="{link(msi)}">Download for Windows</a>'
           f'<p class="note">Windows 10 or 11, 64-bit · {size(msi)}</p>') if msi else ""
sums = first(lambda n: n == "SHA256SUMS")
check = f'<a href="{link(sums)}">Check the files (SHA256SUMS)</a> · ' if sums else ""
print(f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Download Yetu</title>
<style>
:root {{ --ink: #10417c; --text: #10202f; --muted: #5a6577; --paper: #fcfdfe; --card: #ffffff; --line: #dbe1ea; --pay: #c24309; --pay-hover: #a63a08; --on-pay: #ffffff; --focus: #10417c; }}
@media (prefers-color-scheme: dark) {{ :root {{ --ink: #6aa6ef; --text: #e9eff7; --muted: #9db0c7; --paper: #0f2033; --card: #12263c; --line: #22405f; --pay: #f75e2d; --pay-hover: #ff8a5c; --on-pay: #1a0d08; --focus: #8fb8f2; }} }}
* {{ box-sizing: border-box; }}
body {{ margin: 0; background: var(--paper); color: var(--text); font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }}
a {{ color: var(--ink); }}
a:focus-visible {{ outline: 3px solid var(--focus); outline-offset: 2px; border-radius: 4px; }}
header {{ display: flex; align-items: center; gap: 12px; max-width: 44rem; margin: 0 auto; padding: 24px 16px 0; }}
header img {{ border-radius: 10px; }}
header strong {{ font-size: 20px; }}
header span {{ color: var(--muted); font-size: 14px; }}
main {{ max-width: 44rem; margin: 0 auto; padding: 32px 16px 48px; }}
h1 {{ margin: 0 0 8px; font-size: 36px; line-height: 1.15; }}
h2 {{ margin: 40px 0 12px; font-size: 20px; }}
.lead {{ margin: 0 0 24px; color: var(--muted); font-size: 18px; }}
.download {{ padding: 24px; border: 1px solid var(--line); border-radius: 12px; background: var(--card); }}
.primary {{ display: inline-flex; align-items: center; min-height: 56px; padding: 12px 28px; border-radius: 10px; background: var(--pay); color: var(--on-pay); font-size: 18px; font-weight: 700; text-decoration: none; }}
.primary:hover {{ background: var(--pay-hover); }}
.note {{ margin: 12px 0 0; color: var(--muted); font-size: 14px; }}
.files {{ list-style: none; margin: 0; padding: 0; border: 1px solid var(--line); border-radius: 12px; background: var(--card); overflow: hidden; }}
.files li + li {{ border-top: 1px solid var(--line); }}
.files a {{ display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 16px; min-height: 56px; padding: 14px 20px; text-decoration: none; }}
.files a:hover .system {{ text-decoration: underline; }}
.system {{ font-weight: 700; }}
.detail {{ color: var(--muted); font-variant-numeric: tabular-nums; }}
@media (max-width: 560px) {{ .files a {{ flex-direction: column; justify-content: center; }} h1 {{ font-size: 30px; }} }}
ol {{ margin: 0; padding-left: 24px; }}
ol li + li {{ margin-top: 8px; }}
p {{ margin: 0; }}
footer {{ max-width: 44rem; margin: 0 auto; padding: 24px 16px 40px; border-top: 1px solid var(--line); color: var(--muted); font-size: 14px; }}
</style>
</head>
<body>
<header>{mark}<div><strong>Yetu</strong><br><span>by FBC Traders</span></div></header>
<main>
<h1>Download Yetu</h1>
<p class="lead">The till for restaurants, bars and hotels. Version {html.escape(version)}{released}.</p>
<section class="download" aria-label="Windows">{primary}</section>
<h2>Other computers</h2>
<ul class="files">
{chr(10).join(rows)}
</ul>
<h2>After installing</h2>
<ol>
<li>Open Yetu. It opens by itself whenever the computer starts.</li>
<li>Get a code, then a manager types it in Yetu. The till connects by itself once they approve.</li>
<li>Staff tap their name and type their PIN.</li>
</ol>
<h2>Updates</h2>
<p>Yetu updates itself. A new version downloads quietly and installs between 00:00 and 05:00 while the till is locked, or the next time the till is started.</p>
</main>
<footer>{check}<a href="https://yetu.fbcsoftwares.com">yetu.fbcsoftwares.com</a></footer>
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
