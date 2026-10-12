import { REGIONS_URL } from '../config';

export type RegionLevel = 'coarse' | 'fine';

export interface Region {
  id: string;
  level: RegionLevel;
  cropId: number;
  acres: number;
  label: string;
  rank: number;
  /** Fine regions only: id of the containing coarse region. */
  parent: string | null;
  lngLat: [number, number];
}

export interface RegionSet {
  coarse: readonly Region[];
  fine: readonly Region[];
}

interface RegionFeature {
  geometry: { coordinates: [number, number] };
  properties: { id: string; crop_id: number; acres: number; label: string; rank: number; parent?: string };
}

interface RegionsFile {
  coarse: { features: RegionFeature[] };
  fine: { features: RegionFeature[] };
}

const toRegions = (features: readonly RegionFeature[], level: RegionLevel): Region[] =>
  features
    .map((f) => ({
      id: f.properties.id,
      level,
      cropId: f.properties.crop_id,
      acres: f.properties.acres,
      label: f.properties.label,
      rank: f.properties.rank,
      parent: f.properties.parent ?? null,
      lngLat: [f.geometry.coordinates[0], f.geometry.coordinates[1]] as [number, number],
    }))
    .sort((a, b) => a.rank - b.rank);

export async function loadRegions(url: string = REGIONS_URL): Promise<RegionSet> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`regions.json: HTTP ${res.status}`);
  const file = (await res.json()) as RegionsFile;
  return { coarse: toRegions(file.coarse.features, 'coarse'), fine: toRegions(file.fine.features, 'fine') };
}
