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
import { prefersReducedMotion } from '../lib/motion';
import { FIELDS_BEFORE_LAYER_ID } from '../style/basemap';
import { patternImageExpression, registerFieldPatterns, texturedCropIds } from './field-patterns';

export const FIELDS_SOURCE = 'fields';
/**
 * Second and third instances of the fields archive. Changing a layer filter (or a data-driven paint value) makes
 * MapLibre re-bucket every tile of that layer's source, so emphasis and hover filters live on their own sources
 * and the base source (every field in the state) is never rebuilt. Each only loads tiles while one of its layers is visible.
 */
const FOCUS_SOURCE = 'fields-focus';
const LIT_SOURCE = 'fields-lit';
export const FIELDS_LAYER = 'fields';
export const FIELD_POINTS_LAYER = 'field_points';

export const FIELD_FILL_LAYER_ID = 'fields-fill';
export const FIELD_TEXTURE_LAYER_ID = 'fields-texture';
export const FIELD_OUTLINE_LAYER_ID = 'fields-outline';
export const FIELD_GLOW_LAYER_ID = 'fields-glow';
export const FIELD_SELECTED_GLOW_LAYER_ID = 'fields-selected-glow';
export const FIELD_SELECTED_LAYER_ID = 'fields-selected';
export const FIELD_ICONS_LAYER_ID = 'field-icons';
const FIELD_VEIL_LAYER_ID = 'fields-veil';
const FOCUS_FILL_LAYER_ID = 'fields-focus-fill';
const FOCUS_TEXTURE_LAYER_ID = 'fields-focus-texture';
const FOCUS_OUTLINE_LAYER_ID = 'fields-focus-outline';
const FOCUS_ICONS_LAYER_ID = 'field-focus-icons';
const FOCUS_LAYER_IDS = [FOCUS_FILL_LAYER_ID, FOCUS_TEXTURE_LAYER_ID, FOCUS_OUTLINE_LAYER_ID, FOCUS_ICONS_LAYER_ID];
const LIT_LAYER_IDS = [FIELD_GLOW_LAYER_ID, FIELD_SELECTED_GLOW_LAYER_ID, FIELD_SELECTED_LAYER_ID];

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
/** Washes the base fields to roughly DEFAULT_DIM strength while a crop is emphasised; the focus layers sit above it. */
const VEIL_COLOR = '#eceff5';
const VEIL_OPACITY = 0.8;
const VEIL_FADE_MS = 300;
const NO_FIELD = -1;

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
  /** Brightens fields of the given crops and washes out every other field. `null` clears. */
  setEmphasis(cropIds: readonly number[] | null): void;
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

const cropsFilter = (ids: readonly number[]): ExpressionSpecification => ['in', ['get', 'crop_id'], ['literal', [...ids]]];
const idFilter = (id: number | null): ExpressionSpecification => ['==', ['id'], id ?? NO_FIELD];
const BADGE_FILTER: ExpressionSpecification = ['>=', ['get', 'acres'], MIN_BADGE_ACRES];

function cropMatch(crops: CropIndex, value: (hex: string, icon: string) => string, fallback: string): ExpressionSpecification {
  if (crops.list.length === 0) return ['literal', fallback] as unknown as ExpressionSpecification;
  const pairs = crops.list.flatMap((c) => [c.cropId, value(c.color, c.icon)]);
  return ['match', ['get', 'crop_id'], ...pairs, fallback] as unknown as ExpressionSpecification;
}

function fillOpacity(): ExpressionSpecification {
  const lit = Math.min(0.96, FILL_OPACITY + HOVER_EXTRA_OPACITY);
  const at = (base: number): ExpressionSpecification => ['case', LIT, lit, base] as ExpressionSpecification;
  return zoomCurve([9, 0], [10.5, at(0.78)], [12, at(FILL_OPACITY)], [14, at(FILL_OPACITY)], [16, at(0.75)]);
}

const OUTLINE_OPACITY = zoomCurve([9.6, 0], [10.6, 0.5], [12.5, 0.7]);

/** Zoom-only, so dimming the base badges is a plain repaint rather than a tile rebuild. */
const iconOpacity = (strength: number): ExpressionSpecification => zoomCurve([12.4, 0], [13, strength]);

function textureOpacity(): ExpressionSpecification {
  const at: ExpressionSpecification = ['case', LIT, TEXTURE_LIT_OPACITY, TEXTURE_OPACITY] as ExpressionSpecification;
  const [from, to] = TEXTURE_FADE_IN;
  return zoomCurve([from, 0], [to, at]);
}

const veilOpacity = (on: boolean): ExpressionSpecification | number => (on ? zoomCurve([9, 0], [10.5, VEIL_OPACITY]) : 0);

interface FieldPaint {
  fill: LayerSpecification;
  texture: LayerSpecification;
  outline: LayerSpecification;
  icons: LayerSpecification;
}

