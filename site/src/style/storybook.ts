import type {
  ExpressionSpecification,
  FilterSpecification,
  LayerSpecification,
  SourceSpecification,
} from 'maplibre-gl';

/**
 * "Storybook map": hand-placed geography labels, soft snow caps and a playful ocean
 * (wave marks, sparkles, drifting cloud shadows) for the whole-California overview.
 */

export const GEO_LABELS_SOURCE = 'geo-labels';
export const GEO_SNOW_SOURCE = 'geo-snow';
export const STORY_OCEAN_SOURCE = 'story-ocean';

const FONT_EXTRA_BOLD = ['Figtree ExtraBold'];
const FONT_SEMI_BOLD = ['Figtree SemiBold'];
const FONT_MEDIUM = ['Figtree Medium'];

const STORY_MIN_ZOOM = 3.4;
const STORY_MAX_ZOOM = 8.6;
/** Cities are hand-listed (not from vector tiles) so the six overview names show at every low zoom. */
export const OVERVIEW_CITIES = [
  'San Francisco',
  'Los Angeles',
  'San Diego',
  'Sacramento',
  'Fresno',
  'Bakersfield',
] as const;
const CITY_DOT_GAP_EM = 0.8;
const CITY_HALF_ADVANCE_EM = 0.33;

/** Phones sit below this zoom; line labels get a compact variant because anchors are sized by the largest size stop. */
const COMPACT_MAX_ZOOM = 4.6;
/** The overview city labels hand over to the stock locality layer here. */
export const OVERVIEW_CITY_MAX_ZOOM = 7;

/** Larger than any on-screen length of the short desert/range lines, so each name appears once. */
const LONG_SPACING = 1500;

const COLORS = {
  oceanText: '#f4faff',
  oceanHalo: '#3b95e6',
  mountainText: '#7a6693',
  mountainHalo: '#eef8e2',
  desertText: '#b07d3c',
  desertHalo: '#fff6dc',
  forestText: '#4e9a52',
  forestHalo: '#e9f8dc',
  stateText: '#d3cdea',
  lakeText: '#2f86dc',
  lakeHalo: '#ffffff',
  islandText: '#eaf5ff',
  cityText: '#5f5a92',
} as const;

export const storySources = (origin: string, baseUrl: string): Record<string, SourceSpecification> => ({
  [GEO_LABELS_SOURCE]: { type: 'geojson', data: `${origin}${baseUrl}data/geo-labels.geojson`, promoteId: 'name' },
  [GEO_SNOW_SOURCE]: { type: 'geojson', data: `${origin}${baseUrl}data/geo-snow.geojson` },
  [STORY_OCEAN_SOURCE]: { type: 'geojson', data: `${origin}${baseUrl}data/storybook-ocean.geojson` },
});

const zoomStops = (...stops: [number, unknown][]): ExpressionSpecification =>
  ['interpolate', ['linear'], ['zoom'], ...stops.flat()] as ExpressionSpecification;

/** Scales a data-driven multiplier by a zoom ramp (zoom expression must stay outermost). */
const scaled = (prop: string, ...stops: [number, number][]): ExpressionSpecification =>
  zoomStops(...stops.map(([z, v]): [number, unknown] => [z, ['*', ['get', prop], v]]));

/** Zoom ramp that holds `peak` through the overview and fades to nothing by `end`. */
const fadeOut = (peak: number, holdUntil: number, end: number): ExpressionSpecification =>
  zoomStops([STORY_MIN_ZOOM, peak], [holdUntil, peak], [end, 0]);

/** Labels carry a `hidden` feature-state so markers can take over a spot without a style reload. */
const labelOpacity = (peak: number): ExpressionSpecification => {
  const shown = (v: number): ExpressionSpecification =>
    ['case', ['boolean', ['feature-state', 'hidden'], false], 0, v] as ExpressionSpecification;
  return zoomStops([STORY_MIN_ZOOM, 0], [3.8, shown(peak)], [7.3, shown(peak)], [8.4, 0]);
};

const byKind = (...kinds: string[]): FilterSpecification => ['in', ['get', 'kind'], ['literal', kinds]];
const isLine: FilterSpecification = ['==', ['geometry-type'], 'LineString'];
const isPoint: FilterSpecification = ['==', ['geometry-type'], 'Point'];
const view = (v: 'compact' | 'full'): FilterSpecification => ['!=', ['get', 'view'], v === 'compact' ? 'full' : 'compact'];

