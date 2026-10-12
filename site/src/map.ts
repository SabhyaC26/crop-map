import maplibregl from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import { frameInstant, type FramePadding } from './lib/frame';
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

const protocol = new Protocol();
maplibregl.addProtocol('pmtiles', protocol.tile);

export function createMap(container: HTMLElement): maplibregl.Map {
  const map = new maplibregl.Map({
    container,
    style: buildBasemapStyle(window.location.origin, import.meta.env.BASE_URL),
    minZoom: 4.2,
    maxZoom: 18,
    maxPitch: 60,
    attributionControl: false,
    renderWorldCopies: false,
  });

  map.once('style.load', () => {
    frameCalifornia(map, container);
  });

  map.once('load', () => {
    mountCompassRose(container.parentElement ?? container, map);
    const attrib = container.querySelector('.maplibregl-ctrl-attrib');
    attrib?.classList.remove('maplibregl-compact-show');
    attrib?.removeAttribute('open');
  });

  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');

  return map;
}
