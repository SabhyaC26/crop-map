import type { CropIndex } from '../data/crops';
import type { FieldsLayer } from '../layers/fields';
import type { loadIconManifest } from '../lib/icons';

export type IconManifest = Awaited<ReturnType<typeof loadIconManifest>>;

export type { RegionsSearch, SearchPlace, SearchTarget } from '../markers/regions';

/** Region emoji markers: faded out entirely while a crop is pinned on. */
export interface MarkerSink {
  setHidden(hidden: boolean): void;
}

/** Confetti overview layer: lights up only the given crops. */
export interface HighlightSink {
  setHighlight(cropIds: readonly number[] | null): void;
}

export interface EmphasisState {
  /** Crop picked in search, if any. Always a member of `selected` while set. */
  readonly search: number | null;
  /** Crops pinned on by search or the legend. */
  readonly selected: ReadonlySet<number>;
  /** Crop being hovered in the legend: shown in addition to `selected`, without committing. */
  readonly preview: number | null;
  /** Crops shown at full strength; null means nothing is dimmed. */
  readonly active: ReadonlySet<number> | null;
}

export interface EmphasisController {
  readonly state: EmphasisState;
  /** Search selects exactly one crop (or clears everything with null). */
  setSearch(cropId: number | null): void;
  /** Legend toggle: adds or removes one crop from the selection. */
  toggle(cropId: number): void;
  clear(): void;
  setPreview(cropId: number | null): void;
  setMarkers(markers: MarkerSink | undefined): void;
  subscribe(listener: (state: EmphasisState) => void): () => void;
}

interface EmphasisOptions {
  crops: CropIndex;
  fields: FieldsLayer;
  overview: HighlightSink;
  markers: MarkerSink | undefined;
}

const sameSet = (a: ReadonlySet<number> | null, b: ReadonlySet<number> | null): boolean => {
  if (a === b) return true;
  if (a === null || b === null || a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
};

function derive(search: number | null, selected: ReadonlySet<number>, preview: number | null): EmphasisState {
  if (selected.size === 0 && preview === null) return { search, selected, preview, active: null };
  const active = new Set(selected);
  if (preview !== null) active.add(preview);
  return { search, selected, preview, active };
}

export function createEmphasis({ fields, overview, markers: initialMarkers }: EmphasisOptions): EmphasisController {
  let markers = initialMarkers;
  let search: number | null = null;
  let selected: ReadonlySet<number> = new Set();
  let preview: number | null = null;
  let state = derive(search, selected, preview);
  const listeners = new Set<(s: EmphasisState) => void>();

  /** A hovered legend preview alone leaves the emoji markers be; only a pinned crop clears them. */
  const hidesMarkers = (): boolean => state.selected.size > 0;

  const applyTargets = (): void => {
    const ids = state.active === null ? null : [...state.active];
    fields.setEmphasis(ids);
    overview.setHighlight(ids);
    markers?.setHidden(hidesMarkers());
  };

  const update = (): void => {
    const next = derive(search, selected, preview);
    const targetsChanged = !sameSet(state.active, next.active);
    const hiddenBefore = hidesMarkers();
    state = next;
    if (targetsChanged) applyTargets();
    else if (hiddenBefore !== hidesMarkers()) markers?.setHidden(hidesMarkers());
    for (const fn of listeners) fn(state);
  };

  return {
    get state() {
      return state;
    },
    setSearch(cropId) {
      search = cropId;
      selected = cropId === null ? new Set() : new Set([cropId]);
      update();
    },
    toggle(cropId) {
      const next = new Set(selected);
      if (!next.delete(cropId)) next.add(cropId);
      selected = next;
      if (search !== null && !next.has(search)) search = null;
      update();
    },
    clear() {
      search = null;
      selected = new Set();
      update();
    },
    setPreview(cropId) {
      if (cropId === preview) return;
      preview = cropId;
      update();
    },
    setMarkers(next) {
      markers = next;
      markers?.setHidden(hidesMarkers());
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
