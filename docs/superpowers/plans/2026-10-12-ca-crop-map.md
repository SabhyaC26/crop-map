# CA Crop Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Each task is executed by a fresh subagent that reads ONLY its own task section plus "Global Constraints" and "Shared Contracts".

**Goal:** Static, stunning Snap Map–style web map of California crops from DWR 2023 crop mapping.

**Architecture:** Python/GDAL/tippecanoe pipeline produces `fields.pmtiles`, `basemap.pmtiles`,
`regions.json`, `crops.json`. A Vite + vanilla TS MapLibre site consumes them with no backend.

**Tech Stack:** Python 3.12 (uv), geopandas/pyogrio/shapely/h3 v4, GDAL, tippecanoe, pmtiles CLI;
Vite, TypeScript (strict), maplibre-gl v5, pmtiles, @protomaps/basemaps, Playwright.

Spec: `docs/superpowers/specs/2026-10-12-ca-crop-map-design.md`

## Global Constraints

- Repo root: `/Users/sabhya.chhabria/Desktop/ca-crop-map`. Work only in the paths your task owns.
- Other agents work in parallel in the same repo. Commit ONLY your own paths (`git add <paths>`,
  never `git add -A` / `.`). If `.git/index.lock` exists, wait a few seconds and retry.
- Python: `uv` project at repo root (`pyproject.toml`), Python 3.12, run via `uv run`.
- TypeScript strict; imports at top of file; exhaustive `switch` with `never` default.
- No farm names anywhere. No secrets/API keys required anywhere.
- Visual quality is a first-class requirement (Snap Map–level polish): pastel, glossy, soft
  shadows, spring motion, rounded Nunito font, `prefers-reduced-motion` respected.
- Comments only for non-obvious constraints. Match surrounding style.
- Large data never committed: `data/raw/`, `data/work/`, `site/public/data/*.pmtiles` are gitignored.

## Shared Contracts (exact; all tasks must conform)

**Crop lookup** `data/lookup/crops.csv` columns:
`dwr_code,crop_id,name,icon,color,group,harvest,source`
- `crop_id` int 1..255, unique; `icon` ∈ ICON_SLUGS; `color` `#rrggbb`;
  `harvest` = 12 chars of `0/1` Jan..Dec or empty; `group` free text (e.g. "Leafy greens").
- Exported to `site/public/data/crops.json`:
  `[{ "crop_id": 1, "dwr_code": "T15", "name": "Lettuce", "icon": "lettuce", "color": "#9ed97a", "group": "Leafy greens", "harvest": [false,...12] | null }]`

**ICON_SLUGS** (fixed vocabulary):
emoji-backed: `lettuce, broccoli, carrot, onion, garlic, potato, tomato, bell_pepper, hot_pepper,
cucumber, melon, watermelon, corn, strawberry, blueberry, grapes, olive, avocado, orange, lemon,
peach, cherries, apple, pear, kiwi, rice, sunflower, beans, tulip, seedling, herb, cow`
custom SVG: `almond, pistachio, walnut, date, pomegranate, wheat, alfalfa, cotton`
Files: `site/public/icons/<slug>.png` (emoji, 256px) or `site/public/icons/<slug>.svg` (custom);
manifest `site/public/icons/manifest.json` = `{ "<slug>": "<slug>.png|svg", ... }`.

**fields.pmtiles**: vector layer `fields`; minzoom 9, maxzoom 14; feature properties:
`crop_id` (int), `other` (string of comma-joined crop_ids, omitted if none), `acres` (number,
1 decimal), `county` (string, title case). Feature ids enabled (tippecanoe `--generate-ids`).

**regions.json** (`site/public/data/regions.json`):
`{ "coarse": FeatureCollection<Point>, "fine": FeatureCollection<Point> }`; each feature props:
`id` (string), `crop_id` (int), `acres` (number, acres of top crop in region), `label` (string,
e.g. "Salinas Valley"), `parent` (string, fine only = id of containing coarse region).

**Site config** `site/src/config.ts` exports `FIELDS_URL`, `BASEMAP_URL`, `REGIONS_URL`,
`CROPS_URL`, `ICONS_BASE` (defaults to `/data/fields.pmtiles`, `/data/basemap.pmtiles`,
`/data/regions.json`, `/data/crops.json`, `/icons/`), overridable via `import.meta.env.VITE_*`.

**Pipeline Makefile** targets (repo root `Makefile`): `setup download inspect lookup process tiles
regions basemap all`; vars `YEAR ?= 2023`, `REGION ?= statewide` (`monterey` = Monterey County subset).

---

### Task 1: Pipeline foundation — env, download, inspect (Sonnet)
Owns: `pyproject.toml`, `uv.lock`, `Makefile`, `pipeline/01_download.py`, `pipeline/02_inspect.py`,
`pipeline/common.py`, `tests/pipeline/`, `docs/crop-codes.md`.
- Wait for GIS CLIs: `/tmp/brew-install.log` ends with `BREW_EXIT=0` (installing gdal, tippecanoe, pmtiles).
- uv project, Python 3.12; deps: geopandas, pyogrio, shapely, pyproj, h3>=4, pytest.
- `01_download.py --year`: idempotent download + unzip of the DWR shapefile to `data/raw/<year>/`
  (URL table in `common.py`; 2023 URL + legend PDF URL from the spec). Also download the legend PDF.
- `02_inspect.py --year`: write `docs/crop-codes.md`: CRS, feature count, every field with dtype +
  sample values, distinct crop codes per crop column with count + total acres, county list,
  multi-crop columns explained. Extract the legend PDF code→class names into the doc (use
  `pdftotext` if available, else pypdf) so the lookup task can map codes.
