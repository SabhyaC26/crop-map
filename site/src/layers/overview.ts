import type { ExpressionSpecification, FilterSpecification, LayerSpecification, Map as MapLibreMap } from 'maplibre-gl';
import { FIELDS_LOW_URL, OVERVIEW_URL } from '../config';
import type { CropIndex } from '../data/crops';
import { saturate } from '../lib/color';
import { prefersReducedMotion } from '../lib/motion';
import { FIELDS_BEFORE_LAYER_ID, OCEAN_GRADIENT_LAYER_ID } from '../style/basemap';

export const OVERVIEW_SOURCE = 'overview';
export const OVERVIEW_LAYER = 'overview';
export const OVERVIEW_DOTS_LAYER_ID = 'overview-dots';
export const FIELDS_LOW_SOURCE = 'fields-low';
export const FIELDS_LOW_LAYER = 'fields_low';
export const FIELDS_LOW_FILL_LAYER_ID = 'fields-low-fill';
export const FIELDS_LOW_LINE_LAYER_ID = 'fields-low-line';
/** Soft white-grey wash over the whole map, below the highlighted crop (and, at z9+, below the fields). */
export const DIM_VEIL_LAYER_ID = 'dim_veil';
const HILLSHADE_LAYER_ID = 'hillshade';

export interface OverviewLayer {
  /** Fills only the given crops' farmland in their normal colour and dulls everything else; `null` restores. */
  setHighlight(cropIds: readonly number[] | null): void;
  destroy(): void;
}

const FADE_MS = 360;
const VEIL_COLOR = '#eceff5';
const VEIL_OPACITY = 0.72;
const VEIL_FADE_MS = 400;
/** The baked ocean raster loses colour (and gains a floor of light) while a crop is selected. */
const OCEAN_DIM = { saturation: -0.8, brightnessMin: 0.42 } as const;
const HILLSHADE_NEUTRAL = {
  'hillshade-shadow-color': '#8b8da3',
  'hillshade-highlight-color': '#f5f5f8',
  'hillshade-accent-color': '#aeb0c2',
} as const;
const NO_CROP = -1;

const FALLBACK_COLOR = '#d8d3c4';
/** Pastels read washed-out from far away; push saturation so the quilt survives the zoomed-out view. */
const SATURATION_BOOST = 0.22;
/** The selected crop keeps its field colour, nudged a little richer so thin farm shapes hold up at state zoom. */
const HIGHLIGHT_SATURATION = 0.25;

const zoomCurve = (...stops: [number, unknown][]): ExpressionSpecification =>
  ['interpolate', ['linear'], ['zoom'], ...stops.flat()] as ExpressionSpecification;

const scaled = (gain: number, ...stops: [number, number][]): ExpressionSpecification =>
  zoomCurve(...stops.map(([z, v]): [number, number] => [z, +(v * gain).toFixed(4)]));

const DOT_OPACITY: [number, number][] = [[4, 0.7], [9.5, 0.75], [10.8, 0]];
/** The low-zoom silhouettes hand off to the real field polygons, which fade in from z9 to z10.5. */
const LOW_FILL_OPACITY: [number, number][] = [[4, 0.92], [9, 0.92], [10.2, 0]];
const LOW_LINE_OPACITY: [number, number][] = [[4, 0.9], [9, 0.6], [10.2, 0]];

const fade = (ms: number): { duration: number; delay: number } => ({ duration: prefersReducedMotion() ? 0 : ms, delay: 0 });

const noMatch = (): FilterSpecification => ['==', ['get', 'crop_id'], NO_CROP];

const cropsFilter = (ids: readonly number[]): FilterSpecification => ['in', ['get', 'crop_id'], ['literal', [...ids]]];

function cropColor(crops: CropIndex, tint: (hex: string) => string): ExpressionSpecification {
  if (crops.list.length === 0) return ['literal', FALLBACK_COLOR] as unknown as ExpressionSpecification;
  const pairs = crops.list.flatMap((c) => [c.cropId, tint(c.color)]);
  return ['match', ['get', 'crop_id'], ...pairs, FALLBACK_COLOR] as unknown as ExpressionSpecification;
}

/** Rangeland-like crops (pasture, grasses, "other") are drab grey-greens that turn the hills muddy; the confetti is for farmland. */
const MUTED_CROP_IDS = [6, 13, 14, 21, 51, 53];
const FARMLAND_ONLY: ExpressionSpecification = ['!', ['in', ['get', 'crop_id'], ['literal', MUTED_CROP_IDS]]];

/** Dot-density "confetti": one soft dot per ~60 acres, tinted by crop, handing off to the field polygons at z9-10.5. */
function buildQuilt(crops: CropIndex): LayerSpecification {
  return {
    id: OVERVIEW_DOTS_LAYER_ID,
    type: 'circle',
    source: OVERVIEW_SOURCE,
    'source-layer': OVERVIEW_LAYER,
    maxzoom: 11,
    filter: FARMLAND_ONLY,
    paint: {
      'circle-color': cropColor(crops, (hex) => saturate(hex, SATURATION_BOOST)),
      'circle-radius': zoomCurve([4, 2.1], [5, 2.3], [6, 2.6], [8, 3.3], [10, 4.4]),
      'circle-blur': 0.4,
      'circle-opacity': scaled(1, ...DOT_OPACITY),
      'circle-opacity-transition': fade(FADE_MS),
      'circle-pitch-alignment': 'map',
    },
  };
}

