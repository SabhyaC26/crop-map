import type {
  ExpressionSpecification,
  GeoJSONFeature,
  LayerSpecification,
  Map as MapLibreMap,
  PointLike,
} from 'maplibre-gl';
import { FIELDS_URL } from '../config';
import type { CropIndex } from '../data/crops';
import { darken, mix } from '../lib/color';
import { iconImageId } from '../lib/icons';
import { FIELDS_BEFORE_LAYER_ID } from '../style/basemap';

export const FIELDS_SOURCE = 'fields';
export const FIELDS_LAYER = 'fields';
export const FIELD_POINTS_LAYER = 'field_points';

export const FIELD_FILL_LAYER_ID = 'fields-fill';
export const FIELD_OUTLINE_LAYER_ID = 'fields-outline';
export const FIELD_GLOW_LAYER_ID = 'fields-glow';
export const FIELD_SELECTED_GLOW_LAYER_ID = 'fields-selected-glow';
export const FIELD_SELECTED_LAYER_ID = 'fields-selected';
export const FIELD_ICONS_LAYER_ID = 'field-icons';

/** Fields are only interactive once their fill is clearly visible. */
const INTERACTIVE_MIN_ZOOM = 10.2;
const FILL_OPACITY = 0.8;
const OUTLINE_DARKEN = 0.25;
const HOVER_WHITE_MIX = 0.2;
const HOVER_GLOW_WHITE_MIX = 0.7;
const HOVER_EXTRA_OPACITY = 0.16;
const DEFAULT_DIM = 0.2;
const FALLBACK_COLOR = '#d8d3c4';
const FALLBACK_ICON = 'icon-seedling';

export interface FieldHit {
  /** Numeric feature id (tiles were built with --generate-ids). */
  id: number;
  cropId: number;
  other: string | undefined;
  acres: number;
  county: string;
}

export interface FieldsLayer {
  readonly layerIds: readonly string[];
  /** Brightens fields of the given crops; every other field fades to `dimOpacity` x. `null` clears. */
  setEmphasis(cropIds: readonly number[] | null, dimOpacity?: number): void;
  setSelected(id: number | null): void;
  queryAt(point: PointLike): FieldHit | null;
  isInteractive(): boolean;
}

const zoomCurve = (...stops: [number, unknown][]): ExpressionSpecification =>
  ['interpolate', ['linear'], ['zoom'], ...stops.flat()] as ExpressionSpecification;

const featureFlag = (key: 'hover' | 'selected'): ExpressionSpecification => [
  'boolean',
  ['feature-state', key],
  false,
];

const LIT: ExpressionSpecification = ['any', featureFlag('hover'), featureFlag('selected')];

function cropMatch(crops: CropIndex, value: (hex: string, icon: string) => string, fallback: string): ExpressionSpecification {
  if (crops.list.length === 0) return ['literal', fallback] as unknown as ExpressionSpecification;
  const pairs = crops.list.flatMap((c) => [c.cropId, value(c.color, c.icon)]);
  return ['match', ['get', 'crop_id'], ...pairs, fallback] as unknown as ExpressionSpecification;
}

/** Opacity for `base`, brightened when lit and dimmed when its crop is outside the emphasis set. */
function emphasisOpacity(base: number, ids: readonly number[] | null, dim: number): ExpressionSpecification | number {
  if (ids === null) return base;
  const inSet: ExpressionSpecification = ['in', ['get', 'crop_id'], ['literal', [...ids]]];
  return ['case', inSet, base, base * dim] as ExpressionSpecification;
}

function fillOpacity(ids: readonly number[] | null, dim: number): ExpressionSpecification {
  const lit = Math.min(0.96, FILL_OPACITY + HOVER_EXTRA_OPACITY);
  const at = (base: number): ExpressionSpecification =>
    ['case', LIT, lit, emphasisOpacity(base, ids, dim)] as ExpressionSpecification;
  return zoomCurve([9, 0], [10.5, at(FILL_OPACITY)], [14, at(FILL_OPACITY)], [16, at(0.7)]);
}

function outlineOpacity(ids: readonly number[] | null, dim: number): ExpressionSpecification {
  return zoomCurve([9.6, 0], [10.6, emphasisOpacity(0.45, ids, dim)], [13.5, emphasisOpacity(0.85, ids, dim)]);
}

function iconOpacity(ids: readonly number[] | null, dim: number): ExpressionSpecification {
  return zoomCurve([12.6, 0], [13.4, emphasisOpacity(1, ids, dim)]);
}

