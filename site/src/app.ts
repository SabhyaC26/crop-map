import type { Map as MapLibreMap } from 'maplibre-gl';
import { loadCrops, type CropIndex } from './data/crops';
import { addFieldsLayers, type FieldsLayer } from './layers/fields';
import { loadIconManifest, registerCropIcons } from './lib/icons';
import { createRegionMarkers, loadRegions, type RegionMarkers } from './markers';
import { FIELDS_BEFORE_LAYER_ID } from './style/basemap';
import { initControls, type Controls } from './ui/controls';
import { createFieldPopup, type FieldPopup } from './ui/popup';

export interface CropMapApp {
  map: MapLibreMap;
  crops: CropIndex;
  fields: FieldsLayer;
  popup: FieldPopup;
  markers: RegionMarkers;
  controls: Controls;
}

export interface CropMapSlots {
  popupRoot: HTMLElement;
  searchSlot: HTMLElement;
  monthSlot: HTMLElement;
}

// isStyleLoaded() also reports false while tiles load, so probe for a known basemap layer instead.
const styleReady = (map: MapLibreMap): boolean => {
  try {
    return map.getLayer(FIELDS_BEFORE_LAYER_ID) !== undefined;
  } catch {
    return false;
  }
};

const whenStyleReady = (map: MapLibreMap): Promise<void> =>
  styleReady(map)
    ? Promise.resolve()
    : new Promise((resolve) => {
        map.once('style.load', () => resolve());
      });

/** Loads crops, icons and regions, then adds fields, popup, region markers and controls to the basemap. */
export async function initCropMap(map: MapLibreMap, slots: CropMapSlots): Promise<CropMapApp> {
  const [crops, iconManifest, regions] = await Promise.all([
    loadCrops(),
    loadIconManifest(),
    loadRegions(),
    whenStyleReady(map),
  ]);
  await registerCropIcons(map, crops.list);
  const fields = addFieldsLayers(map, crops);
  const popup = createFieldPopup({ map, crops, fields, root: slots.popupRoot, iconManifest });
  const markers = createRegionMarkers(map, regions, crops, iconManifest);
  const controls = initControls({
    map,
    crops,
    fields,
    regionsSearch: regions.search,
    manifest: iconManifest,
    markers,
    searchSlot: slots.searchSlot,
    monthSlot: slots.monthSlot,
  });
  return { map, crops, fields, popup, markers, controls };
}
