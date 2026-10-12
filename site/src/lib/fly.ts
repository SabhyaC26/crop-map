import type { LngLatLike, Map as MapLibreMap } from 'maplibre-gl';
import { prefersReducedMotion } from './motion';

export interface FlyTarget {
  center: LngLatLike;
  zoom: number;
  /** Screen-space shift of the destination from the viewport centre. */
  offset?: [number, number];
}

/** Gentle start, long glide, soft landing (cubic bezier .45,0,.2,1 approximated by an eased smoothstep blend). */
const glide = (t: number): number => {
  const s = t * t * (3 - 2 * t);
  return s * s * (3 - 2 * s) * 0.5 + s * 0.5;
};

const SPEED = 1.5;
const CURVE = 1.3;
const MAX_DURATION_MS = 1800;

/**
 * Flat, cinematic camera move: arcs out and back in without touching pitch or bearing.
 * Resolves when the move ends (arrived, interrupted by the user, or replaced by another move).
 */
export function flyTo(map: MapLibreMap, target: FlyTarget): Promise<void> {
  map.flyTo({
    ...target,
    pitch: map.getPitch(),
    bearing: map.getBearing(),
    speed: SPEED,
    curve: CURVE,
    maxDuration: MAX_DURATION_MS,
    easing: glide,
    ...(prefersReducedMotion() ? { duration: 0 } : {}),
    essential: true,
  });
  // Registered after the call: starting a flight stops (and "ends") the previous one first.
  return new Promise((resolve) => {
    if (!map.isMoving()) resolve();
    else map.once('moveend', () => resolve());
  });
}