interface LabelStyle {
  id: string;
  kinds: string[];
  /** Hand-tuned subset of a kind, e.g. `small` desert names. */
  where?: FilterSpecification;
  placement: 'line' | 'point';
  font: string[];
  /** Line labels: [compact px, full px]. Point labels: zoom ramp. */
  size: [number, number] | ExpressionSpecification;
  /** Letter-spacing in em: [compact, full] or one value. */
  spacing: number | [number, number];
  color: string;
  halo: string;
  haloWidth: number;
  opacity: number;
  offset?: [number, number];
  allowOverlap?: boolean;
  maxZoom?: number;
  /** Static `text-anchor` (data-driven anchors blow up collision boxes). */
  anchor?: 'left' | 'right';
  /** Line labels: pixels between repeats. Short hand-placed lines would otherwise repeat their name when zoomed in. */
  symbolSpacing?: number;
  /** Point labels wrap at this many ems. */
  maxWidth?: number;
}

const pair = <T>(v: T | [T, T], i: 0 | 1): T => (Array.isArray(v) ? (v as [T, T])[i] : v);

const labelLayer = (
  s: LabelStyle,
  size: number | ExpressionSpecification,
  spacing: number,
  extra: Pick<LayerSpecification, 'id' | 'minzoom' | 'maxzoom'> & { filter: FilterSpecification },
): LayerSpecification => ({
  ...extra,
  type: 'symbol',
  source: GEO_LABELS_SOURCE,
  layout: {
    'symbol-placement': s.placement,
    ...(s.symbolSpacing ? { 'symbol-spacing': s.symbolSpacing } : {}),
    'symbol-sort-key': ['get', 'rank'],
    'text-field': ['get', 'name'],
    'text-font': s.font,
    'text-size': size,
    'text-letter-spacing': spacing,
    'text-padding': 4,
    'text-allow-overlap': s.allowOverlap ?? false,
    'text-pitch-alignment': 'viewport',
    'text-rotation-alignment': 'map',
    ...(s.placement === 'point'
      ? {
          'text-offset': s.offset ?? [0, 0],
          'text-max-width': s.maxWidth ?? 24,
          ...(s.anchor ? { 'text-anchor': s.anchor } : {}),
        }
      : {}),
  },
  paint: {
    'text-color': s.color,
    'text-halo-color': s.halo,
    'text-halo-width': s.haloWidth,
    'text-halo-blur': 1,
    'text-opacity': labelOpacity(s.opacity),
  },
} as LayerSpecification);

const buildLabel = (s: LabelStyle): LayerSpecification[] => {
  const base: FilterSpecification = [
    'all',
    s.placement === 'line' ? isLine : isPoint,
    byKind(...s.kinds),
    ...(s.where ? [s.where] : []),
  ] as FilterSpecification;
  if (s.placement === 'point') {
    return [
      labelLayer(s, s.size as ExpressionSpecification, pair(s.spacing, 1), {
        id: s.id,
        minzoom: STORY_MIN_ZOOM,
        maxzoom: s.maxZoom ?? STORY_MAX_ZOOM,
        filter: base,
      }),
    ];
  }
  const [compact, full] = s.size as [number, number];
  return [
    labelLayer(s, compact, pair(s.spacing, 0), {
      id: `${s.id}_compact`,
      minzoom: STORY_MIN_ZOOM,
      maxzoom: COMPACT_MAX_ZOOM,
      filter: ['all', base, view('compact')] as FilterSpecification,
    }),
    labelLayer(s, full, pair(s.spacing, 1), {
      id: s.id,
      minzoom: COMPACT_MAX_ZOOM,
      maxzoom: STORY_MAX_ZOOM,
      filter: ['all', base, view('full')] as FilterSpecification,
    }),
  ];
};


/** Hand-placed labels (and the six overview cities, which are listed by hand so they show at every low zoom) in ascending placement priority: MapLibre places the last layer first,
 * so Sierra and the cities win collisions against the quieter names.
 */
