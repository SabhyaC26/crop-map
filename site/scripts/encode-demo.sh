#!/usr/bin/env bash
# Encodes the frames captured by record-demo.mjs into docs/demo/demo-<device>.mp4 at full capture resolution.
#   scripts/encode-demo.sh laptop|mobile
set -euo pipefail
DEVICE="${1:?laptop|mobile}"
LIST="/tmp/demo-frames-$DEVICE/list.txt"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../docs/demo" && pwd)"

# 60 fps CFR keeps the variable-rate screencast frames evenly paced; high-quality x264 keeps text and field edges crisp.
ffmpeg -y -loglevel error -f concat -safe 0 -i "$LIST" \
  -vf "fps=60,scale=trunc(iw/2)*2:trunc(ih/2)*2:flags=lanczos" \
  -c:v libx264 -preset slower -crf 12 -tune animation -profile:v high -pix_fmt yuv420p -movflags +faststart \
  "$DIR/demo-$DEVICE.mp4"
ls -lh "$DIR/demo-$DEVICE.mp4"
ffprobe -v error -select_streams v:0 -show_entries stream=width,height:format=duration -of default=nw=1 "$DIR/demo-$DEVICE.mp4"
