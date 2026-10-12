import type { ExpressionSpecification, LayerSpecification, Map as MapLibreMap } from 'maplibre-gl';
import { OVERVIEW_URL } from '../config';
import type { CropIndex } from '../data/crops';
import { saturate } from '../lib/color';
import { FIELDS_BEFORE_LAYER_ID } from '../style/basemap';

export const OVERVIEW_SOURCE = 'overview';
export const OVERVIEW_LAYER = 'overview';
export const OVERVIEW_GLOW_LAYER_ID = 'overview-glow';
export const OVERVIEW_DOTS_LAYER_ID = 'overview-dots';

const FALLBACK_COLOR = '#d8d3c4';
/** Pastels read washed-out from far away; push saturation so the quilt survives the zoomed-out view. */
const SATURATION_BOOST = 0.22;

const zoomCurve = (...stops: [number, unknown][]): ExpressionSpecification =>
  ['interpolate', ['linear'], ['zoom'], ...stops.flat()] as ExpressionSpecification;

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
      filter: FARMLAND_ONLY,
      paint: {
        'circle-color': color,
        'circle-radius': zoomCurve([4, 7], [5, 9.5], [6, 12], [8, 19], [10, 26]),
        'circle-blur': 1,
        'circle-opacity': zoomCurve([4, 0.45], [7, 0.34], [9.5, 0.22], [10.8, 0]),
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
        'circle-opacity': zoomCurve([4, 0.7], [9.5, 0.75], [10.8, 0]),
        'circle-pitch-alignment': 'map',
      },
    },
  ];
}

export function addOverviewLayers(map: MapLibreMap, crops: CropIndex): void {
  const url = `pmtiles://${new URL(OVERVIEW_URL, `${window.location.origin}/`).href}`;
  map.addSource(OVERVIEW_SOURCE, { type: 'vector', url });
  for (const spec of buildLayers(crops)) map.addLayer(spec, FIELDS_BEFORE_LAYER_ID);
}
