import type { SearchPlace, SearchTarget } from '../markers/regions';

export type Bbox = readonly [number, number, number, number];

const FALLBACK_HALF_SPAN_DEG = 0.6;

/** `places` as shipped, or a single hotspot built from the primary target for older regions.json builds. */
export function resolvePlaces(target: SearchTarget): readonly SearchPlace[] {
  if (target.places && target.places.length > 0) return target.places;
  return [{ center: target.center, zoom: target.zoom, label: target.label, acres: target.acres_total }];
}

export function resolveBbox(target: SearchTarget): Bbox {
  if (target.bbox) return target.bbox;
  const [lng, lat] = target.center;
  return [
    lng - FALLBACK_HALF_SPAN_DEG,
    lat - FALLBACK_HALF_SPAN_DEG,
    lng + FALLBACK_HALF_SPAN_DEG,
    lat + FALLBACK_HALF_SPAN_DEG,
  ];
}
