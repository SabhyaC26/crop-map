import { describe, expect, it } from 'vitest';
import type { SearchTarget } from '../markers/regions';
import { resolveBbox, resolvePlaces } from './places';

const base: SearchTarget = {
  center: [-119.5, 36.5],
  zoom: 8,
  label: 'Fresno',
  acres_total: 500_000,
};

describe('resolvePlaces', () => {
  it('returns the shipped places when present', () => {
    const places = [
      { center: [-120, 36] as [number, number], zoom: 10, label: 'A', acres: 300 },
      { center: [-119, 37] as [number, number], zoom: 10, label: 'B', acres: 100 },
    ];
    expect(resolvePlaces({ ...base, places })).toEqual(places);
  });

  it('builds one hotspot from the primary target for older builds without places', () => {
    expect(resolvePlaces(base)).toEqual([
      { center: [-119.5, 36.5], zoom: 8, label: 'Fresno', acres: 500_000 },
    ]);
  });

  it('treats an empty places array as absent and falls back to the primary target', () => {
    expect(resolvePlaces({ ...base, places: [] })).toEqual([
      { center: [-119.5, 36.5], zoom: 8, label: 'Fresno', acres: 500_000 },
    ]);
  });
});

describe('resolveBbox', () => {
  it('returns the shipped bbox when present', () => {
    const bbox = [-120.8, 35.4, -119.1, 37.7] as const;
    expect(resolveBbox({ ...base, bbox: [...bbox] })).toEqual(bbox);
  });

  it('pads the centre by 0.6 degrees in each direction when bbox is absent', () => {
    const [w, s, e, n] = resolveBbox(base);
    expect(w).toBeCloseTo(-120.1);
    expect(s).toBeCloseTo(35.9);
    expect(e).toBeCloseTo(-118.9);
    expect(n).toBeCloseTo(37.1);
  });
});
