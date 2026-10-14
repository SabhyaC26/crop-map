// Builds site/public/data/water.json: simplified water-agency and groundwater-basin polygons (TopoJSON) that the
// field popup uses to say where a field's water comes from.
//
//   node scripts/build-water.mjs [--refresh]
//
// Sources (California Department of Water Resources), cached in data/work/water/ (--refresh re-downloads):
//   i03 Water Districts: every public water agency, incl. irrigation districts and federal/state contractors
//   Bulletin 118 groundwater basins + the critically overdrafted basins
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import mapshaper from 'mapshaper';

const ROOT = new URL('../../', import.meta.url).pathname;
const CACHE = join(ROOT, 'data/work/water');
const OUT = join(ROOT, 'site/public/data/water.json');
const REFRESH = process.argv.includes('--refresh');
const GEO = 'https://gis.water.ca.gov/arcgis/rest/services/Geoscientific';
const SOURCES = {
  districts: 'https://gis.data.cnra.ca.gov/api/download/v1/items/538bfc2e4ad64ff78ff18fbb8ca36033/geojson?layers=0',
  basins: `${GEO}/i08_B118_CA_GroundwaterBasins/FeatureServer/0/query?where=1%3D1&outFields=Basin_Subbasin_Number,Basin_Name,Basin_Subbasin_Name&outSR=4326&f=geojson`,
  overdraft: `${GEO}/i08_CriticallyOverdraftedBasins/FeatureServer/0/query?where=1%3D1&outFields=Basin_Subbasin_Number&returnGeometry=false&f=json`,
};
/** Simplification tolerance in metres: fields are tested by the click point, so a few hundred metres at an edge is fine. */
const SIMPLIFY_METRES = 400;
/**
 * Agencies smaller than this (m²) are trailer parks, cemeteries and town systems: they rarely hold farmland, and when
 * a field edge touches one it would wrongly win as "the most local agency". Dropping them is most of the file size.
 */
const MIN_DISTRICT_M2 = 2e6;

async function cached(name) {
  const file = join(CACHE, `${name}.json`);
  if (REFRESH || !existsSync(file)) {
    console.log(`downloading ${name}`);
    const res = await fetch(SOURCES[name]);
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  return JSON.parse(readFileSync(file, 'utf8'));
}

const SMALL_WORDS = new Set(['and', 'of', 'the', 'de', 'del', 'la', 'las', 'los', 'el']);
const titleCase = (s) =>
  s
    .toLowerCase()
    .split(/(\s+|-|\/)/)
    .map((w, i) => (i > 0 && SMALL_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join('');

/** "SAN JOAQUIN VALLEY - KAWEAH" -> "Kaweah subbasin · San Joaquin Valley"; whole basins -> "Cuyama Valley basin". */
function basinLabel(basin, subbasin) {
  const [parent, ...rest] = subbasin.split(' - ');
  if (rest.length === 0) return `${titleCase(basin)} basin`;
  return `${titleCase(rest.join(' - '))} subbasin · ${titleCase(parent)}`;
}

/**
 * Town and utility systems. Cities annex farmland, so the smallest agency around a field is often the city even though
 * an irrigation district actually serves it; flagged ones rank after agricultural agencies in the popup.
 */
const MUNICIPAL =
  /\b(city|town|village|community services?|county service area|csa|public utility|mutual water|water company|water co|water works|waterworks|mobile home|trailer|park|estates|school|cemetery|water system)\b/i;
/** Farm agencies named after a town ("Raisin City Water District") are still farm agencies. */
const AGRICULTURAL = /\b(irrigation|water storage|reclamation|water district|municipal utility district)\b/i;
const isMunicipal = (name) => MUNICIPAL.test(name) && !AGRICULTURAL.test(name);

/** "Shafter City Of" -> "City of Shafter"; collapses the stray double spaces in the source names. */
const agencyName = (raw) => {
  const name = raw.trim().replace(/\s+/g, ' ');
  const flipped = /^(.*?),? (City|Town) [Oo]f$/.exec(name);
  return flipped ? `${flipped[2]} of ${flipped[1]}` : name;
};

mkdirSync(CACHE, { recursive: true });
const [districts, basins, overdraft] = await Promise.all(Object.keys(SOURCES).map(cached));

const critical = new Set(overdraft.features.map(({ attributes: a }) => a.Basin_Subbasin_Number));

const districtLayer = {
  type: 'FeatureCollection',
  features: districts.features
    .filter((f) => f.geometry && f.properties.AGENCYNAME?.trim())
    .map((f) => {
      const name = agencyName(f.properties.AGENCYNAME);
      return { type: 'Feature', geometry: f.geometry, properties: isMunicipal(name) ? { n: name, u: 1 } : { n: name } };
    }),
};
const basinLayer = {
  type: 'FeatureCollection',
  features: basins.features
    .filter((f) => f.geometry)
    .map((f) => {
      const id = f.properties.Basin_Subbasin_Number;
      const props = { n: basinLabel(f.properties.Basin_Name, f.properties.Basin_Subbasin_Name) };
      if (critical.has(id)) props.c = 1;
      return { type: 'Feature', geometry: f.geometry, properties: props };
    }),
};

const output = await mapshaper.applyCommands(
  [
    '-i districts.json basins.json combine-files',
    `-filter "this.area > ${MIN_DISTRICT_M2}" target=districts`,
    `-simplify interval=${SIMPLIFY_METRES} keep-shapes target=*`,
    '-o water.json format=topojson quantization=15000 target=*',
  ].join(' '),
  { 'districts.json': districtLayer, 'basins.json': basinLayer },
);
writeFileSync(OUT, output['water.json']);
console.log(
  `wrote ${OUT}: ${districtLayer.features.length} districts, ${basinLayer.features.length} basins, ` +
    `${(output['water.json'].length / 1024).toFixed(0)} KB`,
);