- Makefile `setup download inspect` targets working; other targets stubbed to echo "not yet".
- Test: pytest checks `common.py` URL table and that inspect output contains a codes table.
Produces: documented real column names for crop code(s), acres, county, multi-crop.

### Task 2: Site scaffold, design system, pastel basemap (Sonnet)
Owns: `site/` except `site/public/icons/`; plus `pipeline/basemap.sh`.
- Vite + vanilla TS strict app in `site/`; deps maplibre-gl v5, pmtiles, @protomaps/basemaps.
- `site/src/config.ts` per contract. Register pmtiles protocol.
- `pipeline/basemap.sh`: `pmtiles extract` California bbox (-124.6,32.4,-113.9,42.1) from the
  latest Protomaps daily build (https://build.protomaps.com/YYYYMMDD.pmtiles; find a valid recent
  date) to `site/public/data/basemap.pmtiles`, maxzoom 14 (or lower if > 1.5 GB). Run it.
- Basemap style module `site/src/style/basemap.ts`: custom pastel flavor (mint/cream land,
  saturated bright-blue water, white thin roads, soft parks, minimal labels in Nunito), hillshade
  from AWS Terrarium (`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`,
  `encoding: terrarium`) subtle; globe projection + sky/atmosphere. Initial view: California.
- Nunito glyph PBFs in `site/public/fonts/{fontstack}/{range}.pbf` (generate with a font-maker
  tool, e.g. `npx @maplibre/font-maker` or fontnik/build_pbf_glyphs; fallback Noto Sans from
  protomaps basemaps-assets and report it).
- Design system `site/src/styles/` CSS: tokens (pastels, radii, shadows, spring easing
  `cubic-bezier(.34,1.56,.64,1)`), glass pill panels (backdrop-filter), Nunito web font, mobile
  breakpoints, reduced-motion. App shell: title pill "What's growing here? 🌱", empty slots for
  search (top), month slider (bottom), attribution.
- Verify: `npm run build` + `tsc --noEmit` pass; take a Playwright screenshot at CA view and z11
  Salinas to `docs/screens/basemap-*.png`.
Produces: `createMap(container): maplibregl.Map` in `site/src/map.ts`; UI slot element ids
`#search-slot`, `#month-slot`, `#popup-root`.

### Task 3: Crop icon set (Sonnet)
Owns: `site/public/icons/`, `assets-src/icons/`, `docs/icons.md`.
- Download Microsoft Fluent Emoji **3D** PNGs (github.com/microsoft/fluentui-emoji, MIT) for every
  emoji-backed slug; resize to 256px (sips); name `<slug>.png`.
  Mapping: lettuce=Leafy green, broccoli, carrot, onion, garlic, potato, tomato, bell_pepper=Bell
  pepper, hot_pepper, cucumber, melon, watermelon, corn=Ear of corn, strawberry, blueberry=Blueberries,
  grapes, olive, avocado, orange=Tangerine, lemon, peach, cherries, apple=Red apple, pear, kiwi=Kiwi
  fruit, rice=Sheaf of rice, sunflower, beans, tulip, seedling, herb, cow.
- Hand-author custom SVGs for `almond, pistachio, walnut, date, pomegranate, wheat, alfalfa,
  cotton` that match Fluent 3D style: soft radial gradients, highlight sheen, subtle inner shadow,
  256 viewBox, no strokes-only clip art. Each should be instantly recognizable at 40px.
- `manifest.json` per contract; `assets-src/icons/contact-sheet.html` showing all icons at 40/96px
  on light and pastel-green bg; screenshot to `docs/screens/icons.png`. `docs/icons.md` with
  license attribution (Fluent Emoji MIT).

### Task 4: Lookup table + process + field tiles (Sonnet) — after Task 1
Owns: `data/lookup/crops.csv`, `pipeline/03_lookup.py`, `pipeline/04_process.py`,
`pipeline/05_tiles.sh`, tests. Uses `docs/crop-codes.md`.
- Draft `crops.csv` covering every crop code present (contract). Idle/fallow/urban/non-ag classes
  excluded from tiles. Harvest months approx from UC ANR/CDFA; cite in `source`.
- `03_lookup.py` validates CSV (icons ∈ ICON_SLUGS, unique ids, colors) and exports crops.json.
- `04_process.py --year --region`: read shapefile (pyogrio), filter to ag, reproject EPSG:4326,
  map codes → crop_id/other, round acres, title-case county → `data/work/<year>/<region>/fields.fgb`.
- `05_tiles.sh`: tippecanoe → `site/public/data/fields.pmtiles` per contract (layer `fields`,
  -Z9 -z14, --generate-ids, --coalesce-densest-as-needed / --drop-densest-as-needed tuned so
  z9–10 stay < 500KB/tile; `--no-tile-size-limit` forbidden).
- Build REGION=monterey first, then statewide; report sizes + counts. Tests: lookup coverage,
  row count parity, schema.

### Task 5: Fields layer + popup (Sonnet) — after Tasks 2, 3, 4(monterey)
### Task 6: Regions pipeline (Sonnet) — after Task 4
### Task 7: Markers, bobbing, split/merge (Sonnet) — after Tasks 5, 6
### Task 8: Search + month slider + play (Sonnet) — after Task 7
### Task 9: Statewide build verification (Haiku)
### Task 10: README, Playwright smoke + GIF (Haiku)

Tasks 5–10 briefs are written by the controller at dispatch time using outputs of earlier tasks.
