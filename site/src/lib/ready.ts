import { prefersReducedMotion } from './motion';

/** Must match the `#map` / `#boot` fade in boot.css. */
export const MAP_FADE_MS = 400;
/** Safety net: never leave the skeleton up if the map cannot report idle. */
const GIVE_UP_MS = 12000;

let announce: () => void = () => undefined;

/** Resolves once the skeleton has faded away and the map is fully visible: the cue for the emoji markers to drop in. */
export const mapShown: Promise<void> = new Promise((resolve) => {
  announce = resolve;
});

let started = false;

/** Fades the skeleton out and the map in (the stylesheet reacts to the `map-ready` class). */
export function showMap(): void {
  if (started) return;
  started = true;
  document.documentElement.classList.add('map-ready');
  window.setTimeout(announce, prefersReducedMotion() ? 0 : MAP_FADE_MS);
}

/** Calls `showMap` after `ready` settles and the map has painted at least once more, or after a timeout. */
export function showMapWhenIdle(map: { once(type: 'idle', fn: () => void): unknown }, ready: Promise<unknown>): void {
  window.setTimeout(showMap, GIVE_UP_MS);
  const settle = (): void => {
    map.once('idle', showMap);
  };
  ready.then(settle, settle);
}
