import maplibregl from 'maplibre-gl';
import { Protocol } from 'pmtiles';
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

interface FramePadding {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** Room reserved for the title/search pills above and the season panel below (and zoom buttons on phones). */
const framePadding = (width: number): FramePadding =>
  width <= 720
    ? { top: 122, bottom: 172, left: 42, right: 70 }
    : { top: 88, bottom: 182, left: 40, right: 56 };

/**
 * Fits California into the free area between the UI. fitBounds assumes a Mercator camera and the globe
 * renders larger, so it is only used for the first guess; the zoom is then refined from projected outline points.
 */
function frameCalifornia(map: maplibregl.Map, container: HTMLElement): void {
  const { clientWidth: w, clientHeight: h } = container;
  const pad = framePadding(w);
  map.fitBounds(CA_BOUNDS, { padding: pad, duration: 0 });
  const free = { w: w - pad.left - pad.right, h: h - pad.top - pad.bottom };
  const extent = (): { minX: number; maxX: number; minY: number; maxY: number } => {
    const pts = CA_EXTREMES.map(([lng, lat]) => map.project([lng, lat]));
    return {
      minX: Math.min(...pts.map((p) => p.x)),
      maxX: Math.max(...pts.map((p) => p.x)),
      minY: Math.min(...pts.map((p) => p.y)),
      maxY: Math.max(...pts.map((p) => p.y)),
    };
  };
  for (let i = 0; i < 3; i++) {
    const e = extent();
    const scale = Math.min(free.w / (e.maxX - e.minX), free.h / (e.maxY - e.minY));
    map.jumpTo({ zoom: map.getZoom() + Math.log2(scale) });
    const f = extent();
    const dx = pad.left + free.w / 2 - (f.minX + f.maxX) / 2;
    const dy = pad.top + free.h / 2 - (f.minY + f.maxY) / 2;
    map.jumpTo({ center: map.unproject([w / 2 - dx, h / 2 - dy]) });
  }
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