/** Fill, texture, outline and badge layers for one instance of the fields archive. */
function buildFieldPaint(crops: CropIndex, source: string, ids: Record<keyof FieldPaint, string>): FieldPaint {
  const base = cropMatch(crops, (hex) => hex, FALLBACK_COLOR);
  const bright = cropMatch(crops, (hex) => mix(hex, '#ffffff', HOVER_WHITE_MIX), FALLBACK_COLOR);
  return {
    fill: {
      id: ids.fill,
      type: 'fill',
      source,
      'source-layer': FIELDS_LAYER,
      minzoom: 9,
      paint: {
        'fill-color': ['case', LIT, bright, base] as ExpressionSpecification,
        'fill-opacity': fillOpacity(),
        'fill-antialias': true,
      },
    },
    texture: {
      id: ids.texture,
      type: 'fill',
      source,
      'source-layer': FIELDS_LAYER,
      minzoom: TEXTURE_FADE_IN[0],
      filter: ['in', ['get', 'crop_id'], ['literal', texturedCropIds(crops)]] as ExpressionSpecification,
      paint: {
        'fill-pattern': patternImageExpression(crops),
        'fill-opacity': textureOpacity(),
        'fill-antialias': false,
      },
    },
    outline: {
      id: ids.outline,
      type: 'line',
      source,
      'source-layer': FIELDS_LAYER,
      minzoom: 9.6,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': '#ffffff',
        'line-width': zoomCurve([10, 0.2], [14, 1.4], [18, 2.6]),
        'line-opacity': OUTLINE_OPACITY,
      },
    },
    icons: {
      id: ids.icons,
      type: 'symbol',
      source,
      'source-layer': FIELD_POINTS_LAYER,
      minzoom: 12.4,
      filter: BADGE_FILTER,
      layout: {
        'icon-image': cropMatch(crops, (_, icon) => iconImageId(icon), FALLBACK_ICON),
        'icon-size': zoomCurve([13, 1.05], [14.5, 1.36], [16, 1.55], [18, 1.9]),
        'icon-allow-overlap': false,
        'icon-ignore-placement': false,
        'icon-padding': 10,
        'icon-anchor': 'center',
        'symbol-sort-key': ['-', 0, ['get', 'acres']] as ExpressionSpecification,
      },
      paint: {
        'icon-opacity': iconOpacity(1),
      },
    },
  };
}

/** Hover glow and selection ring: each filtered to a single field id on the lit source. */
function buildLitLayers(crops: CropIndex): LayerSpecification[] {
  const glow = cropMatch(crops, (hex) => mix(hex, '#ffffff', HOVER_GLOW_WHITE_MIX), '#ffffff');
  const lit = { source: LIT_SOURCE, 'source-layer': FIELDS_LAYER, minzoom: 10, filter: idFilter(null) } as const;
  const hidden = { 'line-join': 'round', 'line-cap': 'round', visibility: 'none' } as const;
  return [
    {
      ...lit,
      id: FIELD_GLOW_LAYER_ID,
      type: 'line',
      layout: hidden,
      paint: {
        'line-color': glow,
        'line-width': zoomCurve([10, 6], [14, 16], [18, 26]),
        'line-blur': zoomCurve([10, 4], [14, 9], [18, 14]),
        'line-opacity': 0.95,
      },
    },
    {
      ...lit,
      id: FIELD_SELECTED_GLOW_LAYER_ID,
      type: 'line',
      layout: hidden,
      paint: {
        'line-color': '#ffffff',
        'line-width': zoomCurve([10, 6], [14, 14], [18, 22]),
        'line-blur': zoomCurve([10, 4], [14, 8], [18, 12]),
        'line-offset': zoomCurve([10, -2], [14, -5], [18, -9]),
        'line-opacity': 0.95,
      },
    },
    {
      ...lit,
      id: FIELD_SELECTED_LAYER_ID,
      type: 'line',
      layout: hidden,
      paint: {
        'line-color': '#ffffff',
        'line-width': zoomCurve([10, 1.6], [14, 3], [18, 4.4]),
        'line-offset': zoomCurve([10, -0.8], [14, -1.5], [18, -2.2]),
        'line-opacity': 1,
      },
    },
  ];
}

