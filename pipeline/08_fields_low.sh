#!/usr/bin/env bash
# Build site/public/data/fields-low.pmtiles: field polygons for z5-8, crop_id only, so neighbouring fields of
# the same crop coalesce into compact shapes. Search fills the selected crop from these below fields.pmtiles' z9.
set -euo pipefail

YEAR="${YEAR:-2023}"
REGION="${REGION:-statewide}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$ROOT/data/work/$YEAR/$REGION"
OUT="$ROOT/site/public/data/fields-low.pmtiles"

[[ -f "$WORK/fields.fgb" ]] || { echo "missing $WORK/fields.fgb; run 'make process YEAR=$YEAR REGION=$REGION'" >&2; exit 1; }

# --reorder + --coalesce merge every same-crop feature in a tile into one multipolygon, so tiles stay small
# without dropping fields; the low detail grid is plenty for a z5-8 silhouette.
tippecanoe -o "$OUT" --force -Q \
  -Z5 -z8 \
  -y crop_id \
  -l fields_low \
  --reorder --coalesce \
  --low-detail=10 --full-detail=10 \
  --buffer=2 \
  --simplification=4 \
  --maximum-tile-bytes=1200000 \
  --coalesce-smallest-as-needed \
  "$WORK/fields.fgb"

ls -l "$OUT"
