import type { Region, RegionLevel } from './regions';

/** Crossing this zoom splits coarse markers into fine ones (and back when zooming out). */
export const SPLIT_ZOOM = 7.4;
/** Hysteresis so hovering around the threshold does not retrigger the split/merge. */
export const MERGE_ZOOM = 7.34;

const COARSE_DIM_START = 7.2;
const FINE_FADE: readonly [number, number] = [9.8, 10.4];

/** Coarse icons start small at whole-California zoom so far more of them fit without overlapping. */
const COARSE_MIN_SCALE = 0.44;

export const COARSE_SIZE: readonly [number, number] = [64, 112];
export const FINE_SIZE: readonly [number, number] = [40, 68];

export const LABEL_HEIGHT = 26;
/** Space between the label's bottom edge and the ground point where the shadow sits. */
export const GROUND_GAP = 10;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const smoothstep = (a: number, b: number, v: number): number => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * Zoom-driven opacity. Coarse markers only dim slightly (they would otherwise be half gone when the
 * split fires at 7.4); the split animation, not the zoom, is what removes them.
 */
export function bandOpacity(level: RegionLevel, zoom: number): number {
  switch (level) {
    case 'coarse':
      return 1 - 0.2 * smoothstep(COARSE_DIM_START, SPLIT_ZOOM, zoom);
    case 'fine':
      return 1 - smoothstep(FINE_FADE[0], FINE_FADE[1], zoom);
    default: {
      const never: never = level;
      return never;
    }
  }
}

/** Mild zoom-driven scale within a band, shrinking a touch as the band fades out. */
export function bandScale(level: RegionLevel, zoom: number, opacity: number): number {
  switch (level) {
    case 'coarse':
      return lerp(COARSE_MIN_SCALE, 1.1, clamp01((zoom - 4.6) / (SPLIT_ZOOM - 4.6)) ** 1.25) * (0.9 + 0.1 * opacity);
    case 'fine':
      return lerp(0.86, 1.2, clamp01((zoom - SPLIT_ZOOM) / (10 - SPLIT_ZOOM))) * (0.88 + 0.12 * opacity);
    default: {
      const never: never = level;
      return never;
    }
  }
}

/** Zoom range in which a level's markers should exist on the map (with slack so split/merge can finish). */
export function inBand(level: RegionLevel, zoom: number): boolean {
  switch (level) {
    case 'coarse':
      return zoom < 7.8;
    case 'fine':
      return zoom > 7.0 && zoom < 10.6;
    default: {
      const never: never = level;
      return never;
    }
  }
}

/** Icon size in CSS px by sqrt(acres), normalised within the level. */
export function sizeScale(regions: readonly Region[], level: RegionLevel): (r: Region) => number {
  const [lo, hi] = level === 'coarse' ? COARSE_SIZE : FINE_SIZE;
  const roots = regions.map((r) => Math.sqrt(r.acres));
  const min = Math.min(...roots);
  const span = Math.max(...roots) - min || 1;
  return (r) => Math.round(lerp(lo, hi, (Math.sqrt(r.acres) - min) / span));
}
