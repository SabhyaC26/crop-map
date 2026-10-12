import type { Marker } from 'maplibre-gl';
import type { Crop } from '../data/crops';
import { prefersReducedMotion } from '../lib/motion';
import type { MarkerParts } from './element';
import { REST, settled, snapshot, track, type FxSnapshot } from './fx';
import type { Region } from './regions';
import { bounceEasing, springEasing } from './spring';

export interface MarkerItem {
  region: Region;
  crop: Crop;
  marker: Marker;
  parts: MarkerParts;
  size: number;
  labelWidth: number;
  parent: MarkerItem | null;
  /** Position among siblings by rank (fine only) and how many there are. */
  sibling: number;
  siblingCount: number;
  anims: Animation[];
  /** Whether the marker element currently lives on the map (only near its zoom band). */
  attached: boolean;
  shown: boolean;
  gateOn: boolean;
  labelOn: boolean;
  inert: boolean;
  bandOpacity: number;
  bandScale: number;
  /** Pixels the marker is pushed down so its icon stays under the state's northern border. */
  nudgeY: number;
}

export interface Offset {
  x: number;
  y: number;
}

export const STAGGER_SPLIT_MS = 28;
export const STAGGER_MERGE_MS = 14;

const SPLIT_MS = 650;
const MERGE_MS = 440;
const POP_MS = 720;
const DROP_MS = 1000;

const SPRING_MOVE = springEasing(0.66);
const SPRING_POP = springEasing(0.42);
const SPRING_BOUNCY = springEasing(0.36);
const GLIDE = 'cubic-bezier(0.45, 0, 0.2, 1)';
const DROP = bounceEasing(0.38, 2);

const px = (o: Offset | null): string => (o ? `${o.x.toFixed(1)}px ${o.y.toFixed(1)}px` : REST.translate);

const setShown = (item: MarkerItem, shown: boolean): void => {
  item.shown = shown;
  item.parts.root.dataset.state = shown ? 'shown' : 'hidden';
};

/** Cancels in-flight animations and returns where they were, or `fallback` when nothing was running. */
const takeover = (item: MarkerItem, fallback: FxSnapshot): FxSnapshot => {
  const from = item.anims.length > 0 ? snapshot(item.parts.fx) : fallback;
  for (const a of item.anims) a.cancel();
  item.anims = [];
  return from;
};

const run = (item: MarkerItem, anims: Animation[], onDone?: () => void): void => {
  item.anims = anims;
  settled(anims).then(
    () => {
      if (item.anims !== anims) return;
      item.anims = [];
      onDone?.();
      for (const a of anims) a.cancel();
    },
    () => undefined,
  );
};

const fade = (item: MarkerItem, to: 0 | 1, delay: number): void => {
  const from = takeover(item, { ...REST, opacity: to === 1 ? '0' : '1' });
  if (to === 1) setShown(item, true);
  run(item, [track(item.parts.fx, 'opacity', [{ value: from.opacity }, { value: to }], { duration: 180, delay })], () => {
    if (to === 0) setShown(item, false);
  });
};

/** Appears in place without any choreography (off-screen or collision-hidden markers). */
export function showStatic(item: MarkerItem): void {
  takeover(item, REST);
  setShown(item, true);
}

export function hideStatic(item: MarkerItem): void {
  takeover(item, REST);
  setShown(item, false);
}

/** Fine marker springs out from where its parent currently is. */
export function splitIn(item: MarkerItem, from: Offset | null, delay: number): void {
  if (prefersReducedMotion()) return fade(item, 1, 0);
  const start = takeover(item, { translate: px(from), scale: '0.4', opacity: '0' });
  setShown(item, true);
  const fx = item.parts.fx;
  run(item, [
    track(fx, 'translate', [{ value: start.translate }, { value: REST.translate }], { duration: SPLIT_MS, delay, easing: SPRING_MOVE }),
    track(fx, 'scale', [{ value: start.scale }, { value: 1 }], { duration: SPLIT_MS, delay, easing: SPRING_POP }),
    track(fx, 'opacity', [{ value: start.opacity }, { value: 1 }], { duration: 240, delay, easing: 'ease-out' }),
  ]);
}

