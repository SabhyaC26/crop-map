import type {
  ExpressionSpecification,
  LayerSpecification,
  SkySpecification,
  StyleSpecification,
} from 'maplibre-gl';
import { LIGHT, layers, type Flavor } from '@protomaps/basemaps';
import { BASEMAP_URL, TERRAIN_TILES_URL } from '../config';

export const BASEMAP_SOURCE = 'basemap';
export const TERRAIN_SOURCE = 'terrain';
export const OCEAN_SOURCE = 'ocean-mask';
export const OUTSIDE_SOURCE = 'outside-ca';
export const STICKER_SOURCE = 'ca-sticker';
export const SHADOW_SOURCE = 'ca-shadow';
export const BANDS_SOURCE = 'ocean-bands';
export const WATERLINES_SOURCE = 'ocean-lines';

/** Later layers (fields) are inserted below this id so roads and labels stay on top. */
export const FIELDS_BEFORE_LAYER_ID = 'roads_tunnels_other_casing';

const OUTSIDE_VEIL_OPACITY = 1;
const LABEL_TRACKING = 0.03;
const LABEL_HALO = 1.4;

export const PALETTE = {
  cream: '#f7f3e1',
  mint: '#e4f4d6',
  parkSoft: '#c9eeb9',
  parkDeep: '#aee59e',
  waterDeep: '#4aaaf3',
  water: '#58b4f6',
  waterLight: '#74c9ff',
  shore: '#e3f6ff',
  roadCasing: '#e6dbc2',
  ink: '#4a4e7a',
  inkSoft: '#8b88b3',
  lavender: '#8f88b8',
  skyTop: '#a9d8ff',
  skyHorizon: '#e6f5ff',
} as const;

const FONT_REGULAR = 'Figtree SemiBold';
const FONT_BOLD = 'Figtree Bold';
const FONT_SOFT = 'Figtree Medium';

export const pastelFlavor: Flavor = {
  ...LIGHT,
  background: PALETTE.cream,
  earth: PALETTE.cream,
  park_a: '#d6f1c6',
  park_b: PALETTE.parkSoft,
  wood_a: '#c8ecb8',
  wood_b: PALETTE.parkDeep,
  scrub_a: '#eaf3cb',
  scrub_b: '#dfeeb9',
  glacier: '#ffffff',
  sand: '#faf0d4',
  beach: '#fbf1d3',
  hospital: '#f5e7e3',
  industrial: '#efe9dc',
  school: '#f3ecd9',
  pedestrian: '#f3eddc',
  aerodrome: '#eee9e1',
  runway: '#ffffff',
  zoo: '#c9ecb9',
  military: '#ece6d6',
  water: PALETTE.water,
  pier: '#f1e9d6',
  buildings: '#ebe2d0',

  tunnel_other_casing: '#efe7d6',
  tunnel_minor_casing: '#efe7d6',
  tunnel_link_casing: '#efe7d6',
  tunnel_major_casing: '#efe7d6',
  tunnel_highway_casing: '#efe7d6',
  tunnel_other: '#fbf8f0',
  tunnel_minor: '#fbf8f0',
  tunnel_link: '#fbf8f0',
  tunnel_major: '#fbf8f0',
  tunnel_highway: '#fbf8f0',

  minor_service_casing: PALETTE.roadCasing,
  minor_casing: PALETTE.roadCasing,
  link_casing: PALETTE.roadCasing,
  major_casing_late: PALETTE.roadCasing,
  highway_casing_late: '#e6d9bf',
  other: '#fffdf7',
  minor_service: '#ffffff',
  minor_a: '#ffffff',
  minor_b: '#ffffff',
  link: '#ffffff',
  major_casing_early: PALETTE.roadCasing,
  major: '#ffffff',
  highway_casing_early: '#e6d9bf',
  highway: '#ffffff',

  railway: '#c9c3dc',
  boundaries: '#b7aedb',

  bridges_other_casing: PALETTE.roadCasing,
  bridges_minor_casing: PALETTE.roadCasing,
  bridges_link_casing: PALETTE.roadCasing,
  bridges_major_casing: PALETTE.roadCasing,
  bridges_highway_casing: '#e6d9bf',
  bridges_other: '#ffffff',
  bridges_minor: '#ffffff',
  bridges_link: '#ffffff',
  bridges_major: '#ffffff',
  bridges_highway: '#ffffff',

  roads_label_minor: PALETTE.inkSoft,
  roads_label_minor_halo: '#ffffff',
  roads_label_major: PALETTE.inkSoft,
  roads_label_major_halo: '#ffffff',
  ocean_label: '#ffffff',
  subplace_label: PALETTE.inkSoft,
  subplace_label_halo: '#ffffff',
  city_label: PALETTE.ink,
  city_label_halo: '#ffffff',
  state_label: '#b4aed4',
  state_label_halo: '#fffaf0',
  country_label: '#b4aed4',

  regular: FONT_REGULAR,
  bold: FONT_BOLD,
  italic: FONT_SOFT,

  pois: undefined,
  landcover: {
    grassland: '#cdef9f',
    barren: '#fdecc6',
    urban_area: '#f0e6d8',
    farmland: '#c2ec96',
    glacier: '#ffffff',
    scrub: '#e5efbb',
    forest: '#a6e695',
  },
};

