import { describe, expect, it } from 'vitest';
import { darken, hexToRgb, mix, rgbToHex, saturate, withAlpha, type Rgb } from './color';

const HEX6 = /^#[0-9a-f]{6}$/;

/** Hue via the chroma-plane angle, independent of the HSL maths inside color.ts. */
function hueDeg([r, g, b]: Rgb): number {
  return (Math.atan2(Math.sqrt(3) * (g - b), 2 * r - g - b) * 180) / Math.PI;
}

function angleGap(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
}

function chromaSpread([r, g, b]: Rgb): number {
  return Math.max(r, g, b) - Math.min(r, g, b);
}

function lightness([r, g, b]: Rgb): number {
  return (Math.max(r, g, b) + Math.min(r, g, b)) / 2 / 255;
}

function expectChannelsWithin(actual: string, expected: string, tolerance: number): void {
  const a = hexToRgb(actual);
  const e = hexToRgb(expected);
  a.forEach((v, i) => expect(Math.abs(v - (e[i] ?? NaN))).toBeLessThanOrEqual(tolerance));
}

describe('hexToRgb and rgbToHex', () => {
  it('parses six-digit and shorthand hex, with or without the hash', () => {
    expect(hexToRgb('#ff8000')).toEqual([255, 128, 0]);
    expect(hexToRgb('FF8000')).toEqual([255, 128, 0]);
    expect(hexToRgb('f80')).toEqual([255, 136, 0]);
  });

  it('round-trips every sampled channel value', () => {
    for (let r = 0; r <= 255; r += 17) {
      for (let g = 0; g <= 255; g += 17) {
        for (let b = 0; b <= 255; b += 17) {
          expect(hexToRgb(rgbToHex([r, g, b]))).toEqual([r, g, b]);
        }
      }
    }
  });

  it('clamps out-of-range channels and rounds fractional ones', () => {
    expect(rgbToHex([300, -20, 127.4])).toBe('#ff007f');
    expect(rgbToHex([0.5, 254.6, 128])).toBe('#01ff80');
  });
});

describe('mix', () => {
  const black = '#000000';
  const white = '#ffffff';

  it('returns the first colour at t=0 and the second at t=1', () => {
    expect(mix('#102030', '#e0d0c0', 0)).toBe('#102030');
    expect(mix('#102030', '#e0d0c0', 1)).toBe('#e0d0c0');
  });

  it('blends linearly to the midpoint', () => {
    expect(mix(black, white, 0.5)).toBe('#808080');
  });

  it('is symmetric when the endpoints and t are swapped', () => {
    for (const t of [0.1, 0.33, 0.7, 0.9]) {
      expectChannelsWithin(mix('#1a7f3c', '#f5c242', t), mix('#f5c242', '#1a7f3c', 1 - t), 1);
    }
  });

  it('keeps every channel between the endpoints across the whole range', () => {
    const [ar, ag, ab] = hexToRgb('#1a7f3c');
    const [br, bg, bb] = hexToRgb('#f5c242');
    for (let t = 0; t <= 1; t += 0.1) {
      const [r, g, b] = hexToRgb(mix('#1a7f3c', '#f5c242', t));
      expect(r).toBeGreaterThanOrEqual(Math.min(ar, br) - 1);
      expect(r).toBeLessThanOrEqual(Math.max(ar, br) + 1);
      expect(g).toBeGreaterThanOrEqual(Math.min(ag, bg) - 1);
      expect(g).toBeLessThanOrEqual(Math.max(ag, bg) + 1);
      expect(b).toBeGreaterThanOrEqual(Math.min(ab, bb) - 1);
      expect(b).toBeLessThanOrEqual(Math.max(ab, bb) + 1);
    }
  });

  it('clamps t outside [0, 1] to the valid channel range', () => {
    expect(mix(black, white, 2)).toBe(white);
    expect(mix(black, white, -1)).toBe(black);
  });

  it('accepts shorthand hex on either side', () => {
    expect(mix('#000', '#fff', 0.5)).toBe(mix(black, white, 0.5));
  });
});

describe('saturate', () => {
  it('leaves a colour (almost) unchanged at amount 0', () => {
    for (const hex of ['#4a7c59', '#c0392b', '#f0b5ca', '#8a6f5c']) {
      expectChannelsWithin(saturate(hex, 0), hex, 1);
    }
  });

  it('keeps greys grey, since they have no hue to enrich', () => {
    expect(saturate('#808080', 0.5)).toBe('#808080');
  });

  it('adds chroma and grows it monotonically with the amount', () => {
    const base = '#8a6f5c';
    const spreads = [0, 0.1, 0.2, 0.4].map((amount) => chromaSpread(hexToRgb(saturate(base, amount))));
    expect(spreads[1]).toBeGreaterThan(spreads[0] ?? Infinity);
    for (let i = 1; i < spreads.length; i++) {
      expect(spreads[i]).toBeGreaterThanOrEqual(spreads[i - 1] ?? Infinity);
    }
  });

  it('preserves hue while changing saturation', () => {
    for (const hex of ['#c0392b', '#2e86c1', '#f0b5ca', '#b29bdf']) {
      const before = hueDeg(hexToRgb(hex));
      const after = hueDeg(hexToRgb(saturate(hex, 0.3)));
      expect(angleGap(before, after)).toBeLessThan(2);
    }
  });

  it('clamps saturation at full strength instead of producing invalid output', () => {
    expect(saturate('#ff8040', 10)).toMatch(HEX6);
  });
});

describe('darken', () => {
  it('keeps lightness at amount 0, only nudging saturation up', () => {
    const hex = '#2e86c1';
    expect(lightness(hexToRgb(darken(hex, 0)))).toBeCloseTo(lightness(hexToRgb(hex)), 2);
    expect(chromaSpread(hexToRgb(darken(hex, 0)))).toBeGreaterThanOrEqual(chromaSpread(hexToRgb(hex)));
  });

  it('reaches black at amount 1', () => {
    expect(darken('#2e86c1', 1)).toBe('#000000');
  });

  it('scales HSL lightness by (1 - amount)', () => {
    const hex = '#2e86c1';
    const expected = lightness(hexToRgb(hex)) * (1 - 0.25);
    expect(lightness(hexToRgb(darken(hex, 0.25)))).toBeCloseTo(expected, 2);
  });

  it('gives pure white the expected grey at a quarter darkness', () => {
    expect(darken('#ffffff', 0.25)).toBe('#bfbfbf');
  });

  it('preserves hue', () => {
    const hex = '#2e86c1';
    expect(angleGap(hueDeg(hexToRgb(hex)), hueDeg(hexToRgb(darken(hex, 0.25))))).toBeLessThan(2);
  });
});

describe('withAlpha', () => {
  it('formats the colour as an rgba() string', () => {
    expect(withAlpha('#ff8000', 0.5)).toBe('rgba(255, 128, 0, 0.5)');
    expect(withAlpha('#f80', 1)).toBe('rgba(255, 136, 0, 1)');
  });
});
