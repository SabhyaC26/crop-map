import { CROPS_URL } from '../config';

export interface Crop {
  cropId: number;
  dwrCode: string;
  name: string;
  icon: string;
  color: string;
  group: string;
  /** 12 booleans Jan..Dec, or null when the crop has no harvest calendar. */
  harvest: readonly boolean[] | null;
}

interface CropRecord {
  crop_id: number;
  dwr_code: string;
  name: string;
  icon: string;
  color: string;
  group: string;
  harvest: boolean[] | null;
}

export interface CropIndex {
  readonly list: readonly Crop[];
  get(cropId: number): Crop | undefined;
  /** Parses the comma-joined `other` tile property into known crops (unknown ids dropped). */
  parseOther(other: unknown): Crop[];
  /** Crop ids whose harvest calendar includes the 0-based month. */
  harvestingIn(month: number): number[];
}

export async function loadCrops(url: string = CROPS_URL): Promise<CropIndex> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`crops.json: HTTP ${res.status}`);
  const records = (await res.json()) as CropRecord[];
  return buildCropIndex(records);
}

export function buildCropIndex(records: readonly CropRecord[]): CropIndex {
  const list: Crop[] = records.map((r) => ({
    cropId: r.crop_id,
    dwrCode: r.dwr_code,
    name: r.name,
    icon: r.icon,
    color: r.color,
    group: r.group,
    harvest: r.harvest && r.harvest.length === 12 ? r.harvest : null,
  }));
  const byId = new Map(list.map((c) => [c.cropId, c]));
  return {
    list,
    get: (id) => byId.get(id),
    parseOther(other) {
      if (typeof other !== 'string' || other === '') return [];
      const out: Crop[] = [];
      for (const part of other.split(',')) {
        const crop = byId.get(Number(part));
        if (crop) out.push(crop);
      }
      return out;
    },
    harvestingIn: (month) => list.filter((c) => c.harvest?.[month] === true).map((c) => c.cropId),
  };
}