const DROPPED_LAYERS = new Set([
  'address_label',
  'water_waterway_label',
  'roads_oneway',
  'roads_labels_minor',
  'earth_label_islands',
  'roads_shields',
  'places_subplace',
  'places_country',
  'places_region',
  'pois',
  'buildings',
]);

const zoomStops = (...stops: [number, unknown][]): ExpressionSpecification =>
  ['interpolate', ['linear'], ['zoom'], ...stops.flat()] as ExpressionSpecification;

const OCEAN_COLOR = zoomStops([3, '#3282e4'], [6.5, '#3282e4'], [9, PALETTE.water], [13, PALETTE.waterLight]);

const rankSize = (rank: number, size: number): ExpressionSpecification => [
  'case',
  ['>=', ['get', 'population_rank'], rank],
  size,
  0,
];

// Neighbouring-state/Mexico towns that would compete with California at the overview zoom.
const OUTSIDE_CA_PLACES = [
  'Reno', 'Las Vegas', 'Mexicali', 'Tijuana', 'Eugene', 'Boise', 'Carson City', 'Phoenix', 'Salt Lake City',
  'Portland', 'Medford', 'Henderson', 'Ensenada', 'Tecate', 'Yuma', 'Klamath Falls', 'Bend', 'Salem', 'Corvallis',
  'Roseburg', 'Sparks', 'Lake Havasu City', 'Bullhead City', 'Kingman', 'Flagstaff', 'Tucson', 'Mesa',
  'Rosarito', 'San Luis Rio Colorado', 'Winnemucca', 'Elko', 'Coos Bay', 'Seattle', 'Spokane', 'Victoria', 'Vancouver', 'Tacoma', 'Olympia',
];

const outsideCaLabelOpacity = (inside: number): ExpressionSpecification =>
  ['case', ['in', ['get', 'name'], ['literal', OUTSIDE_CA_PLACES]], inside, 1] as ExpressionSpecification;

type LayerPatch = (layer: LayerSpecification) => void;

const paint = (layer: LayerSpecification, props: Record<string, unknown>): void => {
  layer.paint = { ...(layer.paint as object | undefined), ...props } as never;
};

const layout = (layer: LayerSpecification, props: Record<string, unknown>): void => {
  layer.layout = { ...(layer.layout as object | undefined), ...props } as never;
};

