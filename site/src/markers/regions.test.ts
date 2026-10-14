import { afterEach, describe, expect, it, vi } from 'vitest';
import { cropRegionPoints, loadRegions, type RegionSet } from './regions';

interface FeatureFixture {
  geometry: { coordinates: number[] };
  properties: { id: string; crop_id: number; acres: number; label: string; rank: number; parent?: string };
}

const feature = (over: Partial<FeatureFixture['properties']> & { coords?: number[] }): FeatureFixture => {
  const { coords = [-120, 36], ...properties } = over;
  return {
    geometry: { coordinates: coords },
    properties: { id: 'r', crop_id: 1, acres: 10, label: 'Region', rank: 0, ...properties },
  };
};

const regionsFile = (coarse: FeatureFixture[], fine: FeatureFixture[]) => ({
  coarse: { features: coarse },
  fine: { features: fine },
  search: { kern: { center: [-118.9, 35.4], zoom: 8, label: 'Kern', acres_total: 500 } },
});

const stubFetch = (response: Response) => {
  const fetchMock = vi.fn(async (_url: string) => response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loadRegions', () => {
  it('sorts each level by rank and tags coarse and fine regions with their level', async () => {
    stubFetch(
      jsonResponse(
        regionsFile(
          [feature({ id: 'c2', rank: 2 }), feature({ id: 'c1', rank: 1 })],
          [feature({ id: 'f1', rank: 1, parent: 'c1' })],
        ),
      ),
    );
    const set = await loadRegions('/regions.json');
    expect(set.coarse.map((r) => r.id)).toEqual(['c1', 'c2']);
    expect(set.coarse.every((r) => r.level === 'coarse')).toBe(true);
    expect(set.fine.map((r) => r.level)).toEqual(['fine']);
  });

  it('keeps the containing coarse id for fine regions and null for coarse ones', async () => {
    stubFetch(jsonResponse(regionsFile([feature({ id: 'c1' })], [feature({ id: 'f1', parent: 'c1' })])));
    const set = await loadRegions('/regions.json');
    expect(set.coarse[0]?.parent).toBeNull();
    expect(set.fine[0]?.parent).toBe('c1');
  });

  it('keeps only longitude and latitude from the geometry', async () => {
    stubFetch(jsonResponse(regionsFile([feature({ id: 'c1', coords: [-121.25, 37.5, 42] })], [])));
    const set = await loadRegions('/regions.json');
    expect(set.coarse[0]?.lngLat).toEqual([-121.25, 37.5]);
  });

  it('passes the search index through unchanged', async () => {
    const file = regionsFile([], []);
    stubFetch(jsonResponse(file));
    const set = await loadRegions('/regions.json');
    expect(set.search).toEqual(file.search);
  });

  it('reports the HTTP status when the regions file cannot be loaded', async () => {
    stubFetch(new Response('nope', { status: 404 }));
    await expect(loadRegions('/missing.json')).rejects.toThrow('regions.json: HTTP 404');
  });

  it('fetches the configured regions URL by default', async () => {
    const fetchMock = stubFetch(jsonResponse(regionsFile([], [])));
    await loadRegions();
    expect(fetchMock).toHaveBeenCalledWith('/data/regions.json');
  });
});

describe('cropRegionPoints', () => {
  const set: RegionSet = {
    coarse: [
      { id: 'c-almond', level: 'coarse', cropId: 1, acres: 10, label: 'A', rank: 0, parent: null, lngLat: [-120, 36] },
      { id: 'c-grape', level: 'coarse', cropId: 2, acres: 10, label: 'G', rank: 1, parent: null, lngLat: [-119, 35] },
    ],
    fine: [
      { id: 'f-almond', level: 'fine', cropId: 1, acres: 5, label: 'Fa', rank: 0, parent: 'c-almond', lngLat: [-120.5, 36.5] },
    ],
    search: {},
  };

  it('collects the points of one crop across both levels, excluding other crops', () => {
    expect(cropRegionPoints(set, 1)).toEqual([
      [-120, 36],
      [-120.5, 36.5],
    ]);
  });

  it('returns no points for a crop with no regions', () => {
    expect(cropRegionPoints(set, 99)).toEqual([]);
  });
});
