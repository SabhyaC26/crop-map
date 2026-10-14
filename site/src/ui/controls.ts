import type { Map as MapLibreMap } from 'maplibre-gl';
import type { CropIndex } from '../data/crops';
import type { EconomicsIndex } from '../data/economics';
import type { FieldsLayer } from '../layers/fields';
import { createEmphasis, type HighlightSink, type IconManifest, type MarkerSink, type RegionsSearch } from './emphasis';
import { createLegend } from './legend';
import { createProfitFilter } from './profit-filter';
import { createSearch } from './search';

export interface ControlsOptions {
  map: MapLibreMap;
  crops: CropIndex;
  economics: EconomicsIndex;
  fields: FieldsLayer;
  regionsSearch: RegionsSearch;
  /** Where a crop's region markers sit, so the search fit can include far-flung farms. */
  cropPoints(cropId: number): readonly [number, number][];
  manifest: IconManifest;
  overview: HighlightSink;
  markers?: MarkerSink;
  searchSlot: HTMLElement;
  legendSlot: HTMLElement;
  popupRoot: HTMLElement;
}

export interface Controls {
  setMarkers(markers: MarkerSink): void;
  destroy(): void;
}

/** Crop search, legend and profit filter, driving the shared emphasis state for fields and markers. */
export function initControls(opts: ControlsOptions): Controls {
  const { map, crops, economics, fields, overview, regionsSearch, cropPoints, manifest, searchSlot, legendSlot, popupRoot } =
    opts;
  const emphasis = createEmphasis({ crops, fields, overview, markers: opts.markers });
  const search = createSearch({ map, crops, regionsSearch, cropPoints, manifest, emphasis, slot: searchSlot });
  const legend = createLegend({ map, crops, manifest, emphasis, slot: legendSlot, popupRoot });
  const profitFilter = createProfitFilter({ economics, emphasis, slot: searchSlot });

  return {
    setMarkers: (markers) => emphasis.setMarkers(markers),
    destroy() {
      profitFilter.destroy();
      legend.destroy();
      search.destroy();
      emphasis.setMarkers(undefined);
      emphasis.clear();
    },
  };
}
