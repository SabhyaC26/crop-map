// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { Crop } from '../data/crops';
import { buildMarkerElement, estimateLabelWidth, formatAcres } from './element';
import type { Region } from './regions';

const crop: Crop = { cropId: 1, dwrCode: 'ALM', name: 'Almond', icon: 'almond.svg', color: '#c58b2a', group: 'tree', harvest: null };

const region = (over: Partial<Region> = {}): Region => ({
  id: 'fresno-almond-3',
  level: 'fine',
  cropId: 1,
  acres: 12345,
  label: 'Fresno',
  rank: 1,
  parent: 'fresno',
  lngLat: [-119.8, 36.7],
  ...over,
});

const ICON = '/icons/almond.png';

describe('formatAcres', () => {
  it.each<[number, string]>([
    [0, '0 acres'],
    [999, '999 acres'],
    [1000, '1k acres'],
    [1500, '1.5k acres'],
    [10000, '10k acres'],
    [12345.678, '12k acres'],
  ])('formats %s acres as %s', (acres, expected) => {
    expect(formatAcres(acres)).toBe(expected);
  });

  it('switches to the thousands form as soon as the rounded count reaches 1000', () => {
    // Math.round(999.6) is 1000, so this currently prints "1000 acres" while 1000 prints "1k acres".
    expect(formatAcres(999.6)).toBe('1k acres');
  });
});

describe('estimateLabelWidth', () => {
  it('grows with the label length', () => {
    expect(estimateLabelWidth('Kern County', 'coarse')).toBeGreaterThan(estimateLabelWidth('Kern', 'coarse'));
  });
});

describe('buildMarkerElement', () => {
  it('builds the nested tree the choreography and collision code address', () => {
    const parts = buildMarkerElement(region(), crop, ICON, 40);

    expect(parts.root.tagName).toBe('BUTTON');
    expect(parts.root.firstElementChild).toBe(parts.fx);
    expect(parts.fx.firstElementChild).toBe(parts.band);
    expect(parts.band.querySelector('.crop-marker__gate > .crop-marker__float > .crop-marker__icon')).not.toBeNull();
    expect(parts.band.querySelector('.crop-marker__float > .crop-marker__label')).toBe(parts.label);
    expect(parts.label.querySelector('.crop-marker__name')).toBe(parts.name);
  });

  it('labels the button with crop, place and acreage', () => {
    const { root } = buildMarkerElement(region(), crop, ICON, 40);
    expect(root.getAttribute('aria-label')).toBe('Almond in Fresno, 12k acres');
    expect(root.type).toBe('button');
  });

  it('shows the place name, then the acreage and crop in the sub-line', () => {
    const { name, label } = buildMarkerElement(region(), crop, ICON, 40);
    expect(name.textContent).toBe('Fresno');
    expect(label.querySelector('.crop-marker__sub')?.textContent).toBe('12k acres · Almond');
  });

  it('starts hidden and tags the button with its level and region id', () => {
    const { root } = buildMarkerElement(region({ level: 'coarse', id: 'kern' }), crop, ICON, 40);
    expect(root.dataset.state).toBe('hidden');
    expect(root.dataset.level).toBe('coarse');
    expect(root.dataset.id).toBe('kern');
  });

  it('sizes the button to the icon plus the label and ground gap, and exposes the icon size to CSS', () => {
    const { root } = buildMarkerElement(region(), crop, ICON, 40);
    expect(root.style.width).toBe('40px');
    // icon + label (26px) + gap to the ground point (10px)
    expect(root.style.height).toBe('76px');
    expect(root.style.getPropertyValue('--size')).toBe('40px');
    expect(root.style.getPropertyValue('--crop-color')).toBe('#c58b2a');
  });

  it('gives the icon image no alt text, since the button label already names the marker', () => {
    const { root } = buildMarkerElement(region(), crop, ICON, 40);
    const img = root.querySelector('img');
    expect(img?.alt).toBe('');
    expect(img?.getAttribute('src')).toBe(ICON);
  });

  it('bobbing cadence is deterministic per region and lasts 3.5 to 4.5 seconds', () => {
    const first = buildMarkerElement(region(), crop, ICON, 40).root.style.getPropertyValue('--bob-dur');
    const second = buildMarkerElement(region(), crop, ICON, 40).root.style.getPropertyValue('--bob-dur');
    expect(first).toBe(second);
    const seconds = Number.parseFloat(first);
    expect(seconds).toBeGreaterThanOrEqual(3.5);
    expect(seconds).toBeLessThan(4.5);
  });

  it('starts each bob at a negative phase within one cycle, so neighbours do not move in step', () => {
    const roots = Array.from({ length: 20 }, (_, i) =>
      buildMarkerElement(region({ id: `region-${i}` }), crop, ICON, 40).root,
    );
    const phases = roots.map((r) => ({
      dur: Number.parseFloat(r.style.getPropertyValue('--bob-dur')),
      delay: Number.parseFloat(r.style.getPropertyValue('--bob-delay')),
    }));
    for (const { dur, delay } of phases) {
      expect(delay).toBeLessThanOrEqual(0);
      expect(delay).toBeGreaterThan(-dur);
    }
    expect(new Set(phases.map((p) => p.delay.toFixed(2))).size).toBeGreaterThan(1);
  });

  it('tilts each bob by one to two degrees, in both directions across regions', () => {
    const tilts = Array.from({ length: 20 }, (_, i) =>
      Number.parseFloat(
        buildMarkerElement(region({ id: `tilt-${i}` }), crop, ICON, 40).root.style.getPropertyValue('--bob-tilt'),
      ),
    );
    for (const t of tilts) expect(Math.abs(t)).toBeGreaterThanOrEqual(1);
    for (const t of tilts) expect(Math.abs(t)).toBeLessThan(2);
    expect(tilts.some((t) => t < 0)).toBe(true);
    expect(tilts.some((t) => t > 0)).toBe(true);
  });
});
