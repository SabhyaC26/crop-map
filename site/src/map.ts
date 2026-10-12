import maplibregl from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import { buildBasemapStyle } from './style/basemap';

export const CA_BOUNDS: maplibregl.LngLatBoundsLike = [
  [-124.6, 32.4],
  [-113.9, 42.1],
];

// fitBounds assumes a Mercator camera; the globe renders California ~25% larger at the same zoom.
const GLOBE_FIT_ZOOM_OFFSET = -0.34;

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
    map.fitBounds(CA_BOUNDS, { padding: { top: 90, bottom: 110, left: 24, right: 24 }, duration: 0 });
    map.setZoom(map.getZoom() + GLOBE_FIT_ZOOM_OFFSET);
  });

  map.once('load', () => {
    const attrib = container.querySelector('.maplibregl-ctrl-attrib');
    attrib?.classList.remove('maplibregl-compact-show');
    attrib?.removeAttribute('open');
  });

  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');

  return map;
}