const LABEL_STYLES: LabelStyle[] = [
  {
    id: 'story_label_state',
    kinds: ['state'],
    placement: 'point',
    font: FONT_EXTRA_BOLD,
    size: zoomStops([3.4, 12], [5.2, 21], [7, 34]),
    spacing: 0.5,
    color: COLORS.stateText,
    halo: '#ffffff',
    haloWidth: 0,
    opacity: 0.8,
  },
  {
    id: 'story_label_ocean',
    kinds: ['ocean'],
    placement: 'line',
    font: FONT_SEMI_BOLD,
    size: [12.5, 31],
    spacing: [0.3, 0.6],
    color: COLORS.oceanText,
    halo: COLORS.oceanHalo,
    haloWidth: 1.6,
    opacity: 0.92,
  },
  {
    id: 'story_label_desert_small',
    kinds: ['desert_small'],
    placement: 'line',
    symbolSpacing: LONG_SPACING,
    font: FONT_SEMI_BOLD,
    size: [6.5, 10.5],
    spacing: 0.3,
    color: COLORS.desertText,
    halo: COLORS.desertHalo,
    haloWidth: 1.6,
    opacity: 0.85,
  },
  {
    id: 'story_label_desert_note',
    kinds: ['desert_note'],
    placement: 'point',
    font: FONT_SEMI_BOLD,
    size: zoomStops([3.4, 6.5], [5.4, 10.5], [7, 18]),
    spacing: 0.3,
    color: COLORS.desertText,
    halo: COLORS.desertHalo,
    haloWidth: 1.6,
    opacity: 0.85,
  },
  {
    id: 'story_label_desert',
    kinds: ['desert'],
    placement: 'line',
    symbolSpacing: LONG_SPACING,
    font: FONT_EXTRA_BOLD,
    size: [8.5, 14.5],
    spacing: 0.3,
    color: COLORS.desertText,
    halo: COLORS.desertHalo,
    haloWidth: 1.8,
    opacity: 0.95,
  },
  {
    id: 'story_label_forest',
    kinds: ['forest'],
    placement: 'point',
    font: FONT_SEMI_BOLD,
    size: zoomStops([3.4, 6.5], [5.4, 10.5], [7, 17]),
    spacing: 0.3,
    color: COLORS.forestText,
    halo: COLORS.forestHalo,
    haloWidth: 1.5,
    opacity: 0.85,
  },
  {
    id: 'story_label_lake',
    kinds: ['lake'],
    placement: 'point',
    font: FONT_MEDIUM,
    size: zoomStops([3.4, 7], [5.4, 10.5], [7, 15]),
    spacing: 0.22,
    color: COLORS.lakeText,
    halo: COLORS.lakeHalo,
    haloWidth: 1.4,
    opacity: 0.95,
    offset: [4.6, 0.1],
  },
  {
    id: 'story_label_island',
    kinds: ['island'],
    placement: 'point',
    font: FONT_MEDIUM,
    size: zoomStops([3.4, 7], [5.4, 10.5], [7, 15]),
    spacing: 0.3,
    color: COLORS.islandText,
    halo: COLORS.oceanHalo,
    haloWidth: 1.4,
    opacity: 0.95,
  },
  {
    id: 'story_label_peak',
    kinds: ['peak'],
    placement: 'point',
    font: FONT_SEMI_BOLD,
    size: zoomStops([3.4, 7], [5.4, 10.5], [7, 16]),
    spacing: 0.2,
    color: COLORS.mountainText,
    halo: '#ffffff',
    haloWidth: 1.6,
    opacity: 0.95,
    offset: [0, 1],
  },
  {
    id: 'story_label_range',
    kinds: ['range'],
    placement: 'line',
    symbolSpacing: LONG_SPACING,
    font: FONT_EXTRA_BOLD,
    size: [8, 12.5],
    spacing: 0.3,
    color: COLORS.mountainText,
    halo: COLORS.mountainHalo,
    haloWidth: 1.7,
    opacity: 0.92,
  },
  {
    id: 'story_label_range_note',
    kinds: ['range_note'],
    placement: 'point',
    font: FONT_EXTRA_BOLD,
    size: zoomStops([3.4, 8], [5.4, 12.5], [7, 21]),
    spacing: 0.3,
    maxWidth: 4.5,
    color: COLORS.mountainText,
    halo: COLORS.mountainHalo,
    haloWidth: 1.7,
    opacity: 0.92,
  },
  {
    id: 'story_label_mountain',
    kinds: ['mountain'],
    placement: 'line',
    font: FONT_EXTRA_BOLD,
    size: [9.5, 17.5],
    spacing: [0.26, 0.3],
    color: COLORS.mountainText,
    halo: COLORS.mountainHalo,
    haloWidth: 1.8,
    opacity: 0.95,
  },
  ...OVERVIEW_CITIES.map(
    (city): LabelStyle => ({
      id: `story_label_city_${city.toLowerCase().replace(/ /g, '_')}`,
      kinds: ['city'],
      where: ['==', ['get', 'name'], city],
      placement: 'point',
      font: FONT_SEMI_BOLD,
      size: zoomStops([3.4, 10], [5.5, 12], [7, 14]),
      spacing: 0.06,
      color: COLORS.cityText,
      halo: '#ffffff',
      haloWidth: 1.5,
      opacity: 0.92,
      allowOverlap: true,
      maxZoom: OVERVIEW_CITY_MAX_ZOOM,
      // Labels sit west of their dot, centre-anchored with a hand-computed shift (leaves the Sierra/valley clear).
      offset: [-(CITY_DOT_GAP_EM + city.length * CITY_HALF_ADVANCE_EM), 0],
    }),
  ),
];

