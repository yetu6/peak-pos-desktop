#!/usr/bin/env bash
# One-shot: launch tauri dev with a given visual fixture, wait for the
# window, resize it, screenshot it, then tear everything down. Used only for
# T1 visual certification; never invoked by CI or a real build.
set -euo pipefail

FIXTURE="$1"
OUT="$2"
WIDTH="${3:-1024}"
HEIGHT="${4:-768}"
DISPLAY_NUM="${DISPLAY_NUM:-:99}"

cd "$(dirname "$0")/.."
echo "VITE_PEAK_VISUAL_FIXTURE=${FIXTURE}" > .env.local

DISPLAY="$DISPLAY_NUM" bunx tauri dev >/tmp/tauri-capture.log 2>&1 &
TAURI_PID=$!

cleanup() {
  kill "$TAURI_PID" >/dev/null 2>&1 || true
  pkill -9 -f "target/debug/peak-pos-desktop" >/dev/null 2>&1 || true
  pkill -9 -f "node .*vite" >/dev/null 2>&1 || true
  wait "$TAURI_PID" 2>/dev/null || true
}
trap cleanup EXIT

WIN=""
for _ in $(seq 1 90); do
  WIN=$(DISPLAY="$DISPLAY_NUM" xdotool search --name "Peak Terminal" 2>/dev/null | head -1 || true)
  [ -n "$WIN" ] && break
  sleep 1
done
if [ -z "$WIN" ]; then
  echo "window never appeared" >&2
  exit 1
fi

sleep 1
DISPLAY="$DISPLAY_NUM" xdotool windowsize "$WIN" "$WIDTH" "$HEIGHT"

# The window can exist before WebKitGTK has painted the page (or before Vite
# has finished serving it after a fresh server start). A blank first paint is
# a solid-color PNG well under 2KB; retry until a real frame lands.
for _ in $(seq 1 30); do
  sleep 1
  DISPLAY="$DISPLAY_NUM" import -window "$WIN" "$OUT"
  SIZE=$(stat -c%s "$OUT" 2>/dev/null || echo 0)
  [ "$SIZE" -gt 3000 ] && break
done
echo "captured $OUT ($(stat -c%s "$OUT") bytes)"
