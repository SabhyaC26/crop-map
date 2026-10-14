import { Marker, type Map as MapLibreMap } from 'maplibre-gl';
import type { CropIndex } from '../data/crops';
import { flyTo } from '../lib/fly';
import { iconUrl } from '../lib/icons';
import { mapShown } from '../lib/ready';
import {
  cancelAll,
  drop,
  hideStatic,
  mergeOut,
  popIn,
  popOut,
  showStatic,
  splitIn,
  STAGGER_MERGE_MS,
  STAGGER_SPLIT_MS,
  type MarkerItem,
  type Offset,
} from './choreography';
import { GLYPH_INSET, resolveCollisions, type Rect } from './collision';
import { createGeoLabelGuard } from './geo-labels';
import { buildMarkerElement, estimateLabelWidth } from './element';
import type { Region, RegionLevel, RegionSet } from './regions';
import {
  bandOpacity,
  bandScale,
  COARSE_MERGE_BELOW_ZOOM,
  COARSE_MERGE_KM,
  coarseCap,
  distanceKm,
  GROUND_GAP,
  inBand,
  LABEL_HEIGHT,
  MERGE_ZOOM,
  sizeScale,
  SPLIT_ZOOM,
} from './zoom';

export { loadRegions } from './regions';
export type { RegionSet } from './regions';

export interface RegionMarkers {
  /** Fades every marker out (and back in) while a crop is lit up on the map itself. */
  setHidden(hidden: boolean): void;
  destroy(): void;
}

const CLICK_ZOOM: Record<RegionLevel, number> = { coarse: 8.6, fine: 11 };
const MAX_PARENT_OFFSET = 720;
const COLLISION_THROTTLE_MS = 140;
const MOBILE_SIZE_FACTOR = 0.82;
const REVEAL_STAGGER_MS = 40;
/** Pixels beyond the viewport edge before a marker counts as off-screen. */
const OFFSCREEN_MARGIN = 120;
const CA_NORTH_BORDER_LAT = 42;
const NUDGE_MIN_LAT = 40.5;
const NUDGE_MARGIN = 4;
const MAX_NUDGE = 110;
const UI_OBSTACLE_SELECTOR = '#search-slot > *, .maplibregl-ctrl-bottom-right .maplibregl-ctrl-group';

const levelOf = (zoom: number, current: RegionLevel | null): RegionLevel => {
  if (current === 'fine') return zoom < MERGE_ZOOM ? 'coarse' : 'fine';
  return zoom >= SPLIT_ZOOM ? 'fine' : 'coarse';
};