function buildLayers(crops: CropIndex): LayerSpecification[] {
  const base = buildFieldPaint(crops, FIELDS_SOURCE, {
    fill: FIELD_FILL_LAYER_ID,
    texture: FIELD_TEXTURE_LAYER_ID,
    outline: FIELD_OUTLINE_LAYER_ID,
    icons: FIELD_ICONS_LAYER_ID,
  });
  const focus = buildFieldPaint(crops, FOCUS_SOURCE, {
    fill: FOCUS_FILL_LAYER_ID,
    texture: FOCUS_TEXTURE_LAYER_ID,
    outline: FOCUS_OUTLINE_LAYER_ID,
    icons: FOCUS_ICONS_LAYER_ID,
  });
  const hide = (spec: LayerSpecification): LayerSpecification =>
    ({ ...spec, layout: { ...('layout' in spec ? spec.layout : {}), visibility: 'none' } }) as LayerSpecification;
  return [
    base.fill,
    base.texture,
    base.outline,
    {
      id: FIELD_VEIL_LAYER_ID,
      type: 'background',
      minzoom: 9,
      paint: {
        'background-color': VEIL_COLOR,
        'background-opacity': veilOpacity(false),
        'background-opacity-transition': { duration: prefersReducedMotion() ? 0 : VEIL_FADE_MS, delay: 0 },
      },
    },
    hide(focus.fill),
    hide(focus.texture),
    hide(focus.outline),
    ...buildLitLayers(crops),
    base.icons,
    // Above the base badges, so an emphasised crop's badge wins the collision over a washed-out neighbour.
    hide(focus.icons),
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
  for (const id of [FIELDS_SOURCE, FOCUS_SOURCE, LIT_SOURCE]) map.addSource(id, { type: 'vector', url });

  registerFieldPatterns(map, crops);
  const specs = buildLayers(crops);
  for (const spec of specs) map.addLayer(spec, FIELDS_BEFORE_LAYER_ID);

  const canvas = map.getCanvas();
  let hovered: number | null = null;
  let selected: number | null = null;
  let litShown = false;
  let focusTimer: number | undefined;

  /** The base fill and the focus fill both brighten a lit field. */
  const setFieldState = (id: number, state: { hover?: boolean; selected?: boolean }): void => {
    for (const source of [FIELDS_SOURCE, FOCUS_SOURCE]) map.setFeatureState({ source, sourceLayer: FIELDS_LAYER, id }, state);
  };

  const setVisible = (layerIds: readonly string[], visible: boolean): void => {
    for (const id of layerIds) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
  };

  /** Turned on at the first hover or click and left on, so its tiles are not dropped and refetched every time. */
  const showLit = (): void => {
    if (litShown) return;
    litShown = true;
    setVisible(LIT_LAYER_IDS, true);
  };

  const interactive = (): boolean => map.getZoom() >= INTERACTIVE_MIN_ZOOM;

  const queryAt = (point: PointLike): FieldHit | null => {
    if (!interactive()) return null;
    const feature = map.queryRenderedFeatures(point, { layers: [FIELD_FILL_LAYER_ID] })[0];
    return feature ? toHit(feature) : null;
  };

  const setHover = (id: number | null): void => {
    if (id === hovered) return;
    if (hovered !== null) setFieldState(hovered, { hover: false });
    hovered = id;
    if (id !== null) {
      setFieldState(id, { hover: true });
      showLit();
    }
    if (litShown) map.setFilter(FIELD_GLOW_LAYER_ID, idFilter(id));
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
  map.on('zoom', () => {
    if (!interactive()) setHover(null);
  });

  return {
    layerIds: specs.map((s) => s.id),
    isInteractive: interactive,
    queryAt,
    setSelected(id) {
      if (selected === id) return;
      if (selected !== null) setFieldState(selected, { selected: false });
      selected = id;
      if (id !== null) {
        setFieldState(id, { selected: true });
        showLit();
      }
      if (!litShown) return;
      map.setFilter(FIELD_SELECTED_GLOW_LAYER_ID, idFilter(id));
      map.setFilter(FIELD_SELECTED_LAYER_ID, idFilter(id));
    },
    setEmphasis(cropIds) {
      window.clearTimeout(focusTimer);
      const on = cropIds !== null && cropIds.length > 0;
      map.setPaintProperty(FIELD_VEIL_LAYER_ID, 'background-opacity', veilOpacity(on));
      map.setPaintProperty(FIELD_ICONS_LAYER_ID, 'icon-opacity', iconOpacity(on ? DEFAULT_DIM : 1));
      if (!on) {
        // Keep the focus layers up while the veil fades out, or the emphasised crop would blink under it.
        focusTimer = window.setTimeout(() => setVisible(FOCUS_LAYER_IDS, false), prefersReducedMotion() ? 0 : VEIL_FADE_MS);
        return;
      }
      const only = cropsFilter(cropIds);
      map.setFilter(FOCUS_FILL_LAYER_ID, only);
      map.setFilter(FOCUS_OUTLINE_LAYER_ID, only);
      map.setFilter(FOCUS_TEXTURE_LAYER_ID, ['all', ['in', ['get', 'crop_id'], ['literal', texturedCropIds(crops)]], only]);
      map.setFilter(FOCUS_ICONS_LAYER_ID, ['all', BADGE_FILTER, only]);
      setVisible(FOCUS_LAYER_IDS, true);
    },
  };
}
