import type { Map as MapLibreMap } from 'maplibre-gl';
import { CLOUD_LAYER_IDS, SPARKLE_LAYER_IDS } from '../style/storybook';

const FRAME_MS = 80;
const SPARKLE_BASE = 0.5;
const SPARKLE_SWING = 0.4;
const SPARKLE_PERIOD_S = 4.2;
const CLOUD_DRIFT_PX = 70;
const CLOUD_PERIOD_S = 110;
/** Decorations are invisible past this zoom, so stop animating. */
const MOTION_MAX_ZOOM = 8.4;

const TAU = Math.PI * 2;

/**
 * Twinkle the ocean sparkles and drift the cloud shadows. Throttled, paused when the tab is hidden or
 * the decor is zoomed away, and left static under prefers-reduced-motion.
 */
export function startStorybookMotion(map: MapLibreMap): () => void {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let frame = 0;
  let last = 0;

  const tick = (now: number): void => {
    frame = requestAnimationFrame(tick);
    if (now - last < FRAME_MS || document.hidden || map.getZoom() > MOTION_MAX_ZOOM) return;
    last = now;
    const t = now / 1000;

    SPARKLE_LAYER_IDS.forEach((id, k) => {
      if (!map.getLayer(id)) return;
      const phase = (k / SPARKLE_LAYER_IDS.length) * TAU;
      map.setPaintProperty(id, 'circle-opacity', SPARKLE_BASE + SPARKLE_SWING * Math.sin((t / SPARKLE_PERIOD_S) * TAU + phase));
    });

    CLOUD_LAYER_IDS.forEach((id, k) => {
      if (!map.getLayer(id)) return;
      const phase = (k / CLOUD_LAYER_IDS.length) * TAU;
      const a = (t / CLOUD_PERIOD_S) * TAU + phase;
      map.setPaintProperty(id, 'circle-translate', [Math.sin(a) * CLOUD_DRIFT_PX, Math.cos(a * 0.7) * CLOUD_DRIFT_PX * 0.35]);
    });
  };

  const sync = (): void => {
    cancelAnimationFrame(frame);
    if (!reduced.matches) frame = requestAnimationFrame(tick);
  };

  reduced.addEventListener('change', sync);
  sync();

  return () => {
    reduced.removeEventListener('change', sync);
    cancelAnimationFrame(frame);
  };
}
