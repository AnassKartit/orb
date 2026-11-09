#!/bin/sh
# parity.sh <orb build dir> <reference HF project dir> <t1,t2,...> : per-frame SSIM of two HyperFrames projects.
set -e
A=$(cd "$1" && pwd); B=$(cd "$2" && pwd); T=$3
rm -rf "$A/.parity"; mkdir -p "$A/.parity/a" "$A/.parity/b"
HF_WORKERS=1 npx --no-install hyperframes snapshot "$A" --at "$T" --no-end --output "$A/.parity/a" --json >/dev/null 2>&1
HF_WORKERS=1 npx --no-install hyperframes snapshot "$B" --at "$T" --no-end --output "$A/.parity/b" --json >/dev/null 2>&1
for f in "$A"/.parity/a/frame-*.png; do
  n=$(basename "$f")
  s=$(ffmpeg -v info -i "$f" -i "$A/.parity/b/$n" -lavfi ssim -f null - 2>&1 | sed -n 's/.*All:\([0-9.]*\).*/\1/p')
  echo "$n $s"
done
