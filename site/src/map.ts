import maplibregl from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import { frameInstant, solveFrame, type FramePadding } from './lib/frame';
import { buildBasemapStyle } from './style/basemap';
import { mountCompassRose } from './ui/compass-rose';

export const CA_BOUNDS: maplibregl.LngLatBoundsLike = [
  [-124.6, 32.4],
  [-113.9, 42.1],
];

/** Outline extremes of the state: framing these (not the bounding box) lets the diagonal coast sit tight against the UI. */
const CA_EXTREMES: readonly [number, number][] = [
  [-124.4, 40.44],
  [-124.2, 42.0],
  [-120.0, 42.0],
  [-120.0, 39.0],
  [-114.13, 34.3],
  [-114.72, 32.72],
  [-117.12, 32.53],
  [-120.47, 34.45],
];

/** Room reserved for the search pill above (and the zoom buttons on the right). Nothing else floats over the map at state zoom. */
const framePadding = (width: number): FramePadding =>
  width <= 720
    ? { top: 96, bottom: 44, left: 18, right: 18 }
    : { top: 84, bottom: 34, left: 40, right: 64 };

/** Fits California into the free area between the UI. */
function frameCalifornia(map: maplibregl.Map, container: HTMLElement): void {
  frameInstant(map, CA_BOUNDS, CA_EXTREMES, framePadding(container.clientWidth));
}

/** How far below the whole-California framing people may zoom out. */
const MIN_ZOOM_BELOW_DEFAULT = 0.6;
/** Extra room to pan past the minimum-zoom viewport, in degrees. */
const PAN_ALLOWANCE = { lng: 3.5, lat: 2.5 } as const;
/** The baked ocean raster (see make-sticker-rasters.py) covers this box; views never leave it. */
const RASTER_LIMITS = { west: -151, east: -105, south: 19, north: 53 } as const;
const UNLIMITED_ZOOM = 0;

/**
 * Zoom floor and pan limits derived from the whole-California framing of the current viewport:
 * the world beyond the baked ocean (flat cream continents, the whole world) is never reachable.
 */
function applyViewLimits(map: maplibregl.Map, container: HTMLElement): void {
  const start = { center: map.getCenter(), zoom: map.getZoom() };
  map.setMaxBounds(null);
  map.setMinZoom(UNLIMITED_ZOOM);
  const fit = solveFrame(map, CA_BOUNDS, CA_EXTREMES, framePadding(container.clientWidth));
  const minZoom = fit.zoom - MIN_ZOOM_BELOW_DEFAULT;
  map.jumpTo({ center: fit.center, zoom: minZoom });
  const view = map.getBounds();
  map.setMaxBounds([
    [Math.max(RASTER_LIMITS.west, view.getWest() - PAN_ALLOWANCE.lng), Math.max(RASTER_LIMITS.south, view.getSouth() - PAN_ALLOWANCE.lat)],
    [Math.min(RASTER_LIMITS.east, view.getEast() + PAN_ALLOWANCE.lng), Math.min(RASTER_LIMITS.north, view.getNorth() + PAN_ALLOWANCE.lat)],
  ]);
  map.setMinZoom(minZoom);
  map.jumpTo(start);
}

const protocol = new Protocol();
maplibregl.addProtocol('pmtiles', protocol.tile);

export function createMap(container: HTMLElement): maplibregl.Map {
  const map = new maplibregl.Map({
    container,
    style: buildBasemapStyle(window.location.origin, import.meta.env.BASE_URL),
    minZoom: UNLIMITED_ZOOM,
    maxZoom: 18,
    maxPitch: 0,
    pitchWithRotate: false,
    touchPitch: false,
    attributionControl: false,
    renderWorldCopies: false,
    // 3x phones would shade 2.25x the pixels of 2x for detail nobody can see on a map canvas.
    pixelRatio: Math.min(window.devicePixelRatio, 2),
  });

  frameCalifornia(map, container);
  applyViewLimits(map, container);

  map.on('movestart', () => container.classList.add('is-moving'));
  map.on('moveend', () => container.classList.remove('is-moving'));

  let lastSize = `${container.clientWidth}x${container.clientHeight}`;
  let resizeTimer: number | undefined;
  map.on('resize', () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      const size = `${container.clientWidth}x${container.clientHeight}`;
      if (size === lastSize) return;
      lastSize = size;
      applyViewLimits(map, container);
    }, 250);
  });

  map.once('load', () => {
    mountCompassRose(container.parentElement ?? container, map);
    const attrib = container.querySelector('.maplibregl-ctrl-attrib');
    attrib?.classList.remove('maplibregl-compact-show');
    attrib?.removeAttribute('open');
  });

  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'bottom-right');

  return map;
}