export function createRegionMarkers(
  map: MapLibreMap,
  regions: RegionSet,
  crops: CropIndex,
  manifest: Record<string, string>,
): RegionMarkers {
  const sizeFactor = window.innerWidth < 640 ? MOBILE_SIZE_FACTOR : 1;
  const byLevel: Record<RegionLevel, MarkerItem[]> = { coarse: [], fine: [] };
  const byId = new Map<string, MarkerItem>();
  const children = new Map<string, MarkerItem[]>();
  const build = (level: RegionLevel, list: readonly Region[]): void => {
    const sizeOf = sizeScale(list, level);
    for (const region of list) {
      const crop = crops.get(region.cropId);
      if (!crop) continue;
      const size = Math.round(sizeOf(region) * sizeFactor);
      const parts = buildMarkerElement(region, crop, iconUrl(manifest, crop.icon), size, true);
      parts.root.style.zIndex = String(500 - Math.min(region.rank, 499));
      const marker = new Marker({
        element: parts.root,
        anchor: 'bottom',
        opacityWhenCovered: '0',
        subpixelPositioning: true,
      }).setLngLat(region.lngLat);
      const item: MarkerItem = {
        region,
        crop,
        marker,
        parts,
        size,
        labelWidth: estimateLabelWidth(region.label, level),
        parent: null,
        sibling: 0,
        siblingCount: 1,
        anims: [],
        attached: false,
        shown: false,
        gateOn: true,
        labelOn: true,
        inert: false,
        bandOpacity: -1,
        bandScale: -1,
        nudgeY: 0,
      };
      byLevel[level].push(item);
      byId.set(region.id, item);
    }
  };
  build('coarse', regions.coarse);
  build('fine', regions.fine);

  for (const item of byLevel.fine) {
    const parent = item.region.parent ? (byId.get(item.region.parent) ?? null) : null;
    item.parent = parent;
    if (!parent) continue;
    const siblings = children.get(parent.region.id) ?? [];
    siblings.push(item);
    children.set(parent.region.id, siblings);
  }
  for (const siblings of children.values()) {
    siblings.forEach((s, i) => {
      s.sibling = i;
      s.siblingCount = siblings.length;
    });
  }
  const all = [...byLevel.coarse, ...byLevel.fine];
  const geoLabels = createGeoLabelGuard(map);

  let mode: RegionLevel = levelOf(map.getZoom(), null);
  let revealed = false;
  let hidden = false;
  let frame = 0;
  let collideTimer: ReturnType<typeof setTimeout> | undefined;
  let lastCollide = 0;
  let labelsClear = false;
  let destroyed = false;

  const refreshInteractive = (item: MarkerItem): void => {
    const { root } = item.parts;
    root.dataset.gate = item.gateOn ? 'on' : 'off';
    root.dataset.label = item.labelOn ? 'on' : 'off';
    const live = item.shown && item.gateOn && !item.inert && !hidden;
    root.tabIndex = live ? 0 : -1;
    root.classList.toggle('is-inert', item.inert);
  };

  /** Coarse icons float above their anchor; near the Oregon line that would push them outside California, so slide them down just enough. */
  const applyBorderNudge = (item: MarkerItem, scale: number): void => {
    const [lng, lat] = item.region.lngLat;
    if (lat < NUDGE_MIN_LAT) return;
    const border = map.project([lng, CA_NORTH_BORDER_LAT]).y;
    const iconTop = map.project(item.region.lngLat).y - (GROUND_GAP + LABEL_HEIGHT + item.size * (1 - GLYPH_INSET)) * scale;
    const nudge = Math.min(MAX_NUDGE, Math.max(0, border + NUDGE_MARGIN - iconTop));
    if (Math.abs(nudge - item.nudgeY) < 0.75) return;
    item.nudgeY = nudge;
    item.marker.setOffset([0, nudge]);
  };

  const applyZoom = (force: boolean): void => {
    const zoom = map.getZoom();
    for (const item of all) {
      const { level } = item.region;
      // Out of band a marker is fully faded: off the map it costs nothing per frame. Running split/merge keeps it on.
      const wanted = inBand(level, zoom) || item.anims.length > 0;
      if (wanted !== item.attached) {
        item.attached = wanted;
        if (wanted) item.marker.addTo(map);
        else item.marker.remove();
      }
      if (!item.attached || (!item.shown && !force)) continue;
      const opacity = bandOpacity(level, zoom);
      const scale = bandScale(level, zoom, opacity);
      const { style } = item.parts.band;
      if (Math.abs(opacity - item.bandOpacity) > 0.004) {
        item.bandOpacity = opacity;
        style.opacity = opacity.toFixed(3);
        const inert = opacity < 0.35;
        if (inert !== item.inert) {
          item.inert = inert;
          refreshInteractive(item);
        }
      }
      if (Math.abs(scale - item.bandScale) > 0.002) {
        item.bandScale = scale;
        const t = scale.toFixed(3);
        style.transform = `scale(${t})`;
        item.parts.label.style.transform = `scale(${(1 / scale).toFixed(3)})`;
      }
      if (level === 'coarse') applyBorderNudge(item, scale);
    }
  };

  const measureLabels = (): void => {
    for (const item of all) item.labelWidth = item.parts.name.offsetWidth || item.labelWidth;
  };

  let obstacleCache: Rect[] | null = null;
  /** Floating UI (search pill, places card, zoom buttons) in map-container pixels: markers never sit under it. */
  const uiObstacles = (): Rect[] => {
    // The UI does not move with the map, so mid-gesture reuse skips a forced layout on every collision pass.
    if (map.isMoving() && obstacleCache) return obstacleCache;
    obstacleCache = measureObstacles();
    return obstacleCache;
  };

  const measureObstacles = (): Rect[] => {
    const container = map.getContainer();
    const origin = container.getBoundingClientRect();
    const targets = container.parentElement?.querySelectorAll(UI_OBSTACLE_SELECTOR) ?? [];
    const rects: Rect[] = [];
    for (const el of targets) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        rects.push({ x0: r.left - origin.left, x1: r.right - origin.left, y0: r.top - origin.top, y1: r.bottom - origin.top });
      }
    }
    return rects;
  };

  /**
   * Far out, the coarse level would be a wall of emoji: the same icon within ~120 km collapses into the
   * larger marker, and only the top few (by rank) on screen are shown.
   */
  const declutterCoarse = (zoom: number): Set<MarkerItem> => {
    const out = new Set<MarkerItem>();
    const { clientWidth: w, clientHeight: h } = map.getContainer();
    const cap = coarseCap(zoom, window.innerWidth < 640);
    const kept: MarkerItem[] = [];
    let visible = 0;
    for (const item of byLevel.coarse) {
      const collapsed =
        zoom < COARSE_MERGE_BELOW_ZOOM &&
        kept.some((k) => k.crop.icon === item.crop.icon && distanceKm(k.region.lngLat, item.region.lngLat) < COARSE_MERGE_KM);
      const p = map.project(item.region.lngLat);
      const onScreen = p.x > 0 && p.x < w && p.y > 0 && p.y < h;
      if (collapsed || (onScreen && visible >= cap)) {
        out.add(item);
        continue;
      }
      kept.push(item);
      if (onScreen) visible++;
    }
    return out;
  };

  /** Flags markers well outside the viewport so their bob pauses (styles/markers.css); they stay attached so nothing pops in at the edge. */
  const markOffscreen = (): void => {
    const { clientWidth: w, clientHeight: h } = map.getContainer();
    for (const item of all) {
      if (!item.attached) continue;
      const p = map.project(item.region.lngLat);
      const off = p.x < -OFFSCREEN_MARGIN || p.x > w + OFFSCREEN_MARGIN || p.y < -OFFSCREEN_MARGIN || p.y > h + OFFSCREEN_MARGIN;
      if (off !== 'offscreen' in item.parts.root.dataset) {
        if (off) item.parts.root.dataset.offscreen = '';
        else delete item.parts.root.dataset.offscreen;
      }
    }
  };

  const collide = (): void => {
    lastCollide = performance.now();
    // Zoomed past every marker band: once the place names are restored there is nothing left to collide.
    const empty = !hidden && !all.some((item) => item.attached);
    if (empty && labelsClear) return;
    labelsClear = empty;
    const obstacles = uiObstacles();
    const coarse = mode === 'coarse';
    const zoom = map.getZoom();
    const visible = byLevel[mode].filter((item) => bandOpacity(item.region.level, zoom) > 0);
    const { changed, placed } = resolveCollisions(map, visible, zoom, obstacles, {
      excluded: coarse ? declutterCoarse(zoom) : undefined,
      hideLabels: coarse,
    });
    for (const item of changed) refreshInteractive(item);
    for (const item of visible) {
      if (item.gateOn) item.parts.loadIcon?.();
    }
    markOffscreen();
    // Hidden markers must not keep suppressing the place names underneath them.
    geoLabels.update(hidden ? obstacles : placed);
  };

  const scheduleCollide = (): void => {
    if (collideTimer !== undefined) return;
    const wait = Math.max(0, COLLISION_THROTTLE_MS - (performance.now() - lastCollide));
    collideTimer = setTimeout(() => {
      collideTimer = undefined;
      if (!destroyed) collide();
    }, wait);
  };

  const parentOffset = (child: MarkerItem): Offset | null => {
    if (!child.parent) return null;
    const from = map.project(child.parent.region.lngLat);
    const to = map.project(child.region.lngLat);
    const offset = { x: from.x - to.x, y: from.y + child.parent.nudgeY - to.y };
    return Math.hypot(offset.x, offset.y) > MAX_PARENT_OFFSET ? null : offset;
  };

  const staged = (item: MarkerItem): boolean => {
    if (!item.gateOn || item.parts.root.classList.contains('maplibregl-marker-covered')) return false;
    const p = map.project(item.region.lngLat);
    const { clientWidth: w, clientHeight: h } = map.getContainer();
    return p.x > -160 && p.x < w + 160 && p.y > -40 && p.y < h + 280;
  };

  const split = (): void => {
    for (const parent of byLevel.coarse) {
      if (parent.shown) {
        if (staged(parent)) popOut(parent, 0);
        else hideStatic(parent);
      }
    }
    for (const child of byLevel.fine) {
      if (staged(child)) splitIn(child, parentOffset(child), child.sibling * STAGGER_SPLIT_MS);
      else showStatic(child);
    }
  };

  const merge = (): void => {
    for (const child of byLevel.fine) {
      if (!child.shown) continue;
      if (staged(child)) mergeOut(child, parentOffset(child), (child.siblingCount - 1 - child.sibling) * STAGGER_MERGE_MS);
      else hideStatic(child);
    }
    byLevel.coarse.forEach((parent, i) => {
      if (staged(parent)) popIn(parent, 160 + Math.min(i, 8) * 20);
      else showStatic(parent);
    });
  };

  const reveal = (): void => {
    if (revealed || destroyed) return;
    revealed = true;
    applyZoom(true);
    collide();
    let n = 0;
    for (const item of byLevel[mode]) {
      if (!staged(item)) showStatic(item);
      else if (mode === 'coarse') drop(item, n++ * REVEAL_STAGGER_MS);
      else popIn(item, n++ * STAGGER_SPLIT_MS);
      refreshInteractive(item);
    }
    applyZoom(false);
  };

  const onFrame = (): void => {
    frame = 0;
    if (destroyed) return;
    const next = levelOf(map.getZoom(), mode);
    if (next !== mode) {
      mode = next;
      revealed = true;
      applyZoom(true);
      collide();
      if (mode === 'fine') split();
      else merge();
      for (const item of all) refreshInteractive(item);
    }
    applyZoom(false);
  };

  const schedule = (): void => {
    if (frame === 0) frame = requestAnimationFrame(onFrame);
  };

  const onMove = (): void => {
    schedule();
    scheduleCollide();
  };
  const onMoveEnd = (): void => {
    schedule();
    if (collideTimer !== undefined) {
      clearTimeout(collideTimer);
      collideTimer = undefined;
    }
    collide();
  };

  map.on('zoom', schedule);
  map.on('move', onMove);
  map.on('moveend', onMoveEnd);
  // Labels are placed after the first frames, so re-check them once the map settles.
  const onIdle = (): void => {
    if (!destroyed && revealed) collide();
  };
  map.on('idle', onIdle);

  for (const item of all) {
    item.parts.root.addEventListener('click', (e) => {
      e.stopPropagation();
      void flyTo(map, { center: item.region.lngLat, zoom: CLICK_ZOOM[item.region.level] });
    });
  }

  measureLabels();
  applyZoom(true);
  collide();
  void document.fonts.ready.then(() => {
    if (destroyed) return;
    measureLabels();
    collide();
  });
  // The emoji drop in only after the skeleton has faded and the map is visible.
  void mapShown.then(() => {
    if (!map.isMoving()) requestAnimationFrame(reveal);
    else map.once('moveend', reveal);
  });

  return {
    setHidden(next) {
      if (next === hidden) return;
      hidden = next;
      for (const item of all) {
        if (hidden) item.parts.root.dataset.suppressed = '';
        else delete item.parts.root.dataset.suppressed;
        refreshInteractive(item);
      }
      collide();
    },
    destroy() {
      destroyed = true;
      geoLabels.destroy();
      map.off('zoom', schedule);
      map.off('move', onMove);
      map.off('moveend', onMoveEnd);
      map.off('idle', onIdle);
      map.off('moveend', reveal);
      if (frame !== 0) cancelAnimationFrame(frame);
      if (collideTimer !== undefined) clearTimeout(collideTimer);
      for (const item of all) {
        cancelAll(item);
        item.marker.remove();
      }
    },
  };
}
