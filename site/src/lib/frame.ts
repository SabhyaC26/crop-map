import type { LngLatBoundsLike, LngLatLike, Map as MapLibreMap } from 'maplibre-gl';

export interface FramePadding {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface Camera {
  center: LngLatLike;
  zoom: number;
}

const REFINE_PASSES = 3;
const MAX_ZOOM = 22;

/**
 * Jumps the camera so `points` fill the free area inside `pad`. fitBounds assumes a Mercator camera and the
 * globe renders larger, so it only seeds the camera; the zoom is then refined from projected points.
 */
export function frameInstant(
  map: MapLibreMap,
  bounds: LngLatBoundsLike,
  points: readonly (readonly [number, number])[],
  pad: FramePadding,
  maxZoom = MAX_ZOOM,
): void {
  const { clientWidth: w, clientHeight: h } = map.getContainer();
  map.fitBounds(bounds, { padding: pad, duration: 0, maxZoom, pitch: 0, bearing: 0 });
  const free = { w: w - pad.left - pad.right, h: h - pad.top - pad.bottom };
  const extent = (): { minX: number; maxX: number; minY: number; maxY: number } => {
    const pts = points.map(([lng, lat]) => map.project([lng, lat]));
    return {
      minX: Math.min(...pts.map((p) => p.x)),
      maxX: Math.max(...pts.map((p) => p.x)),
      minY: Math.min(...pts.map((p) => p.y)),
      maxY: Math.max(...pts.map((p) => p.y)),
    };
  };
  for (let i = 0; i < REFINE_PASSES; i++) {
    const e = extent();
    const scale = Math.min(free.w / (e.maxX - e.minX), free.h / (e.maxY - e.minY));
    map.jumpTo({ zoom: Math.min(maxZoom, map.getZoom() + Math.log2(scale)) });
    const f = extent();
    const dx = pad.left + free.w / 2 - (f.minX + f.maxX) / 2;
    const dy = pad.top + free.h / 2 - (f.minY + f.maxY) / 2;
    map.jumpTo({ center: map.unproject([w / 2 - dx, h / 2 - dy]) });
  }
}

/** Same as `frameInstant` but only reports the resulting camera, leaving the map where it was (for animated moves). */
export function solveFrame(
  map: MapLibreMap,
  bounds: LngLatBoundsLike,
  points: readonly (readonly [number, number])[],
  pad: FramePadding,
  maxZoom = MAX_ZOOM,
): Camera {
  const start = { center: map.getCenter(), zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() };
  frameInstant(map, bounds, points, pad, maxZoom);
  const camera = { center: map.getCenter(), zoom: map.getZoom() };
  map.jumpTo(start);
  return camera;
}
