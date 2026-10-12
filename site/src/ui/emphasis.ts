import type { CropIndex } from '../data/crops';
import type { FieldsLayer } from '../layers/fields';
import type { loadIconManifest } from '../lib/icons';

export type IconManifest = Awaited<ReturnType<typeof loadIconManifest>>;

export interface SearchTarget {
  center: [number, number];
  zoom: number;
  label: string;
  acres_total: number;
}

export type RegionsSearch = Record<string, SearchTarget>;

export interface EmphasisSink {
  setEmphasis(ids: Set<number> | null): void;
}

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export interface EmphasisState {
  /** Crop picked in search, if any. */
  readonly search: number | null;
  /** 0-based month, or null for "All year". */
  readonly month: number | null;
  /** Crops shown at full strength; null means nothing is dimmed. */
  readonly active: ReadonlySet<number> | null;
  /** Crops that should "bloom": harvesting in the selected month. Empty when no month is active. */
  readonly bloom: readonly number[];
  /** Gentle note for the month pill when search and month disagree. */
  readonly hint: string | null;
}

export interface EmphasisController {
  readonly state: EmphasisState;
  setSearch(cropId: number | null): void;
  setMonth(month: number | null): void;
  setMarkers(markers: EmphasisSink | undefined): void;
  subscribe(listener: (state: EmphasisState) => void): () => void;
}

interface EmphasisOptions {
  crops: CropIndex;
  fields: FieldsLayer;
  markers: EmphasisSink | undefined;
}

const sameSet = (a: ReadonlySet<number> | null, b: ReadonlySet<number> | null): boolean => {
  if (a === b) return true;
  if (a === null || b === null || a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
};

function derive(crops: CropIndex, search: number | null, month: number | null): EmphasisState {
  const harvesting = month === null ? null : crops.harvestingIn(month);
  if (search === null) {
    return {
      search,
      month,
      active: harvesting === null ? null : new Set(harvesting),
      bloom: harvesting ?? [],
      hint: null,
    };
  }
  const crop = crops.get(search);
  const inSeason = harvesting?.includes(search) ?? false;
  let hint: string | null = null;
  if (month !== null && !inSeason) {
    hint =
      crop?.harvest === null
        ? `No harvest calendar for ${crop.name}`
        : `Not in harvest in ${MONTH_NAMES[month]}`;
  }
  return { search, month, active: new Set([search]), bloom: inSeason ? [search] : [], hint };
}

export function createEmphasis({ crops, fields, markers: initialMarkers }: EmphasisOptions): EmphasisController {
  let markers = initialMarkers;
  let search: number | null = null;
  let month: number | null = null;
  let state = derive(crops, search, month);
  const listeners = new Set<(s: EmphasisState) => void>();

  const applyTargets = (): void => {
    fields.setEmphasis(state.active === null ? null : [...state.active]);
    markers?.setEmphasis(state.active === null ? null : new Set(state.active));
  };

  const update = (): void => {
    const next = derive(crops, search, month);
    const targetsChanged = !sameSet(state.active, next.active);
    state = next;
    if (targetsChanged) applyTargets();
    for (const fn of listeners) fn(state);
  };

  return {
    get state() {
      return state;
    },
    setSearch(cropId) {
      if (cropId === search) return;
      search = cropId;
      update();
    },
    setMonth(m) {
      if (m === month) return;
      month = m;
      update();
    },
    setMarkers(next) {
      markers = next;
      if (state.active !== null) markers?.setEmphasis(new Set(state.active));
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
