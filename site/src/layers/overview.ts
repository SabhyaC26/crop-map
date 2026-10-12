import type { ExpressionSpecification, FilterSpecification, LayerSpecification, Map as MapLibreMap } from 'maplibre-gl';
import { OVERVIEW_URL } from '../config';
import type { CropIndex } from '../data/crops';
import { darken, saturate } from '../lib/color';
import { prefersReducedMotion } from '../lib/motion';
import { OCEAN_GRADIENT_LAYER_ID } from '../style/basemap';

export const OVERVIEW_SOURCE = 'overview';
export const OVERVIEW_LAYER = 'overview';
export const OVERVIEW_GLOW_LAYER_ID = 'overview-glow';
export const OVERVIEW_DOTS_LAYER_ID = 'overview-dots';
export const OVERVIEW_HL_GLOW_LAYER_ID = 'overview-hl-glow';
export const OVERVIEW_HL_DOTS_LAYER_ID = 'overview-hl-dots';

export interface OverviewLayer {
  /** Lights up only the given crops' dots (statewide) and hides the rest; `null` restores the quilt. */
  setHighlight(cropIds: readonly number[] | null): void;
  destroy(): void;
}

/** Cross-fade between the quilt and the highlighted dots. */
const FADE_MS = 360;
/** Share of the base quilt that stays visible behind a highlight. */
const DIMMED_QUILT = 0.035;
const GLOW_SATURATION = 0.55;
/** Lit dots are the deep, saturated version of the crop's pastel so they pop against their own halo. */
const DOT_SATURATION = 0.7;
const DOT_DARKEN = 0.14;
const PULSE_DELAY_MS = 420;
const PULSE_UP_MS = 520;
const NO_CROP = -1;

const FALLBACK_COLOR = '#d8d3c4';
/** Pastels read washed-out from far away; push saturation so the quilt survives the zoomed-out view. */
const SATURATION_BOOST = 0.22;

const zoomCurve = (...stops: [number, unknown][]): ExpressionSpecification =>
  ['interpolate', ['linear'], ['zoom'], ...stops.flat()] as ExpressionSpecification;

const scaled = (gain: number, ...stops: [number, number][]): ExpressionSpecification =>
  zoomCurve(...stops.map(([z, v]): [number, number] => [z, +(v * gain).toFixed(4)]));

const GLOW_OPACITY: [number, number][] = [[4, 0.3], [7, 0.3], [9.5, 0.24], [10.8, 0]];
const DOT_OPACITY: [number, number][] = [[4, 0.7], [9.5, 0.75], [10.8, 0]];
const HL_GLOW_OPACITY: [number, number][] = [[4, 0.34], [7, 0.32], [9.5, 0.26], [11, 0]];
const HL_DOT_OPACITY: [number, number][] = [[4, 1], [9.5, 0.95], [10.2, 0.7], [11, 0]];
const HL_STROKE_OPACITY: [number, number][] = [[4, 0.55], [9.5, 0.5], [11, 0]];
const HL_GLOW_RADIUS: [number, number][] = [[4, 13], [5, 16], [6, 19], [8, 26], [10, 36]];
const HL_DOT_RADIUS: [number, number][] = [[4, 2.8], [5, 3], [6, 3.4], [8, 4.2], [10, 5.6]];

const fade = (ms: number): { duration: number; delay: number } => ({ duration: prefersReducedMotion() ? 0 : ms, delay: 0 });

const noMatch = (): FilterSpecification => ['==', ['get', 'crop_id'], NO_CROP];

const cropsFilter = (ids: readonly number[]): FilterSpecification => ['in', ['get', 'crop_id'], ['literal', [...ids]]];

function cropColor(crops: CropIndex): ExpressionSpecification {
  if (crops.list.length === 0) return ['literal', FALLBACK_COLOR] as unknown as ExpressionSpecification;
  const pairs = crops.list.flatMap((c) => [c.cropId, saturate(c.color, SATURATION_BOOST)]);
  return ['match', ['get', 'crop_id'], ...pairs, FALLBACK_COLOR] as unknown as ExpressionSpecification;
}

/** Rangeland-like crops (pasture, grasses, "other") are drab grey-greens that turn the hills muddy; the confetti is for farmland. */
const MUTED_CROP_IDS = [6, 13, 14, 21, 51, 53];
const FARMLAND_ONLY: ExpressionSpecification = ['!', ['in', ['get', 'crop_id'], ['literal', MUTED_CROP_IDS]]];

/** Dot-density "confetti": one soft dot per ~60 acres, tinted by crop, handing off to the field polygons at z9-10.5. */
function buildLayers(crops: CropIndex): LayerSpecification[] {
  const color = cropColor(crops);
  return [
    {
      id: OVERVIEW_GLOW_LAYER_ID,
      type: 'circle',
      source: OVERVIEW_SOURCE,
      'source-layer': OVERVIEW_LAYER,
      maxzoom: 11,
      filter: ['all', FARMLAND_ONLY, ['==', ['get', 'g'], 1]],
      paint: {
        'circle-color': color,
        'circle-radius': zoomCurve([4, 13], [5, 17], [6, 19], [8, 26], [10, 34]),
        'circle-blur': 1,
        'circle-opacity': scaled(1, ...GLOW_OPACITY),
        'circle-opacity-transition': fade(FADE_MS),
        'circle-pitch-alignment': 'map',
      },
    },
    {
      id: OVERVIEW_DOTS_LAYER_ID,
      type: 'circle',
      source: OVERVIEW_SOURCE,
      'source-layer': OVERVIEW_LAYER,
      maxzoom: 11,
      filter: FARMLAND_ONLY,
      paint: {
        'circle-color': color,
        'circle-radius': zoomCurve([4, 1.9], [5, 2], [6, 2.3], [8, 3], [10, 4.2]),
        'circle-blur': 0.6,
        'circle-opacity': scaled(1, ...DOT_OPACITY),
        'circle-opacity-transition': fade(FADE_MS),
        'circle-pitch-alignment': 'map',
      },
    },
  ];
}

