import { describe, expect, it } from 'vitest';
import type { Region } from './regions';
import { bandOpacity, bandScale, coarseCap, distanceKm, inBand, SPLIT_ZOOM, sizeScale } from './zoom';

const region = (over: Partial<Region>): Region => ({
  id: 'r',
  level: 'coarse',
  cropId: 1,
  acres: 100,
  label: 'Region',
  rank: 0,
  parent: null,
  lngLat: [0, 0],
  ...over,
});

const zoomSteps = (from: number, to: number, step = 0.05): number[] => {
  const out: number[] = [];
  for (let z = from; z <= to + 1e-9; z += step) out.push(Number(z.toFixed(4)));
  return out;
};

const isNonIncreasing = (values: readonly number[]): boolean =>
  values.every((v, i) => i === 0 || v <= (values[i - 1] ?? Infinity) + 1e-12);
const isNonDecreasing = (values: readonly number[]): boolean =>
  values.every((v, i) => i === 0 || v >= (values[i - 1] ?? -Infinity) - 1e-12);

describe('bandOpacity', () => {
  it('keeps coarse markers mostly visible through the split (they dim only to 80%)', () => {
    const values = zoomSteps(0, 12).map((z) => bandOpacity('coarse', z));
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0.8 - 1e-9);
    expect(Math.max(...values)).toBe(1);
  });

  it('coarse markers stay fully opaque before the dimming starts', () => {
    expect(bandOpacity('coarse', 6)).toBe(1);
    expect(bandOpacity('coarse', 7.1)).toBe(1);
  });

  it('fine markers are fully visible at low zoom, half faded at the midpoint of the fade, and gone at the end', () => {
    expect(bandOpacity('fine', 9)).toBe(1);
    expect(bandOpacity('fine', 10.1)).toBeCloseTo(0.5, 5);
    expect(bandOpacity('fine', 11)).toBe(0);
  });

  it.each(['coarse', 'fine'] as const)('%s opacity never increases as you zoom in', (level) => {
    expect(isNonIncreasing(zoomSteps(0, 14).map((z) => bandOpacity(level, z)))).toBe(true);
  });
});

describe('bandScale', () => {
  it('grows coarse markers as you zoom in, clamped at both ends of the coarse range', () => {
    const values = zoomSteps(0, 12).map((z) => bandScale('coarse', z, 1));
    expect(isNonDecreasing(values)).toBe(true);
    expect(bandScale('coarse', 0, 1)).toBe(bandScale('coarse', 4.6, 1));
    expect(bandScale('coarse', 12, 1)).toBe(bandScale('coarse', SPLIT_ZOOM, 1));
  });

  it('keeps fine markers within their scale bounds at every zoom', () => {
    const values = zoomSteps(0, 14).map((z) => bandScale('fine', z, 1));
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0.86 - 1e-9);
    expect(Math.max(...values)).toBeLessThanOrEqual(1.2 + 1e-9);
  });

  it.each(['coarse', 'fine'] as const)('%s markers shrink only slightly as their opacity goes to zero', (level) => {
    const full = bandScale(level, 8, 1);
    const gone = bandScale(level, 8, 0);
    expect(gone).toBeLessThan(full);
    expect(gone / full).toBeGreaterThanOrEqual(0.88);
  });
});

describe('inBand', () => {
  it('keeps coarse markers attached through the split so the merge animation can finish', () => {
    expect(inBand('coarse', SPLIT_ZOOM + 0.3)).toBe(true);
    expect(inBand('coarse', 8.5)).toBe(false);
  });

  it('attaches fine markers around the split and detaches them once fully faded', () => {
    expect(inBand('fine', 7.5)).toBe(true);
    expect(inBand('fine', 6.5)).toBe(false);
    expect(inBand('fine', 11)).toBe(false);
  });

  it('leaves no zoom level below the fine fade where neither band is attached', () => {
    // Above the fine band's upper edge nothing should be attached, so only the covered range is checked.
    for (const z of zoomSteps(0, 10.5, 0.1)) {
      expect(inBand('coarse', z) || inBand('fine', z), `zoom ${z}`).toBe(true);
    }
  });
});

describe('sizeScale', () => {
  it('maps the smallest and largest regions to the bottom and top of the coarse size range', () => {
    const small = region({ id: 'small', acres: 100 });
    const large = region({ id: 'large', acres: 900 });
    const size = sizeScale([small, large], 'coarse');
    expect(size(small)).toBe(30);
    expect(size(large)).toBe(50);
  });

  it('interpolates on the square root of acres, not on acres themselves', () => {
    const empty = region({ acres: 0 });
    const middle = region({ acres: 100 });
    const top = region({ acres: 400 });
    const size = sizeScale([empty, middle, top], 'coarse');
    // sqrt(100) is halfway between sqrt(0) and sqrt(400), so the middle region lands at the midpoint size.
    expect(size(middle)).toBe(40);
    // A linear mapping would put it a quarter of the way up instead.
    expect(size(middle)).not.toBe(35);
  });

  it('uses the fine size range for fine regions', () => {
    const small = region({ level: 'fine', acres: 100 });
    const large = region({ level: 'fine', acres: 900 });
    const size = sizeScale([small, large], 'fine');
    expect(size(small)).toBe(32);
    expect(size(large)).toBe(52);
  });
});

describe('coarseCap', () => {
  it('caps the whole-state view tightly, loosens as you zoom, then removes the cap', () => {
    expect(coarseCap(5, false)).toBeLessThan(coarseCap(6.5, false));
    expect(coarseCap(6.5, false)).toBeLessThan(coarseCap(7, false));
    expect(coarseCap(7, false)).toBe(Infinity);
  });

  it('shows fewer coarse markers on compact screens at every capped zoom', () => {
    expect(coarseCap(5, true)).toBeLessThan(coarseCap(5, false));
    expect(coarseCap(6.5, true)).toBeLessThan(coarseCap(6.5, false));
    expect(coarseCap(7, true)).toBe(coarseCap(7, false));
  });

  it.each([true, false])('the cap never shrinks as you zoom in (compact=%s)', (compact) => {
    expect(isNonDecreasing(zoomSteps(0, 9).map((z) => coarseCap(z, compact)))).toBe(true);
  });
});

describe('distanceKm', () => {
  it('is zero between identical points and symmetric', () => {
    expect(distanceKm([-119.8, 36.7], [-119.8, 36.7])).toBe(0);
    const a: [number, number] = [-121.5, 38.6];
    const b: [number, number] = [-118.2, 34.1];
    expect(distanceKm(a, b)).toBeCloseTo(distanceKm(b, a), 9);
  });

  it('measures one degree of latitude as roughly 111 km', () => {
    expect(distanceKm([0, 0], [0, 1])).toBeCloseTo(111.195, 2);
  });

  it('shrinks a degree of longitude with latitude (60 degrees north is half the equator)', () => {
    const equator = distanceKm([0, 0], [1, 0]);
    const sixtyNorth = distanceKm([0, 60], [1, 60]);
    expect(sixtyNorth / equator).toBeCloseTo(0.5, 2);
  });

  it('takes the short way across the antimeridian', () => {
    expect(distanceKm([179, 0], [-179, 0])).toBeCloseTo(distanceKm([0, 0], [2, 0]), 6);
  });
});