const PATCHES: Record<string, LayerPatch> = {
  landcover: (l) =>
    paint(l, { 'fill-opacity': zoomStops([4, 1], [6.5, 1], [8.5, 0]) }),

  landuse_park: (l) => paint(l, { 'fill-opacity': zoomStops([6, 0], [8.5, 0.9], [11, 1]) }),

  water: (l) =>
    paint(l, {
      'fill-color': OCEAN_COLOR,
    }),

  water_river: (l) =>
    paint(l, {
      'line-color': zoomStops([9, PALETTE.water], [13, PALETTE.waterLight]),
    }),

  boundaries_country: (l) =>
    paint(l, {
      'line-color': '#b3a9da',
      'line-width': zoomStops([3, 1], [8, 2]),
      'line-opacity': 0.85,
    }),

  boundaries: (l) =>
    paint(l, {
      'line-color': '#c9c1e6',
      'line-width': zoomStops([4, 0.6], [10, 1.4]),
      'line-opacity': 0.8,
    }),

  roads_rail: (l) => paint(l, { 'line-opacity': 0.35 }),

  roads_highway: (l) =>
    paint(l, {
      'line-width': zoomStops([5, 0], [6, 0.9], [9, 1.5], [12, 2.2], [15, 5], [18, 15]),
    }),

  water_label_ocean: (l) => {
    layout(l, {
      'text-size': zoomStops([3, 11], [10, 14]),
      'text-letter-spacing': 0.18,
    });
    paint(l, {
      'text-color': '#ffffff',
      'text-halo-color': '#3f9de8',
      'text-halo-width': 1.4,
      'text-opacity': 0.9,
    });
  },

  water_label_lakes: (l) => {
    layout(l, { 'text-size': zoomStops([6, 10], [12, 13]) });
    paint(l, {
      'text-color': '#ffffff',
      'text-halo-color': '#4aa8f0',
      'text-halo-width': 1.4,
    });
  },

  roads_labels_major: (l) => {
    l.minzoom = 10;
    Object.assign(l, { filter: ['==', ['get', 'kind'], 'highway'] });
    layout(l, { 'text-size': 11, 'text-letter-spacing': LABEL_TRACKING });
    paint(l, { 'text-halo-width': LABEL_HALO, 'text-halo-blur': 0.5, 'text-color': PALETTE.lavender });
  },

  places_locality: (l) => {
    const layoutProps = l.layout as Record<string, unknown>;
    delete layoutProps['icon-image'];
    delete layoutProps['icon-size'];
    delete layoutProps['icon-padding'];
    delete layoutProps['text-radial-offset'];
    layout(l, {
      'text-variable-anchor': ['center'],
      'text-size': zoomStops(
        [4, rankSize(11, 12)],
        [6, rankSize(10, 14)],
        [8, rankSize(9, 15)],
        [10, rankSize(8, 17)],
        [13, rankSize(7, 19)],
        [16, rankSize(0, 22)],
      ),
      'text-max-width': 7,
      'text-letter-spacing': LABEL_TRACKING,
    });
    paint(l, {
      'text-halo-width': LABEL_HALO,
      'text-halo-blur': 0.5,
      'text-color': PALETTE.ink,
      'text-opacity': zoomStops([6, outsideCaLabelOpacity(0)], [8.5, 1]),
    });
  },
};

const buildShoreLayers = (): LayerSpecification[] => [
  {
    id: 'water_shore_glow',
    type: 'line',
    source: BASEMAP_SOURCE,
    'source-layer': 'water',
    filter: ['==', '$type', 'Polygon'],
    layout: { 'line-join': 'round' },
    paint: {
      'line-color': PALETTE.shore,
      'line-opacity': 0.75,
      'line-width': zoomStops([4, 3], [8, 5], [12, 8], [16, 14]),
      'line-blur': zoomStops([4, 3], [12, 6], [16, 10]),
    },
  },
  {
    id: 'water_shore_line',
    type: 'line',
    source: BASEMAP_SOURCE,
    'source-layer': 'water',
    filter: ['==', '$type', 'Polygon'],
    layout: { 'line-join': 'round' },
    paint: {
      'line-color': '#ffffff',
      'line-opacity': 0.85,
      'line-width': zoomStops([4, 0.6], [10, 1.2], [16, 2.4]),
      'line-blur': 0.4,
    },
  },
];