/** Fine marker glides back into its parent and vanishes. */
export function mergeOut(item: MarkerItem, to: Offset | null, delay: number): void {
  if (prefersReducedMotion()) return fade(item, 0, 0);
  const start = takeover(item, REST);
  const fx = item.parts.fx;
  run(
    item,
    [
      track(fx, 'translate', [{ value: start.translate }, { value: px(to) }], { duration: MERGE_MS, delay, easing: GLIDE }),
      track(fx, 'scale', [{ value: start.scale }, { value: 0.4 }], { duration: MERGE_MS, delay, easing: GLIDE }),
      track(fx, 'opacity', [{ value: start.opacity }, { value: 0 }], {
        duration: MERGE_MS * 0.6,
        delay: delay + MERGE_MS * 0.4,
        easing: 'ease-in',
      }),
    ],
    () => setShown(item, false),
  );
}

/** Coarse marker swells slightly, then shrinks away as its children emerge. */
export function popOut(item: MarkerItem, delay: number): void {
  if (prefersReducedMotion()) return fade(item, 0, 0);
  const start = takeover(item, REST);
  const fx = item.parts.fx;
  const ms = 400;
  run(
    item,
    [
      track(fx, 'scale', [
        { value: start.scale, at: 0, easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)' },
        { value: 1.15, at: 0.3, easing: 'cubic-bezier(0.5, 0, 0.8, 0.4)' },
        { value: 0, at: 1 },
      ], { duration: ms, delay }),
      track(fx, 'opacity', [
        { value: start.opacity, at: 0 },
        { value: start.opacity, at: 0.3, easing: 'ease-in' },
        { value: 0, at: 1 },
      ], { duration: ms, delay }),
    ],
    () => setShown(item, false),
  );
}

/** Coarse marker pops back in with a bounce (merge) or on a fresh reveal. */
export function popIn(item: MarkerItem, delay: number): void {
  if (prefersReducedMotion()) return fade(item, 1, 0);
  const start = takeover(item, { translate: REST.translate, scale: '0', opacity: '0' });
  setShown(item, true);
  const fx = item.parts.fx;
  run(item, [
    track(fx, 'scale', [{ value: start.scale }, { value: 1 }], { duration: POP_MS, delay, easing: SPRING_BOUNCY }),
    track(fx, 'opacity', [{ value: start.opacity }, { value: 1 }], { duration: 200, delay, easing: 'ease-out' }),
  ]);
}

/** Intro: drops in from above and lands with squash and a couple of bounces. */
export function drop(item: MarkerItem, delay: number): void {
  if (prefersReducedMotion()) return fade(item, 1, 0);
  takeover(item, REST);
  setShown(item, true);
  const fx = item.parts.fx;
  const impact = DROP.impact;
  run(item, [
    track(fx, 'translate', [{ value: '0px -190px' }, { value: REST.translate }], { duration: DROP_MS, delay, easing: DROP.easing }),
    track(fx, 'scale', [
      { value: '0.94 1.08', at: 0 },
      { value: '0.97 1.04', at: impact * 0.97, easing: 'ease-out' },
      { value: '1.16 0.82', at: impact },
      { value: '0.97 1.05', at: impact + 0.09, easing: 'ease-out' },
      { value: '1 1', at: impact + 0.2 },
      { value: '1 1', at: 1 },
    ], { duration: DROP_MS, delay }),
    track(fx, 'opacity', [{ value: 0 }, { value: 1 }], { duration: 160, delay, easing: 'ease-out' }),
  ]);
}

export function cancelAll(item: MarkerItem): void {
  for (const a of item.anims) a.cancel();
  item.anims = [];
}