const buildCityDots = (): LayerSpecification => ({
  id: 'story_city_dot',
  type: 'circle',
  source: GEO_LABELS_SOURCE,
  maxzoom: OVERVIEW_CITY_MAX_ZOOM,
  filter: byKind('city'),
  paint: {
    'circle-color': '#ffffff',
    'circle-radius': zoomStops([3.4, 2], [5.5, 3], [7, 3.6]),
    'circle-stroke-color': COLORS.cityText,
    'circle-stroke-width': 1.4,
    'circle-pitch-alignment': 'viewport',
  },
});

/** Point labels (names that sit at one spot) can be hidden under a marker; the long curved line labels are placed by hand instead. */
export const GEO_POINT_LABEL_LAYER_IDS: readonly string[] = LABEL_STYLES.filter((s) => s.placement === 'point').map((s) => s.id);

export const buildGeoLabelLayers = (): LayerSpecification[] => [
  ...LABEL_STYLES.flatMap(buildLabel),
  buildCityDots(),
];

/** Soft snow caps painted just above the hillshade. */
export const buildSnowLayers = (terrainSource: string): LayerSpecification[] => {
  return [
    {
      id: 'story_snow_relief',
      type: 'color-relief',
      source: terrainSource,
      paint: {
        // Elevation-derived snow line: soft white from ~2.1 km, near-full cap above ~3.3 km.
        'color-relief-color': [
          'interpolate',
          ['linear'],
          ['elevation'],
          2100,
          'rgba(255, 255, 255, 0)',
          2700,
          'rgba(255, 255, 255, 0.42)',
          3300,
          'rgba(255, 255, 255, 0.82)',
          4000,
          'rgba(255, 255, 255, 0.96)',
        ],
        'color-relief-opacity': fadeOut(1, 7.5, 9.5),
      },
    },
    {
      id: 'story_snow_peak_halo',
      type: 'circle',
      source: GEO_SNOW_SOURCE,
      filter: byKind('snowpeak'),
      paint: {
        'circle-color': '#ffffff',
        'circle-radius': scaled('w', [4, 6], [6, 14], [8, 30], [10, 56]),
        'circle-blur': 1,
        'circle-opacity': fadeOut(0.7, 7.5, 9.5),
        'circle-pitch-alignment': 'map',
        'circle-pitch-scale': 'map',
      },
    },
    {
      id: 'story_snow_peak_core',
      type: 'circle',
      source: GEO_SNOW_SOURCE,
      filter: byKind('snowpeak'),
      paint: {
        'circle-color': '#ffffff',
        'circle-radius': scaled('w', [4, 2.4], [6, 5.5], [8, 12], [10, 22]),
        'circle-blur': 0.55,
        'circle-opacity': fadeOut(0.95, 7.5, 9.5),
        'circle-pitch-alignment': 'map',
        'circle-pitch-scale': 'map',
      },
    },
  ];
};

/** Quiet wave marks and a few sparkles on the open Pacific (static: animated paint props keep the map from ever going idle). */
export const buildOceanDecorLayers = (): LayerSpecification[] => [
  {
    id: 'story_wave',
    type: 'line',
    source: STORY_OCEAN_SOURCE,
    filter: byKind('wave'),
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#ffffff',
      'line-width': zoomStops([4, 1], [6, 1.5], [8, 2.2]),
      'line-opacity': fadeOut(0.3, 7, 8.4),
    },
  },
  {
    id: 'story_sparkle',
    type: 'circle',
    source: STORY_OCEAN_SOURCE,
    filter: byKind('sparkle'),
    paint: {
      'circle-color': '#ffffff',
      'circle-radius': scaled('r', [4, 1.2], [6, 2], [8, 3]),
      'circle-blur': 0.35,
      'circle-opacity': fadeOut(0.5, 7, 8.4),
      'circle-pitch-alignment': 'map',
      'circle-pitch-scale': 'map',
    },
  },
];
