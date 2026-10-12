const SAMPLES = 48;

const supportsLinear =
  typeof CSS !== 'undefined' && CSS.supports('animation-timing-function', 'linear(0, 1)');

const toLinear = (fn: (t: number) => number, samples = SAMPLES): string => {
  const pts: string[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    pts.push((i === samples ? 1 : fn(t)).toFixed(4));
  }
  return `linear(${pts.join(',')})`;
};

/**
 * Damped spring baked into a CSS `linear()` easing: 0 -> 1 with overshoot.
 * `damping` 0..1 (lower = bouncier); settles inside the animation duration.
 */
export function springEasing(damping: number, fallback = 'cubic-bezier(0.34, 1.56, 0.64, 1)'): string {
  if (!supportsLinear) return fallback;
  const omega = 4.6 / (damping * 0.9);
  const wd = omega * Math.sqrt(1 - damping * damping);
  const k = (damping * omega) / wd;
  return toLinear((t) => 1 - Math.exp(-damping * omega * t) * (Math.cos(wd * t) + k * Math.sin(wd * t)));
}

export interface BounceEasing {
  easing: string;
  /** Fraction of the duration at which the first impact happens. */
  impact: number;
}

/** Ball-drop easing: 0 -> 1 falling under gravity, then `bounces` decaying rebounds. */
export function bounceEasing(restitution = 0.38, bounces = 2): BounceEasing {
  const fall = 1;
  let total = fall;
  for (let i = 1; i <= bounces; i++) total += 2 * fall * restitution ** i;
  const impact = fall / total;
  const fn = (t: number): number => {
    const time = t * total;
    if (time <= fall) return (time / fall) ** 2;
    let start = fall;
    for (let i = 1; i <= bounces; i++) {
      const len = 2 * fall * restitution ** i;
      if (time <= start + len) {
        const local = (time - start) / len - 0.5;
        const height = restitution ** (2 * i);
        return 1 - height * (1 - 4 * local * local);
      }
      start += len;
    }
    return 1;
  };
  return { easing: supportsLinear ? toLinear(fn, 64) : 'cubic-bezier(0.34, 1.56, 0.64, 1)', impact };
}
