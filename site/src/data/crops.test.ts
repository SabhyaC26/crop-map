import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildCropIndex, loadCrops } from './crops';
import bundledCrops from '../../public/data/crops.json?raw';
import bundledManifest from '../../public/icons/manifest.json?raw';

const month = (...on: number[]): boolean[] => Array.from({ length: 12 }, (_, i) => on.includes(i));

const RECORDS = [
  { crop_id: 1, dwr_code: 'D12', name: 'Almonds', icon: 'almond', color: '#f0b5ca', group: 'Tree nuts', harvest: month(7, 8, 9) },
  { crop_id: 2, dwr_code: 'V', name: 'Grapes', icon: 'grapes', color: '#b29bdf', group: 'Vineyards', harvest: null },
  { crop_id: 3, dwr_code: 'F', name: 'Tulips', icon: 'tulip', color: '#ffaa00', group: 'Nursery & flowers', harvest: month(2, 3) },
];

describe('buildCropIndex', () => {
  it('maps snake_case records onto camelCase crops', () => {
    const index = buildCropIndex(RECORDS);
    expect(index.get(1)).toEqual({
      cropId: 1,
      dwrCode: 'D12',
      name: 'Almonds',
      icon: 'almond',
      color: '#f0b5ca',
      group: 'Tree nuts',
      harvest: month(7, 8, 9),
    });
  });

  it('treats a harvest calendar that is not exactly 12 months as absent', () => {
    const index = buildCropIndex([{ ...RECORDS[0]!, harvest: [true, false] }]);
    expect(index.get(1)?.harvest).toBeNull();
  });

  it('returns undefined for ids that are not in the index', () => {
    expect(buildCropIndex(RECORDS).get(99)).toBeUndefined();
  });

  describe('parseOther', () => {
    const index = buildCropIndex(RECORDS);

    it('resolves comma-joined ids in the order given', () => {
      expect(index.parseOther('3,1').map((c) => c.cropId)).toEqual([3, 1]);
    });

    it('drops ids that do not match a known crop', () => {
      expect(index.parseOther('1,99,2').map((c) => c.cropId)).toEqual([1, 2]);
    });

    it('returns nothing for empty, missing, or non-string values', () => {
      expect(index.parseOther('')).toEqual([]);
      expect(index.parseOther(undefined)).toEqual([]);
      expect(index.parseOther(null)).toEqual([]);
      expect(index.parseOther(2)).toEqual([]);
    });

    it('ignores a trailing comma rather than matching a phantom id', () => {
      expect(index.parseOther('1,').map((c) => c.cropId)).toEqual([1]);
    });

    it.fails('de-duplicates repeated ids so the same crop is not listed twice', () => {
      expect(index.parseOther('1,1').map((c) => c.cropId)).toEqual([1]);
    });
  });

  describe('harvestingIn', () => {
    const index = buildCropIndex(RECORDS);

    it('lists crops harvesting in the given 0-based month', () => {
      expect(index.harvestingIn(7)).toEqual([1]);
      expect(index.harvestingIn(2)).toEqual([3]);
      expect(index.harvestingIn(0)).toEqual([]);
    });

    it('never lists crops without a harvest calendar', () => {
      for (let m = 0; m < 12; m++) {
        expect(index.harvestingIn(m)).not.toContain(2);
      }
    });

    it('returns nothing for months outside 0..11', () => {
      expect(index.harvestingIn(12)).toEqual([]);
      expect(index.harvestingIn(-1)).toEqual([]);
    });
  });
});

describe('loadCrops', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches the given url and indexes the records it returns', async () => {
    const fetchMock = vi.fn((_url: string) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(RECORDS) } as Response));
    vi.stubGlobal('fetch', fetchMock);
    const index = await loadCrops('/custom/crops.json');
    expect(fetchMock).toHaveBeenCalledWith('/custom/crops.json');
    expect(index.list.map((c) => c.name)).toEqual(['Almonds', 'Grapes', 'Tulips']);
  });

  it('rejects with the HTTP status when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string) => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve([]) } as Response)));
    await expect(loadCrops('/missing.json')).rejects.toThrow('crops.json: HTTP 404');
  });
});

describe('bundled crops.json', () => {
  const records = JSON.parse(bundledCrops) as Parameters<typeof buildCropIndex>[0];
  const index = buildCropIndex(records);
  const manifest = JSON.parse(bundledManifest) as Record<string, string>;
  const iconFiles = new Set(Object.keys(import.meta.glob('../../public/icons/*', { eager: false })).map((p) => p.split('/').pop() ?? ''));

  it('has unique crop ids', () => {
    const ids = index.list.map((c) => c.cropId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has unique crop names and DWR codes', () => {
    expect(new Set(index.list.map((c) => c.name)).size).toBe(index.list.length);
    expect(new Set(index.list.map((c) => c.dwrCode)).size).toBe(index.list.length);
  });

  it('gives every crop a name, DWR code, group, and icon', () => {
    for (const c of index.list) {
      expect(c.name, `crop ${c.cropId} name`).not.toBe('');
      expect(c.dwrCode, `crop ${c.cropId} dwrCode`).not.toBe('');
      expect(c.group, `crop ${c.cropId} group`).not.toBe('');
      expect(c.icon, `crop ${c.cropId} icon`).not.toBe('');
    }
  });

  it('gives every crop a six-digit hex colour', () => {
    for (const c of index.list) {
      expect(c.color, `crop ${c.cropId} colour`).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('keeps every raw harvest calendar at twelve months or absent', () => {
    for (const r of records) {
      expect(r.harvest === null || r.harvest.length === 12, `crop ${r.crop_id}`).toBe(true);
    }
  });

  it('gives every crop icon a manifest entry that points at a bundled file', () => {
    for (const c of index.list) {
      const file = manifest[c.icon];
      expect(file, `icon for crop ${c.cropId}`).toBeDefined();
      expect(iconFiles.has(file ?? ''), `file ${file} for crop ${c.cropId}`).toBe(true);
    }
  });

  it('can look up every crop by its id', () => {
    for (const c of index.list) {
      expect(index.get(c.cropId)).toBe(c);
    }
  });
});
