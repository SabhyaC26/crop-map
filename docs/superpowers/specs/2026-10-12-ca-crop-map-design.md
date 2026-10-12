# "What's growing here?" — California crop map — Design

Status: approved 2026-10-12

## Goal

A playful, Snap Map–style static web map of California crops. Zoomed out: big glossy 3D crop
emojis bob over growing regions ("🥬 Salinas Valley"). Zooming in, they spring apart into smaller
regional markers, then crossfade into real field polygons colored by crop. Click a field to see
what's grown there. No farm names. It must look **stunning** — visual quality is a first-class
requirement, not polish.

## Data

- Primary: DWR Statewide Crop Mapping (Land IQ), **2023 final** shapefile:
  `https://data.cnra.ca.gov/dataset/6c3d65e3-35bb-49e1-a51e-49d5a2cf09a9/resource/25d0f174-4bec-4987-a402-602cd1372786/download/i15_crop_mapping_final_2023.zip`
  (~172 MB). Legend PDF: `.../resource/9a00d123-7d5f-46a0-8e89-b6b0591a01f0/download/2022-dwr-standard-land-use-legend-remote-sensing-version.pdf`.
  Portal lists no explicit license; README attributes DWR + Land IQ and links the dataset page.
- Pipeline takes `YEAR` as a parameter (default 2023).
- Fields may be multi-cropped (e.g. CROPTYP1–4 / MULTIUSE; confirm real column names at inspection).
  The primary crop drives color; the popup lists "also grown this year".
- Crop lookup table `data/lookup/crops.csv`: DWR code → `crop_id` (small int), friendly name,
  icon slug, color (hex), harvest months (12-char bitmask, approximate), source note.
  Harvest months come from UC ANR / CDFA; blank when not confidently sourced. UI says "approx."

## Pipeline (`pipeline/`, Makefile-driven, Python 3.12 via uv + GDAL/tippecanoe/pmtiles CLIs)

1. download → `data/raw/` (gitignored)
2. inspect → `docs/crop-codes.md` (fields, distinct codes, counts, acreage)
3. process → EPSG:4326, keep `crop_id`, `crop_ids_other`, `acres`, `county`; drop the rest
4. tiles → `fields.pmtiles` via tippecanoe, layer `fields`, minzoom 9, maxzoom 14
5. regions → H3 aggregation (acres by crop per cell), merge contiguous same-top-crop cells into
   regions, acreage-weighted centroid, label from nearest well-known place → `regions.json`
   with two levels (`coarse` for z5–8, `fine` for z8–10)
6. basemap → California extract of the Protomaps daily build (`basemap.pmtiles`)
- Region subset mode (`REGION=monterey`) for fast prototyping.

## Frontend (`site/`, Vite + vanilla TypeScript, MapLibre GL JS v5 + pmtiles protocol)

- Static, no backend. Tile URLs from one config module so PMTiles can be hosted anywhere with
  HTTP range requests (target: sabhyachhabria.com or R2 later).
- **Basemap**: custom pastel Protomaps style — mint/cream land, saturated bright-blue water,
  thin white roads, minimal labels; subtle hillshade from AWS Terrarium terrain tiles; globe
  projection with sky/atmosphere.
- **Font**: rounded (Nunito) for UI and map labels (custom glyph PBFs).
- **Icons**: Microsoft Fluent Emoji 3D PNGs (MIT) + custom SVGs in matching style for crops
  without emoji (almond, pistachio, walnut, alfalfa, cotton, date, pomegranate, olive...).
- **Zoom bands**: z5–8 coarse region markers (large); z8–10 fine region markers; fields fade in
  from z9, markers fade out by z10.5; z13+ small icon at centroid of large fields.
- **Markers**: HTML markers; floating bob with a ground shadow that shrinks as icon rises;
  randomized phase; squash at bottom; rounded label "Salinas Valley · 120k ac"; springy hover.
  On band change, children spring out from parent position (merge reverses).
- **Fields**: pastel fill per crop, darker same-hue outline; hover brighten + glow; search dims
  others to ~20%.
- **Popup**: rounded card springing from click (bottom sheet on mobile): icon, crop name, acres,
  county, approx harvest months, "also grown".
- **Search**: crop autocomplete → fly to biggest region, highlight that crop.
- **Month slider**: harvesting fields saturated + gentle pulse, others fade; ▶ play cycles months.
- Glassmorphism pill UI, spring easing, `prefers-reduced-motion` respected, 60fps mid phone.

## Milestones

0. Monterey look prototype (approval gate on visuals)
1. Statewide data + lookup table + icon list
2. Statewide tiles + basemap extract
3. Regions + split/merge animation
4. Search + month slider (+ play)
5. Polish, README (attribution/licenses), Playwright GIF/recording, deploy notes

## Out of scope (v1)

Farm names, satellite classification, accounts, NASS CDL year-over-year.

## Testing

Pipeline: pytest on schema, row counts vs source, lookup coverage, PMTiles metadata.
Frontend: `tsc` + build, Playwright smoke (load, zoom, click popup) + screenshots.
