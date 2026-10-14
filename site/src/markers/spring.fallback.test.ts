import { describe, expect, it } from 'vitest';
import { bounceEasing, springEasing } from './spring';

// No CSS global in this environment, so spring.ts takes its non-linear() fallback path.
const DEFAULT_FALLBACK = 'cubic-bezier(0.34, 1.56, 0.64, 1)';

describe('spring easing without linear() support', () => {
  it('returns the default overshoot curve for springs', () => {
    expect(springEasing(0.5)).toBe(DEFAULT_FALLBACK);
  });

  it('returns the caller-supplied fallback when given one', () => {
    expect(springEasing(0.5, 'ease-out')).toBe('ease-out');
  });

  it('uses the same fallback curve for bounces but still reports the impact time', () => {
    const { easing, impact } = bounceEasing(0.38, 2);
    expect(easing).toBe(DEFAULT_FALLBACK);
    expect(impact).toBeGreaterThan(0);
    expect(impact).toBeLessThan(1);
  });
});