/** The selected crop's real farmland at z5-10 in its normal field colour (hidden until a crop is selected). */
function buildHighlight(crops: CropIndex): LayerSpecification[] {
  const color = cropColor(crops, (hex) => saturate(hex, HIGHLIGHT_SATURATION));
  return [
    {
      id: FIELDS_LOW_FILL_LAYER_ID,
      type: 'fill',
      source: FIELDS_LOW_SOURCE,
      'source-layer': FIELDS_LOW_LAYER,
      maxzoom: 10.5,
      filter: noMatch(),
      paint: {
        'fill-color': color,
        'fill-opacity': scaled(0, ...LOW_FILL_OPACITY),
        'fill-opacity-transition': fade(FADE_MS),
        'fill-antialias': true,
      },
    },
    {
      // A hairline in the same colour keeps small, scattered farms visible at state zoom.
      id: FIELDS_LOW_LINE_LAYER_ID,
      type: 'line',
      source: FIELDS_LOW_SOURCE,
      'source-layer': FIELDS_LOW_LAYER,
      maxzoom: 10.5,
      filter: noMatch(),
      layout: { 'line-join': 'round' },
      paint: {
        'line-color': color,
        'line-width': zoomCurve([5, 2.6], [7, 1.8], [9, 0.8], [10, 0.4]),
        'line-opacity': scaled(0, ...LOW_LINE_OPACITY),
        'line-opacity-transition': fade(FADE_MS),
      },
    },
  ];
}

export function addOverviewLayers(map: MapLibreMap, crops: CropIndex): OverviewLayer {
  const origin = `${window.location.origin}/`;
  map.addSource(OVERVIEW_SOURCE, { type: 'vector', url: `pmtiles://${new URL(OVERVIEW_URL, origin).href}` });
  map.addSource(FIELDS_LOW_SOURCE, { type: 'vector', url: `pmtiles://${new URL(FIELDS_LOW_URL, origin).href}` });
  // Confetti sits under the ocean raster so dots near the coast never spill onto the water.
  map.addLayer(buildQuilt(crops), OCEAN_GRADIENT_LAYER_ID);
  // Veil and highlight sit above every land, terrain and ocean layer but below roads, labels and the field
  // layers (added later at the same insertion point), so the selected crop is the only colour left.
  map.addLayer(
    {
      id: DIM_VEIL_LAYER_ID,
      type: 'background',
      paint: {
        'background-color': VEIL_COLOR,
        'background-opacity': 0,
        'background-opacity-transition': fade(VEIL_FADE_MS),
      },
    },
    FIELDS_BEFORE_LAYER_ID,
  );
  for (const spec of buildHighlight(crops)) map.addLayer(spec, FIELDS_BEFORE_LAYER_ID);

  const transition = fade(VEIL_FADE_MS);
  for (const prop of ['raster-saturation-transition', 'raster-brightness-min-transition']) {
    map.setPaintProperty(OCEAN_GRADIENT_LAYER_ID, prop, transition);
  }
  for (const prop of Object.keys(HILLSHADE_NEUTRAL)) map.setPaintProperty(HILLSHADE_LAYER_ID, `${prop}-transition`, transition);
  const hillshadeBase = Object.fromEntries(Object.keys(HILLSHADE_NEUTRAL).map((prop) => [prop, map.getPaintProperty(HILLSHADE_LAYER_ID, prop)]));

  let clearTimer: number | undefined;

  /** Fades the world wash in or out: veil, ocean raster colour, hillshade tint. */
  const wash = (on: boolean): void => {
    map.setPaintProperty(DIM_VEIL_LAYER_ID, 'background-opacity', on ? VEIL_OPACITY : 0);
    map.setPaintProperty(OCEAN_GRADIENT_LAYER_ID, 'raster-saturation', on ? OCEAN_DIM.saturation : 0);
    map.setPaintProperty(OCEAN_GRADIENT_LAYER_ID, 'raster-brightness-min', on ? OCEAN_DIM.brightnessMin : 0);
    for (const [prop, neutral] of Object.entries(HILLSHADE_NEUTRAL)) {
      map.setPaintProperty(HILLSHADE_LAYER_ID, prop, on ? neutral : hillshadeBase[prop]);
    }
  };

  const paint = (lit: boolean): void => {
    map.setPaintProperty(OVERVIEW_DOTS_LAYER_ID, 'circle-opacity', scaled(lit ? 0 : 1, ...DOT_OPACITY));
    map.setPaintProperty(FIELDS_LOW_FILL_LAYER_ID, 'fill-opacity', scaled(lit ? 1 : 0, ...LOW_FILL_OPACITY));
    map.setPaintProperty(FIELDS_LOW_LINE_LAYER_ID, 'line-opacity', scaled(lit ? 1 : 0, ...LOW_LINE_OPACITY));
  };

  const setFilter = (ids: readonly number[] | null): void => {
    const filter = ids === null || ids.length === 0 ? noMatch() : cropsFilter(ids);
    map.setFilter(FIELDS_LOW_FILL_LAYER_ID, filter);
    map.setFilter(FIELDS_LOW_LINE_LAYER_ID, filter);
  };

  let lit = false;

  return {
    setHighlight(cropIds) {
      window.clearTimeout(clearTimer);
      if (cropIds === null || cropIds.length === 0) {
        if (!lit) return;
        lit = false;
        paint(false);
        wash(false);
        clearTimer = window.setTimeout(() => setFilter(null), FADE_MS + 60);
        return;
      }
      lit = true;
      setFilter(cropIds);
      paint(true);
      wash(true);
    },
    destroy() {
      window.clearTimeout(clearTimer);
    },
  };
}
