import { describe, expect, it, vi } from 'vitest';
import { bounceEasing, springEasing } from './spring';

// spring.ts decides between linear() and its fallback once, at import time, from CSS.supports.
// Advertise linear() support before the module loads so the sampled curves are under test.
vi.hoisted(() => {
  Object.defineProperty(globalThis, 'CSS', { value: { supports: () => true }, configurable: true });
});

const parseLinear = (easing: string): number[] => {
  const body = /^linear\((.*)\)$/.exec(easing)?.[1];
  if (body === undefined) throw new Error(`not a linear() easing: ${easing}`);
  return body.split(',').map(Number);
};

/** Value of the sampled curve at normalised time t (nearest sample). */
const sampleAt = (points: readonly number[], t: number): number => points[Math.round(t * (points.length - 1))] ?? NaN;

const analyticOvershoot = (damping: number): number => 1 + Math.exp((-Math.PI * damping) / Math.sqrt(1 - damping * damping));

describe('springEasing', () => {
  it('starts at 0 and ends exactly at 1', () => {
    const pts = parseLinear(springEasing(0.66));
    expect(pts[0]).toBe(0);
    expect(pts[pts.length - 1]).toBe(1);
  });

  it('overshoots the target for an underdamped spring', () => {
    expect(Math.max(...parseLinear(springEasing(0.36)))).toBeGreaterThan(1);
  });

  it.each([0.36, 0.42, 0.66])('peak overshoot for damping %s matches the second-order step response', (damping) => {
    const peak = Math.max(...parseLinear(springEasing(damping)));
    expect(peak).toBeCloseTo(analyticOvershoot(damping), 2);
  });

  it.each([0.36, 0.66])('has settled onto the target well before the end (damping %s)', (damping) => {
    const pts = parseLinear(springEasing(damping));
    expect(Math.abs(sampleAt(pts, 0.9) - 1)).toBeLessThan(0.02);
  });

  it('stays finite at critical damping, the top of the documented 0..1 range', () => {
    // wd = omega * sqrt(1 - d^2) is 0 at d = 1, so k = d*omega/wd divides by zero and the curve becomes NaN.
    const pts = parseLinear(springEasing(1));
    expect(pts.every(Number.isFinite)).toBe(true);
  });
});

describe('bounceEasing', () => {
  it('lands only at the end of the duration when there are no rebounds', () => {
    expect(bounceEasing(0.5, 0).impact).toBe(1);
  });

  it('reports the first ground contact as a fraction of the duration, before the end', () => {
    const { impact } = bounceEasing(0.38, 2);
    expect(impact).toBeGreaterThan(0);
    expect(impact).toBeLessThan(1);
  });

  it('starts at 0, lands at 1 and falls monotonically to the first impact', () => {
    const { easing, impact } = bounceEasing(0.38, 2);
    const pts = parseLinear(easing);
    expect(pts[0]).toBe(0);
    expect(pts[pts.length - 1]).toBe(1);
    const fallEnd = Math.round(impact * (pts.length - 1));
    for (let i = 1; i <= fallEnd; i++) expect(pts[i]).toBeGreaterThanOrEqual(pts[i - 1] ?? 0);
  });

  it('is on the ground at the impact sample', () => {
    const { easing, impact } = bounceEasing(0.38, 2);
    expect(sampleAt(parseLinear(easing), impact)).toBeCloseTo(1, 1);
  });

  it('rebounds peak at a depth of restitution^(2i) of the drop, with flight time 2*restitution^i', () => {
    const restitution = 0.38;
    const bounces = 2;
    const { easing } = bounceEasing(restitution, bounces);
    const pts = parseLinear(easing);

    let total = 1;
    for (let i = 1; i <= bounces; i++) total += 2 * restitution ** i;

    // Apex of bounce i sits in the middle of its flight, which starts after the previous landings.
    let start = 1;
    for (let i = 1; i <= bounces; i++) {
      const len = 2 * restitution ** i;
      const apexT = (start + len / 2) / total;
      const expectedValue = 1 - restitution ** (2 * i);
      expect(sampleAt(pts, apexT)).toBeCloseTo(expectedValue, 1);
      start += len;
    }
  });

  it('each rebound is shallower than the one before it', () => {
    const { easing, impact } = bounceEasing(0.38, 3);
    const pts = parseLinear(easing);
    const dips: number[] = [];
    for (let i = Math.round(impact * (pts.length - 1)); i < pts.length; i++) {
      const prev = pts[i - 1] ?? 1;
      const next = pts[i + 1] ?? 1;
      const v = pts[i] ?? 1;
      if (v < prev && v <= next) dips.push(v);
    }
    expect(dips.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < dips.length; i++) expect(dips[i]).toBeGreaterThan(dips[i - 1] ?? 0);
  });
});
