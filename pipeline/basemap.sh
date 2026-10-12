#!/usr/bin/env bash
# Extract a California basemap from the latest Protomaps daily build.
# Usage: pipeline/basemap.sh [maxzoom]   (env: PMTILES=path/to/pmtiles, BUILD_DATE=YYYYMMDD)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/site/public/data/basemap.pmtiles"
BBOX="-124.6,32.4,-113.9,42.1"
MAXZOOM="${1:-14}"
PMTILES="${PMTILES:-pmtiles}"

if [[ -n "${BUILD_DATE:-}" ]]; then
  DATE="$BUILD_DATE"
else
  DATE=""
  for i in $(seq 0 14); do
    d="$(date -v-"${i}"d +%Y%m%d 2>/dev/null || date -d "-${i} day" +%Y%m%d)"
    if curl -sfI "https://build.protomaps.com/${d}.pmtiles" >/dev/null; then DATE="$d"; break; fi
  done
  [[ -n "$DATE" ]] || { echo "no recent Protomaps build found" >&2; exit 1; }
fi

SRC="https://build.protomaps.com/${DATE}.pmtiles"
mkdir -p "$(dirname "$OUT")"
rm -f "$OUT.tmp"
echo "Extracting $SRC bbox=$BBOX maxzoom=$MAXZOOM -> $OUT"
"$PMTILES" extract "$SRC" "$OUT.tmp" --bbox="$BBOX" --maxzoom="$MAXZOOM"
mv "$OUT.tmp" "$OUT"
echo "$DATE" > "$ROOT/site/public/data/basemap.build-date.txt"
ls -lh "$OUT"