// Natural Earth ocean under the Protomaps water layer: keeps the Pacific blue where the CA extract has no tiles.
const buildOceanMask = (): LayerSpecification => ({
  id: 'ocean_mask',
  type: 'fill',
  source: OCEAN_SOURCE,
  paint: {
    'fill-color': OCEAN_COLOR,
    'fill-antialias': false,
    'fill-opacity': zoomStops([6, 1], [8, 0]),
  },
});

// Soft veil over everything that is not California so the state pops and the extract edge never shows.
const buildOutsideVeil = (): LayerSpecification => ({
  id: 'outside_ca_veil',
  type: 'fill',
  source: OUTSIDE_SOURCE,
  paint: {
    'fill-color': PALETTE.cream,
    'fill-antialias': false,
    'fill-opacity': OUTSIDE_VEIL_OPACITY,
  },
});


// Ocean depth bands (coast distance in degrees, from make-sticker-masks.py), widest/deepest first.
const BAND_DISTANCES = [5.0, 3.4, 2.3, 1.55, 1.1, 0.8, 0.58, 0.42, 0.3, 0.2, 0.12, 0.06] as const;
const BAND_GRADIENT = ['#3282e4', '#4ea6f3', '#7cd5f2', '#c9f7ee'] as const;

const hexToRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const gradientAt = (stops: readonly string[], t: number): string => {
  const x = Math.min(Math.max(t, 0), 1) * (stops.length - 1);
  const i = Math.min(Math.floor(x), stops.length - 2);
  const [r1, g1, b1] = hexToRgb(stops[i]!);
  const [r2, g2, b2] = hexToRgb(stops[i + 1]!);
  const f = x - i;
  const ch = (u: number, v: number): string => Math.round(u + (v - u) * f).toString(16).padStart(2, '0');
  return `#${ch(r1, r2)}${ch(g1, g2)}${ch(b1, b2)}`;
};

const OCEAN_BANDS: readonly [number, string][] = BAND_DISTANCES.map((d, i) => [
  d,
  gradientAt(BAND_GRADIENT, (i / (BAND_DISTANCES.length - 1)) ** 0.9),
]);

const STICKER_FADE = zoomStops([6.5, 1], [9, 0]);

const buildOceanBands = (): LayerSpecification[] => [
  ...OCEAN_BANDS.map(
    ([d, color]): LayerSpecification => ({
      id: `ocean_band_${d}`,
      type: 'fill',
      source: BANDS_SOURCE,
      filter: ['==', ['get', 'd'], d],
      paint: { 'fill-color': color, 'fill-antialias': false, 'fill-opacity': STICKER_FADE },
    }),
  ),
  {
    id: 'ocean_waterlines',
    type: 'line',
    source: WATERLINES_SOURCE,
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': '#ffffff',
      'line-opacity': zoomStops([6.5, 0.42], [9, 0]),
      'line-width': zoomStops([4, 0.8], [7, 1.4]),
      'line-blur': 0.4,
      'line-dasharray': [0.1, 2.2],
    },
  },
];

// Soft raised shadow (stacked offset rings with CA cut out) + glossy white die-cut edge.
const buildStickerLayers = (): LayerSpecification[] => [
  {
    id: 'ca_sticker_shadow',
    type: 'fill',
    source: SHADOW_SOURCE,
    paint: {
      'fill-color': '#2d3a8c',
      'fill-antialias': true,
      'fill-opacity': zoomStops([6.5, 0.062], [9, 0]),
    },
  },
  {
    id: 'ca_sticker_edge_soft',
    type: 'line',
    source: STICKER_SOURCE,
    layout: { 'line-join': 'round' },
    paint: {
      'line-color': '#ffffff',
      'line-opacity': zoomStops([6.5, 0.55], [9, 0]),
      'line-width': zoomStops([3, 9], [6, 13]),
      'line-offset': zoomStops([3, 4.5], [6, 6.5]),
      'line-blur': 5,
    },
  },
  {
    id: 'ca_sticker_edge',
    type: 'line',
    source: STICKER_SOURCE,
    layout: { 'line-join': 'round' },
    paint: {
      'line-color': '#ffffff',
      'line-opacity': zoomStops([6.5, 1], [9, 0]),
      'line-width': zoomStops([3, 4], [6, 6.5]),
      'line-offset': zoomStops([3, 2], [6, 3.25]),
      'line-blur': 0.5,
    },
  },
];

