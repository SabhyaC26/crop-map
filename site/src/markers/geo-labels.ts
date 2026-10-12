import type { Map as MapLibreMap } from 'maplibre-gl';
import { GEO_LABELS_SOURCE, GEO_POINT_LABEL_LAYER_IDS } from '../style/storybook';
import type { Rect } from './collision';

/** Negative: a label only counts as covered when the marker really reaches into its text (label boxes carry their own padding). */
const QUERY_INSET = 3;

export interface GeoLabelGuard {
  /** Hides every storybook point label (and city name) that sits under a placed marker box; shows the rest. */
  update(placed: readonly Rect[]): void;
  destroy(): void;
}

/**
 * Markers are the heroes, so a place name under an emoji disappears instead. The hidden flag is a
 * feature-state (opacity 0), which keeps the label in the collision index: it is still found by the
 * next query, so it does not flicker back while the marker is on top of it.
 */
export function createGeoLabelGuard(map: MapLibreMap): GeoLabelGuard {
  const hidden = new Set<string>();

  const setHidden = (name: string, value: boolean): void => {
    if (value) hidden.add(name);
    else hidden.delete(name);
    map.setFeatureState({ source: GEO_LABELS_SOURCE, id: name }, { hidden: value });
  };

  const covered = (placed: readonly Rect[]): Set<string> => {
    const layers = GEO_POINT_LABEL_LAYER_IDS.filter((id) => map.getLayer(id) !== undefined);
    const names = new Set<string>();
    if (layers.length === 0) return names;
    for (const r of placed) {
      if (r.x1 - r.x0 <= 2 * QUERY_INSET || r.y1 - r.y0 <= 2 * QUERY_INSET) continue;
      const hits = map.queryRenderedFeatures(
        [
          [r.x0 + QUERY_INSET, r.y0 + QUERY_INSET],
          [r.x1 - QUERY_INSET, r.y1 - QUERY_INSET],
        ],
        { layers },
      );
      for (const f of hits) names.add(String(f.properties.name));
    }
    return names;
  };

  return {
    update(placed) {
      if (!map.getSource(GEO_LABELS_SOURCE)) return;
      const next = covered(placed);
      for (const name of next) if (!hidden.has(name)) setHidden(name, true);
      for (const name of [...hidden]) if (!next.has(name)) setHidden(name, false);
    },
    destroy() {
      for (const name of [...hidden]) setHidden(name, false);
    },
  };
}