function buildLayers(crops: CropIndex): LayerSpecification[] {
  const base = cropMatch(crops, (hex) => hex, FALLBACK_COLOR);
  const bright = cropMatch(crops, (hex) => mix(hex, '#ffffff', HOVER_WHITE_MIX), FALLBACK_COLOR);
  const glow = cropMatch(crops, (hex) => mix(hex, '#ffffff', HOVER_GLOW_WHITE_MIX), '#ffffff');
  const outline = cropMatch(crops, (hex) => darken(hex, OUTLINE_DARKEN), '#a9a392');
  const iconMatch = cropMatch(crops, (_, icon) => iconImageId(icon), FALLBACK_ICON);

  return [
    {
      id: FIELD_FILL_LAYER_ID,
      type: 'fill',
      source: FIELDS_SOURCE,
      'source-layer': FIELDS_LAYER,
      minzoom: 9,
      paint: {
        'fill-color': ['case', LIT, bright, base] as ExpressionSpecification,
        'fill-opacity': fillOpacity(null, DEFAULT_DIM),
        'fill-antialias': true,
      },
    },
    {
      id: FIELD_GLOW_LAYER_ID,
      type: 'line',
      source: FIELDS_SOURCE,
      'source-layer': FIELDS_LAYER,
      minzoom: 10,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': glow,
        'line-width': zoomCurve([10, 6], [14, 16], [18, 26]),
        'line-blur': zoomCurve([10, 4], [14, 9], [18, 14]),
        'line-opacity': ['case', featureFlag('hover'), 0.95, 0] as ExpressionSpecification,
        'line-opacity-transition': { duration: 180, delay: 0 },
      },
    },
    {
      id: FIELD_OUTLINE_LAYER_ID,
      type: 'line',
      source: FIELDS_SOURCE,
      'source-layer': FIELDS_LAYER,
      minzoom: 9.5,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': outline,
        'line-width': zoomCurve([10, 0.3], [14, 1.6], [18, 2.6]),
        'line-opacity': outlineOpacity(null, DEFAULT_DIM),
      },
    },
    {
      id: FIELD_SELECTED_GLOW_LAYER_ID,
      type: 'line',
      source: FIELDS_SOURCE,
      'source-layer': FIELDS_LAYER,
      minzoom: 10,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': '#ffffff',
        'line-width': zoomCurve([10, 6], [14, 14], [18, 22]),
        'line-blur': zoomCurve([10, 4], [14, 8], [18, 12]),
        'line-offset': zoomCurve([10, -2], [14, -5], [18, -9]),
        'line-opacity': ['case', featureFlag('selected'), 0.95, 0] as ExpressionSpecification,
      },
    },
    {
      id: FIELD_SELECTED_LAYER_ID,
      type: 'line',
      source: FIELDS_SOURCE,
      'source-layer': FIELDS_LAYER,
      minzoom: 10,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': '#ffffff',
        'line-width': zoomCurve([10, 1.6], [14, 3], [18, 4.4]),
        'line-offset': zoomCurve([10, -0.8], [14, -1.5], [18, -2.2]),
        'line-opacity': ['case', featureFlag('selected'), 1, 0] as ExpressionSpecification,
      },
    },
    {
      id: FIELD_ICONS_LAYER_ID,
      type: 'symbol',
      source: FIELDS_SOURCE,
      'source-layer': FIELD_POINTS_LAYER,
      minzoom: 12,
      layout: {
        'icon-image': iconMatch,
        'icon-size': zoomCurve([13, 0.95], [14, 1.15], [16, 1.4], [18, 1.7]),
        'icon-allow-overlap': false,
        'icon-ignore-placement': false,
        'icon-padding': 6,
        'icon-anchor': 'center',
        'symbol-sort-key': ['-', 0, ['get', 'acres']] as ExpressionSpecification,
      },
      paint: {
        'icon-opacity': iconOpacity(null, DEFAULT_DIM),
      },
    },
  ];
}

const toHit = (f: GeoJSONFeature): FieldHit | null => {
  const props = f.properties as Record<string, unknown> | null;
  const id = typeof f.id === 'number' ? f.id : Number(f.id);
  if (!props || Number.isNaN(id)) return null;
  return {
    id,
    cropId: Number(props['crop_id']),
    other: typeof props['other'] === 'string' ? props['other'] : undefined,
    acres: Number(props['acres']),
    county: typeof props['county'] === 'string' ? props['county'] : '',
  };
};

export function addFieldsLayers(map: MapLibreMap, crops: CropIndex): FieldsLayer {
  const url = `pmtiles://${new URL(FIELDS_URL, `${window.location.origin}/`).href}`;
  map.addSource(FIELDS_SOURCE, { type: 'vector', url });

  const specs = buildLayers(crops);
  for (const spec of specs) map.addLayer(spec, FIELDS_BEFORE_LAYER_ID);

  const stateTarget = (id: number) => ({ source: FIELDS_SOURCE, sourceLayer: FIELDS_LAYER, id });
  const canvas = map.getCanvas();
  let hovered: number | null = null;
  let selected: number | null = null;

  const interactive = (): boolean => map.getZoom() >= INTERACTIVE_MIN_ZOOM;

  const queryAt = (point: PointLike): FieldHit | null => {
    if (!interactive()) return null;
    const feature = map.queryRenderedFeatures(point, { layers: [FIELD_FILL_LAYER_ID] })[0];
    return feature ? toHit(feature) : null;
  };

  const setHover = (id: number | null): void => {
    if (id === hovered) return;
    if (hovered !== null) map.setFeatureState(stateTarget(hovered), { hover: false });
    hovered = id;
    if (id !== null) map.setFeatureState(stateTarget(id), { hover: true });
    canvas.style.cursor = id === null ? '' : 'pointer';
  };

  map.on('mousemove', (e) => setHover(queryAt(e.point)?.id ?? null));
  canvas.addEventListener('mouseleave', () => setHover(null));
  map.on('zoomstart', () => {
    if (!interactive()) setHover(null);
  });

  return {
    layerIds: specs.map((s) => s.id),
    isInteractive: interactive,
    queryAt,
    setSelected(id) {
      if (selected === id) return;
      if (selected !== null) map.setFeatureState(stateTarget(selected), { selected: false });
      selected = id;
      if (id !== null) map.setFeatureState(stateTarget(id), { selected: true });
    },
    setEmphasis(cropIds, dimOpacity = DEFAULT_DIM) {
      map.setPaintProperty(FIELD_FILL_LAYER_ID, 'fill-opacity', fillOpacity(cropIds, dimOpacity));
      map.setPaintProperty(FIELD_OUTLINE_LAYER_ID, 'line-opacity', outlineOpacity(cropIds, dimOpacity));
      map.setPaintProperty(FIELD_ICONS_LAYER_ID, 'icon-opacity', iconOpacity(cropIds, dimOpacity));
    },
  };
}
