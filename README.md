# What's growing here?

A playful map of what California grows, from field-level crop data.

**Live: [crops.sabhyachhabria.com](https://crops.sabhyachhabria.com)**

![The whole-California view: pastel map with crop emoji over the Central Valley](docs/screens/main-ca.png)

Every farm field in the state, coloured by crop, on a hand-tuned pastel basemap. Emoji markers bob over the
regions famous for each crop, the "What's in view" legend tallies the fields on screen, clicking a field opens a
card with its crop, acreage and county, and search lights up where a crop grows statewide
(try "almonds"). Each field card also estimates profit per acre (crop sales, growing cost, land cost), and a
filter under the search bar highlights profitable or losing fields ([method](docs/economics.md)). Demo videos: [laptop](docs/demo/demo-laptop.mp4), [mobile](docs/demo/demo-mobile.mp4).

## How it works

A static site with no backend: Vite + TypeScript + [MapLibre GL](https://maplibre.org/) v5, with every map layer
read straight from [PMTiles](https://protomaps.com/docs/pmtiles) archives over HTTP range requests.

| Path | What |
|---|---|
| `site/` | The web app (`npm run dev`, `npm run build` → `site/dist/`) |
| `site/public/data/` | Small runtime data (crop list, regions, rasters, labels); the `.pmtiles` are built, not committed |
| `pipeline/` | Python + GDAL/tippecanoe pipeline that turns the DWR shapefile into tiles and regions |
| `data/lookup/` | Hand-curated crop lookup (DWR code → name, emoji, colour, harvest months) and place names |
| `assets-src/` | Icon sources |
| `data/lookup/economics.json` | Hand-curated cost studies and crop-type/region mapping for the profit estimates |
| `docs/` | Notes on crop codes, regions, icons, fonts, harvest sources, and screenshots |

## Run it locally

The app expects four PMTiles archives in `site/public/data/`: `basemap.pmtiles`, `fields.pmtiles`,
`overview.pmtiles` and `fields-low.pmtiles`. Build them with the pipeline below, then:

```bash
cd site
npm install
npm run dev        # http://localhost:5173
```

### Build the data

Needs [uv](https://docs.astral.sh/uv/), GDAL (`ogr2ogr`), [tippecanoe](https://github.com/felt/tippecanoe) and the
[pmtiles CLI](https://github.com/protomaps/go-pmtiles) (`brew install gdal tippecanoe pmtiles` on macOS).

```bash
make setup         # Python deps + checks the CLI tools
make download      # DWR Statewide Crop Mapping 2023 shapefile (~172 MB)
make all           # fields, overview, low-zoom fields, regions -> site/public/data/
pipeline/basemap.sh   # California extract of the latest Protomaps daily build (~640 MB at z14)
```

## Deploy

`npm run build` deliberately leaves the `.pmtiles` out of `dist/`: they are too big for most static hosts, so host
them anywhere that serves HTTP range requests with CORS (Cloudflare R2, S3, a plain nginx/Caddy box) and point the
build at them:

```bash
VITE_BASEMAP_URL=https://tiles.example.com/basemap.pmtiles \
VITE_FIELDS_URL=https://tiles.example.com/fields.pmtiles \
VITE_OVERVIEW_URL=https://tiles.example.com/overview.pmtiles \
VITE_FIELDS_LOW_URL=https://tiles.example.com/fields-low.pmtiles \
npm run build
```

The live site runs on Cloudflare Pages with the tiles on R2: `deploy.sh` builds and deploys
(`TILES_BASE` and `PAGES_PROJECT` override the defaults), `r2-cors.json` is the bucket's CORS policy, and
`site/public/_headers` sets the Pages cache headers.

## Data and credits

- **Crop fields:** California Department of Water Resources, [Statewide Crop Mapping 2023](https://data.cnra.ca.gov/dataset/6c3d65e3-35bb-49e1-a51e-49d5a2cf09a9),
  produced by Land IQ.
- **Crop yields & prices (profit estimates):** [UC Davis CalAg](https://calag.ucdavis.edu/data/county-crop-reports.html)
  compilation of County Agricultural Commissioner crop reports (2022–2024); `make economics` downloads
  `cleaned_county_ag_all_crops_web.xlsx` from the
  [CalAg shared folder](https://ucdavis.app.box.com/s/y6t2icitof2gib1zwwy7ygu3bjpogh0f/folder/368575016764).
- **Growing & land costs (profit estimates):** [UC Davis Cost and Return Studies](https://coststudies.ucdavis.edu),
  land rent/tax removed from growing cost, scaled to 2024 by USDA NASS prices-paid and California cropland-value
  indexes. Method and every study: [docs/economics.md](docs/economics.md).
- **Basemap:** © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (ODbL), via
  [Protomaps](https://protomaps.com).
- **Terrain shading:** [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (Terrarium).
- **Crop icons:** [Microsoft Fluent Emoji](https://github.com/microsoft/fluentui-emoji) (MIT), plus original SVGs for
  crops without an emoji ([docs/icons.md](docs/icons.md)).
- **Font:** [Figtree](https://github.com/erikdkennedy/figtree) (SIL OFL 1.1, `site/public/webfonts/OFL.txt`).

## License

Code and original artwork: [MIT](LICENSE). Third-party data, icons and fonts keep their own licenses, listed above.
