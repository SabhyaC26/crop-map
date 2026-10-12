#!/usr/bin/env bash
# Turns docs/demo/demo-<device>.webm into an MP4 (H.264) and a GIF.
#   scripts/encode-demo.sh laptop|mobile [trim-start-seconds] [speed]
set -euo pipefail
DEVICE="${1:?laptop|mobile}"
TRIM="${2:-0}"
SPEED="${3:-1}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../docs/demo" && pwd)"
IN="$DIR/demo-$DEVICE.webm"

if [[ "$DEVICE" == "mobile" ]]; then GIF_W=360; MP4_W=780; else GIF_W=720; MP4_W=1440; fi

ffmpeg -y -loglevel error -ss "$TRIM" -i "$IN" -vf "setpts=PTS/${SPEED},scale=${MP4_W}:-2:flags=lanczos" -an -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -movflags +faststart -r 30 "$DIR/demo-$DEVICE.mp4"
ffmpeg -y -loglevel error -ss "$TRIM" -i "$IN" \
  -vf "setpts=PTS/${SPEED},fps=12,scale=${GIF_W}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" \
  "$DIR/demo-$DEVICE.gif"
ls -lh "$DIR/demo-$DEVICE".*
ffprobe -v error -show_entries format=duration -of csv=p=0 "$DIR/demo-$DEVICE.mp4"
