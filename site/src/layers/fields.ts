import type {
  ExpressionSpecification,
  GeoJSONFeature,
  LayerSpecification,
  Map as MapLibreMap,
  PointLike,
} from 'maplibre-gl';
import { FIELDS_URL } from '../config';
import type { CropIndex } from '../data/crops';
import { mix } from '../lib/color';
import { iconImageId } from '../lib/icons';
import { FIELDS_BEFORE_LAYER_ID } from '../style/basemap';
import { patternImageExpression, registerFieldPatterns, texturedCropIds } from './field-patterns';

export const FIELDS_SOURCE = 'fields';
export const FIELDS_LAYER = 'fields';
export const FIELD_POINTS_LAYER = 'field_points';

export const FIELD_FILL_LAYER_ID = 'fields-fill';
export const FIELD_TEXTURE_LAYER_ID = 'fields-texture';
export const FIELD_OUTLINE_LAYER_ID = 'fields-outline';
export const FIELD_GLOW_LAYER_ID = 'fields-glow';
export const FIELD_SELECTED_GLOW_LAYER_ID = 'fields-selected-glow';
export const FIELD_SELECTED_LAYER_ID = 'fields-selected';
export const FIELD_ICONS_LAYER_ID = 'field-icons';

/** Fields are only interactive once their fill is clearly visible. */
const INTERACTIVE_MIN_ZOOM = 10.2;
const FILL_OPACITY = 0.85;
const MIN_BADGE_ACRES = 20;
const HOVER_WHITE_MIX = 0.2;
const HOVER_GLOW_WHITE_MIX = 0.7;
const HOVER_EXTRA_OPACITY = 0.16;
const DEFAULT_DIM = 0.2;
const FALLBACK_COLOR = '#d8d3c4';
const FALLBACK_ICON = 'icon-seedling';

const TEXTURE_OPACITY = 0.82;
const TEXTURE_LIT_OPACITY = 0.4;
const TEXTURE_FADE_IN: readonly [number, number] = [11.5, 12.4];

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
  /**
   * Brightens fields of the given crops that also pass `condition` (e.g. a profit filter); every
   * other field fades to `dimOpacity` x. `null` for both clears.
   */
  setEmphasis(cropIds: readonly number[] | null, condition?: ExpressionSpecification | null, dimOpacity?: number): void;
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

type Emphasis = ExpressionSpecification | null;

/** Fields shown at full strength: in the crop set (if any) and passing the extra condition (if any). */
function emphasisCondition(ids: readonly number[] | null, condition: Emphasis): Emphasis {
  const parts: ExpressionSpecification[] = [];
  if (ids !== null) parts.push(['in', ['get', 'crop_id'], ['literal', [...ids]]]);
  if (condition) parts.push(condition);
  const [first] = parts;
  if (!first) return null;
  return parts.length === 1 ? first : (['all', ...parts] as ExpressionSpecification);
}

/** Opacity for `base`, dimmed for fields outside the emphasis condition. */
function emphasisOpacity(base: number, ids: Emphasis, dim: number): ExpressionSpecification | number {
  if (ids === null) return base;
  return ['case', ids, base, base * dim] as ExpressionSpecification;
}

function fillOpacity(ids: Emphasis, dim: number): ExpressionSpecification {
  const lit = Math.min(0.96, FILL_OPACITY + HOVER_EXTRA_OPACITY);
  const at = (base: number): ExpressionSpecification =>
    ['case', LIT, lit, emphasisOpacity(base, ids, dim)] as ExpressionSpecification;
  return zoomCurve([9, 0], [10.5, at(0.78)], [12, at(FILL_OPACITY)], [14, at(FILL_OPACITY)], [16, at(0.75)]);
}

function outlineOpacity(ids: Emphasis, dim: number): ExpressionSpecification {
  return zoomCurve([9.6, 0], [10.6, emphasisOpacity(0.5, ids, dim)], [12.5, emphasisOpacity(0.7, ids, dim)]);
}

function iconOpacity(ids: Emphasis, dim: number): ExpressionSpecification {
  return zoomCurve([12.4, 0], [13, emphasisOpacity(1, ids, dim)]);
}

function textureOpacity(ids: Emphasis, dim: number): ExpressionSpecification {
  const at: ExpressionSpecification = ['case', LIT, TEXTURE_LIT_OPACITY, emphasisOpacity(TEXTURE_OPACITY, ids, dim)] as ExpressionSpecification;
  const [from, to] = TEXTURE_FADE_IN;
  return zoomCurve([from, 0], [to, at]);
}

function buildLayers(crops: CropIndex): LayerSpecification[] {
  const base = cropMatch(crops, (hex) => hex, FALLBACK_COLOR);
  const bright = cropMatch(crops, (hex) => mix(hex, '#ffffff', HOVER_WHITE_MIX), FALLBACK_COLOR);
  const glow = cropMatch(crops, (hex) => mix(hex, '#ffffff', HOVER_GLOW_WHITE_MIX), '#ffffff');
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
      id: FIELD_TEXTURE_LAYER_ID,
      type: 'fill',
      source: FIELDS_SOURCE,
      'source-layer': FIELDS_LAYER,
      minzoom: TEXTURE_FADE_IN[0],
      filter: ['in', ['get', 'crop_id'], ['literal', texturedCropIds(crops)]] as ExpressionSpecification,
      paint: {
        'fill-pattern': patternImageExpression(crops),
        'fill-opacity': textureOpacity(null, DEFAULT_DIM),
        'fill-antialias': false,
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
        'line-color': '#ffffff',
        'line-width': zoomCurve([10, 0.2], [14, 1.4], [18, 2.6]),
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
      filter: ['>=', ['get', 'acres'], MIN_BADGE_ACRES],
      layout: {
        'icon-image': iconMatch,
        'icon-size': zoomCurve([13, 1.05], [14.5, 1.36], [16, 1.55], [18, 1.9]),
        'icon-allow-overlap': false,
        'icon-ignore-placement': false,
        'icon-padding': 10,
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

  registerFieldPatterns(map, crops);
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

  // Mice report faster than frames, and hover is meaningless mid-drag: hit-test at most once per frame, at rest.
  let hoverPoint: PointLike | null = null;
  let hoverFrame = 0;
  map.on('mousemove', (e) => {
    hoverPoint = e.point;
    hoverFrame ||= requestAnimationFrame(() => {
      hoverFrame = 0;
      if (hoverPoint && !map.isMoving()) setHover(queryAt(hoverPoint)?.id ?? null);
      hoverPoint = null;
    });
  });
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
    setEmphasis(cropIds, condition = null, dimOpacity = DEFAULT_DIM) {
      const shown = emphasisCondition(cropIds, condition);
      map.setPaintProperty(FIELD_FILL_LAYER_ID, 'fill-opacity', fillOpacity(shown, dimOpacity));
      map.setPaintProperty(FIELD_TEXTURE_LAYER_ID, 'fill-opacity', textureOpacity(shown, dimOpacity));
      map.setPaintProperty(FIELD_OUTLINE_LAYER_ID, 'line-opacity', outlineOpacity(shown, dimOpacity));
      map.setPaintProperty(FIELD_ICONS_LAYER_ID, 'icon-opacity', iconOpacity(shown, dimOpacity));
    },
  };
}
