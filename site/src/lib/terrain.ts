import type { Map as MapLibreMap } from 'maplibre-gl';
import { TERRAIN_TILES_URL } from '../config';

/**
 * Separate from the basemap's `terrain` source: sharing one source between hillshade/color-relief and 3D terrain
 * makes MapLibre warn and degrade rendering quality. The tiles are the same files, so the HTTP cache absorbs the cost.
 */
export const DIORAMA_DEM_SOURCE = 'terrain-diorama';

/** Terrain costs real frame time, so it only runs where the field diorama is visible. */
const TERRAIN_ON_ZOOM = 11;
const TERRAIN_OFF_ZOOM = 10.6;
const TERRAIN_EXAGGERATION = 1.3;

/**
 * Drapes the map over the Terrarium DEM once zoomed into farmland and removes it again when zooming back out
 * (with hysteresis so hovering around z11 does not flap). Returns a disposer that also drops the terrain.
 */
export function enableDioramaCamera(map: MapLibreMap): () => void {
  let active = false;

  const ensureSource = (): void => {
    if (map.getSource(DIORAMA_DEM_SOURCE)) return;
    map.addSource(DIORAMA_DEM_SOURCE, {
      type: 'raster-dem',
      tiles: [TERRAIN_TILES_URL],
      encoding: 'terrarium',
      tileSize: 256,
      maxzoom: 13,
    });
  };

  const apply = (): void => {
    const zoom = map.getZoom();
    if (!active && zoom >= TERRAIN_ON_ZOOM) {
      ensureSource();
      map.setTerrain({ source: DIORAMA_DEM_SOURCE, exaggeration: TERRAIN_EXAGGERATION });
      active = true;
    } else if (active && zoom < TERRAIN_OFF_ZOOM) {
      map.setTerrain(null);
      active = false;
    }
  };

  map.on('zoom', apply);
  apply();

  return () => {
    map.off('zoom', apply);
    if (active) map.setTerrain(null);
    active = false;
  };
}

if (import.meta.env.DEV) {
  (window as unknown as { __terrain?: { enableDioramaCamera: typeof enableDioramaCamera } }).__terrain = { enableDioramaCamera };
}