const buildHillshade = (): LayerSpecification => ({
  id: 'hillshade',
  type: 'hillshade',
  source: TERRAIN_SOURCE,
  paint: {
    'hillshade-method': 'standard',
    'hillshade-illumination-direction': 315,
    'hillshade-exaggeration': zoomStops([4, 0.62], [9, 0.5], [13, 0.34]),
    'hillshade-shadow-color': '#7468b4',
    'hillshade-highlight-color': '#fff1cf',
    'hillshade-accent-color': '#a79bd6',
  },
});

export const SKY: SkySpecification = {
  'sky-color': PALETTE.skyTop,
  'horizon-color': PALETTE.skyHorizon,
  'fog-color': '#ffffff',
  'sky-horizon-blend': 0.6,
  'horizon-fog-blend': 0.7,
  'fog-ground-blend': 0.2,
  'atmosphere-blend': zoomStops([0, 1], [5, 1], [7, 0]) as never,
};

export const buildBasemapLayers = (): LayerSpecification[] => {
  const base = layers(BASEMAP_SOURCE, pastelFlavor, { lang: 'en' }) as LayerSpecification[];
  const out: LayerSpecification[] = [];
  for (const layer of base) {
    if (DROPPED_LAYERS.has(layer.id)) continue;
    PATCHES[layer.id]?.(layer);
    if (layer.id === 'water_label_ocean') out.push(buildOutsideVeil(), ...buildStickerLayers());
    if (layer.id === 'roads_runway') out.push(buildHillshade(), buildOceanMask());
    out.push(layer);
    if (layer.id === 'water_river') out.push(...buildShoreLayers(), ...buildOceanBands());
  }
  return out;
};

export const buildBasemapStyle = (origin: string, baseUrl: string): StyleSpecification => ({
  version: 8,
  name: 'ca-crop-map-pastel',
  projection: { type: 'globe' },
  sky: SKY,
  glyphs: `${origin}${baseUrl}fonts/{fontstack}/{range}.pbf`,
  sources: {
    [BASEMAP_SOURCE]: {
      type: 'vector',
      url: `pmtiles://${new URL(BASEMAP_URL, origin + '/').href}`,
      attribution:
        '<a href="https://protomaps.com" target="_blank" rel="noopener">Protomaps</a> © <a href="https://openstreetmap.org" target="_blank" rel="noopener">OpenStreetMap</a>',
    },
    [OCEAN_SOURCE]: {
      type: 'geojson',
      data: `${origin}${baseUrl}data/ocean-mask.geojson`,
      tolerance: 0.5,
    },
    [OUTSIDE_SOURCE]: {
      type: 'geojson',
      data: `${origin}${baseUrl}data/outside-ca.geojson`,
      tolerance: 0.5,
    },
    [STICKER_SOURCE]: { type: 'geojson', data: `${origin}${baseUrl}data/ca-sticker.geojson`, tolerance: 0.1 },
    [SHADOW_SOURCE]: { type: 'geojson', data: `${origin}${baseUrl}data/ca-shadow.geojson`, tolerance: 0.2 },
    [BANDS_SOURCE]: { type: 'geojson', data: `${origin}${baseUrl}data/ocean-bands.geojson`, tolerance: 0.3 },
    [WATERLINES_SOURCE]: { type: 'geojson', data: `${origin}${baseUrl}data/ocean-lines.geojson`, tolerance: 0.3 },
    [TERRAIN_SOURCE]: {
      type: 'raster-dem',
      tiles: [TERRAIN_TILES_URL],
      encoding: 'terrarium',
      tileSize: 256,
      maxzoom: 13,
      attribution: 'Terrain: Mapzen / AWS',
    },
  },
  layers: buildBasemapLayers(),
});
