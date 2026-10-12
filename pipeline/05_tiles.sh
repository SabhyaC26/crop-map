#!/usr/bin/env bash
# Build site/public/data/fields.pmtiles from data/work/<year>/<region>/ (run 04_process.py first).
# REGION=monterey also copies the result to fields-monterey.pmtiles.
set -euo pipefail

YEAR="${YEAR:-2023}"
REGION="${REGION:-statewide}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$ROOT/data/work/$YEAR/$REGION"
OUT_DIR="$ROOT/site/public/data"
OUT="$OUT_DIR/fields.pmtiles"

for f in fields.fgb field_points.geojsonl; do
  [[ -f "$WORK/$f" ]] || { echo "missing $WORK/$f; run 'make process YEAR=$YEAR REGION=$REGION'" >&2; exit 1; }
done
mkdir -p "$OUT_DIR"

# -B9: no rate-based thinning at z9+ (every field kept unless a tile overflows).
# field_points zooms come from the per-feature tippecanoe.minzoom in the GeoJSON sequence.
# Default 500 KB tile limit stays on: z9-10 are thinned by the *-densest-as-needed strategies.
tippecanoe -o "$OUT" --force -Q \
  -Z9 -z14 \
  -B9 \
  --generate-ids \
  --simplification=2 \
  --detect-shared-borders \
  --drop-densest-as-needed \
  --coalesce-densest-as-needed \
  --extend-zooms-if-still-dropping \
  -L "{\"file\":\"$WORK/fields.fgb\",\"layer\":\"fields\"}" \
  -L "{\"file\":\"$WORK/field_points.geojsonl\",\"layer\":\"field_points\"}"

if [[ "$REGION" == "monterey" ]]; then
  cp "$OUT" "$OUT_DIR/fields-monterey.pmtiles"
fi
ls -l "$OUT"
