#!/usr/bin/env bash
# Build site/ against a PMTiles host and deploy dist/ to Cloudflare Pages.
# Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in the environment.
#   TILES_BASE=https://tiles.example.com PAGES_PROJECT=my-crop-map ./deploy.sh
set -euo pipefail
cd "$(dirname "$0")/site"

TILES="${TILES_BASE:-https://tiles.sabhyachhabria.com}"
export VITE_BASEMAP_URL="$TILES/basemap.pmtiles"
export VITE_FIELDS_URL="$TILES/fields.pmtiles"
export VITE_OVERVIEW_URL="$TILES/overview.pmtiles"
export VITE_FIELDS_LOW_URL="$TILES/fields-low.pmtiles"

npm run build
npx wrangler pages deploy dist --project-name "${PAGES_PROJECT:-ca-crop-map}" --branch main --commit-dirty=true
