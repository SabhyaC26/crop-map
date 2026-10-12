import type { Map as MapLibreMap } from 'maplibre-gl';
import type { CropIndex } from '../data/crops';
import type { FieldsLayer } from '../layers/fields';
import { createEmphasis, type EmphasisSink, type IconManifest, type RegionsSearch } from './emphasis';
import { createSearch } from './search';

export interface ControlsOptions {
  map: MapLibreMap;
  crops: CropIndex;
  fields: FieldsLayer;
  regionsSearch: RegionsSearch;
  manifest: IconManifest;
  markers?: EmphasisSink;
  searchSlot: HTMLElement;
}

export interface Controls {
  setMarkers(markers: EmphasisSink): void;
  destroy(): void;
}

/** Crop search, driving the shared emphasis state for fields and markers. */
export function initControls(opts: ControlsOptions): Controls {
  const { map, crops, fields, regionsSearch, manifest, searchSlot } = opts;
  const emphasis = createEmphasis({ crops, fields, markers: opts.markers });
  const search = createSearch({ map, crops, regionsSearch, manifest, emphasis, slot: searchSlot });

  return {
    setMarkers: (markers) => emphasis.setMarkers(markers),
    destroy() {
      search.destroy();
      emphasis.setMarkers(undefined);
      emphasis.setSearch(null);
    },
  };
}