/** Brighter, bigger twins of the quilt dots that only exist while a crop is selected. */
function buildHighlightLayers(crops: CropIndex): LayerSpecification[] {
  const colors = (tint: (hex: string) => string): ExpressionSpecification =>
    crops.list.length === 0
      ? (['literal', FALLBACK_COLOR] as unknown as ExpressionSpecification)
      : (['match', ['get', 'crop_id'], ...crops.list.flatMap((c) => [c.cropId, tint(c.color)]), FALLBACK_COLOR] as unknown as ExpressionSpecification);
  const glowColor = colors((hex) => saturate(hex, GLOW_SATURATION));
  const dotColor = colors((hex) => darken(saturate(hex, DOT_SATURATION), DOT_DARKEN));
  return [
    {
      id: OVERVIEW_HL_GLOW_LAYER_ID,
      type: 'circle',
      source: OVERVIEW_SOURCE,
      'source-layer': OVERVIEW_LAYER,
      maxzoom: 11,
      filter: noMatch(),
      paint: {
        'circle-color': glowColor,
        'circle-radius': scaled(1, ...HL_GLOW_RADIUS),
        'circle-blur': 1,
        'circle-opacity': scaled(0, ...HL_GLOW_OPACITY),
        'circle-opacity-transition': fade(FADE_MS),
        'circle-radius-transition': fade(PULSE_UP_MS),
        'circle-pitch-alignment': 'map',
      },
    },
    {
      id: OVERVIEW_HL_DOTS_LAYER_ID,
      type: 'circle',
      source: OVERVIEW_SOURCE,
      'source-layer': OVERVIEW_LAYER,
      maxzoom: 11,
      filter: noMatch(),
      paint: {
        'circle-color': dotColor,
        'circle-radius': scaled(1, ...HL_DOT_RADIUS),
        'circle-blur': 0.25,
        'circle-opacity': scaled(0, ...HL_DOT_OPACITY),
        'circle-opacity-transition': fade(FADE_MS),
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': zoomCurve([4, 0.5], [8, 0.7], [10, 1]),
        'circle-stroke-opacity': scaled(0, ...HL_STROKE_OPACITY),
        'circle-stroke-opacity-transition': fade(FADE_MS),
        'circle-pitch-alignment': 'map',
      },
    },
  ];
}

export function addOverviewLayers(map: MapLibreMap, crops: CropIndex): OverviewLayer {
  const url = `pmtiles://${new URL(OVERVIEW_URL, `${window.location.origin}/`).href}`;
  map.addSource(OVERVIEW_SOURCE, { type: 'vector', url });
  for (const spec of [...buildLayers(crops), ...buildHighlightLayers(crops)]) map.addLayer(spec, OCEAN_GRADIENT_LAYER_ID);

  const timers = new Set<number>();
  const later = (fn: () => void, ms: number): void => {
    const id = window.setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
  };
  const cancelTimers = (): void => {
    for (const id of timers) window.clearTimeout(id);
    timers.clear();
  };

  /** `lit`: 0 hides the highlight, 1 shows it. `pulse` swells the glow for the one-time shimmer. */
  const paint = (lit: number, pulse: number): void => {
    map.setPaintProperty(OVERVIEW_GLOW_LAYER_ID, 'circle-opacity', scaled(lit > 0 ? DIMMED_QUILT : 1, ...GLOW_OPACITY));
    map.setPaintProperty(OVERVIEW_DOTS_LAYER_ID, 'circle-opacity', scaled(lit > 0 ? DIMMED_QUILT : 1, ...DOT_OPACITY));
    map.setPaintProperty(OVERVIEW_HL_GLOW_LAYER_ID, 'circle-opacity', scaled(lit * pulse, ...HL_GLOW_OPACITY));
    map.setPaintProperty(OVERVIEW_HL_GLOW_LAYER_ID, 'circle-radius', scaled(1 + (pulse - 1) * 0.45, ...HL_GLOW_RADIUS));
    map.setPaintProperty(OVERVIEW_HL_DOTS_LAYER_ID, 'circle-opacity', scaled(lit, ...HL_DOT_OPACITY));
    map.setPaintProperty(OVERVIEW_HL_DOTS_LAYER_ID, 'circle-stroke-opacity', scaled(lit, ...HL_STROKE_OPACITY));
  };

  const setFilter = (ids: readonly number[] | null): void => {
    const filter = ids === null || ids.length === 0 ? noMatch() : cropsFilter(ids);
    map.setFilter(OVERVIEW_HL_GLOW_LAYER_ID, filter);
    map.setFilter(OVERVIEW_HL_DOTS_LAYER_ID, filter);
  };

  let lit = false;

  return {
    setHighlight(cropIds) {
      cancelTimers();
      if (cropIds === null || cropIds.length === 0) {
        if (!lit) return;
        lit = false;
        paint(0, 1);
        later(() => setFilter(null), FADE_MS + 60);
        return;
      }
      const wasLit = lit;
      lit = true;
      setFilter(cropIds);
      paint(1, 1);
      if (prefersReducedMotion()) return;
      // A soft one-time shimmer once the dots have faded in (or after a crop swap).
      later(() => paint(1, 1.6), wasLit ? 60 : PULSE_DELAY_MS);
      later(() => paint(1, 1), (wasLit ? 60 : PULSE_DELAY_MS) + PULSE_UP_MS + 40);
    },
    destroy() {
      cancelTimers();
    },
  };
}
