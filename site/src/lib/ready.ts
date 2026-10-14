import type { Map as MapLibreMap } from 'maplibre-gl';
import { prefersReducedMotion } from './motion';

/** Must match the `#map` / `#boot` fade in boot.css. */
export const MAP_FADE_MS = 400;
/** Safety net: never leave the skeleton up if the sources never report loaded. */
const GIVE_UP_MS = 12000;
/** Once everything else is in, wait at most this long for the slow sources (terrain shading comes from AWS). */
const SLOW_SOURCE_GRACE_MS = 500;

interface InternalTileManager {
  used?: boolean;
  prepare(context: unknown): void;
}

interface InternalPainter {
  context: unknown;
  render(style: { tileManagers?: Record<string, InternalTileManager> }, options: unknown): void;
}

interface InternalMap {
  painter?: InternalPainter;
  style?: { tileManagers?: Record<string, InternalTileManager> };
}

let announce: () => void = () => undefined;
let restorePainter: (() => void) | undefined;

/** Resolves once the skeleton has faded away and the map is fully visible: the cue for the emoji markers to drop in. */
export const mapShown: Promise<void> = new Promise((resolve) => {
  announce = resolve;
});

let started = false;

/** Fades the skeleton out and the map in (the stylesheet reacts to the `map-ready` class). */
export function showMap(): void {
  if (started) return;
  started = true;
  restorePainter?.();
  restorePainter = undefined;
  document.documentElement.classList.add('map-ready');
  window.setTimeout(
    () => {
      // A faded-out skeleton would keep its shimmer animations ticking for the life of the page.
      document.getElementById('boot')?.remove();
      announce();
    },
    prefersReducedMotion() ? 0 : MAP_FADE_MS,
  );
}

/**
 * Calls `showMap` after `ready` settles and every source except `slowSources` has its tiles, giving the slow ones a
 * short grace period. Waiting for full `idle` instead would hold the whole map back on the slowest terrain tile.
 */
export function showMapWhenReady(map: MapLibreMap, ready: Promise<unknown>, slowSources: readonly string[]): void {
  // While `#map` is opacity 0 behind `#boot`, Chrome never presents the WebGL canvas, so every intermediate draw pass
  // piles up in the GPU command buffer and stalls the main thread when `#map` turns visible. Prepare tile textures
  // without issuing layer draw calls until `showMap` reveals the canvas.
  const internal = map as unknown as InternalMap;
  const painter = internal.painter;
  if (painter && !started) {
    const origRender = painter.render.bind(painter);
    painter.render = (style, options) => {
      if (!started) {
        for (const tm of Object.values(style.tileManagers ?? {})) {
          if (tm.used) tm.prepare(painter.context);
        }
        return;
      }
      origRender(style, options);
    };
    restorePainter = () => {
      painter.render = origRender;
      map.triggerRepaint();
    };
  }

  window.setTimeout(showMap, GIVE_UP_MS);
  let graceTimer: number | undefined;
  const loaded = (ids: string[]): boolean => ids.every((id) => map.isSourceLoaded(id));
  const check = (): void => {
    const ids = Object.keys(internal.style?.tileManagers ?? map.getStyle().sources);
    if (!loaded(ids.filter((id) => !slowSources.includes(id)))) return;
    graceTimer ??= window.setTimeout(showMap, SLOW_SOURCE_GRACE_MS);
    if (loaded(ids)) showMap();
    if (started) map.off('render', check);
  };
  const watch = (): void => {
    map.on('render', check);
    map.triggerRepaint();
  };
  ready.then(watch, watch);
}
