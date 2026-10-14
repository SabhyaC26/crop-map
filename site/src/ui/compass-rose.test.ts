// @vitest-environment jsdom
import type { Map as MapLibreMap } from 'maplibre-gl';
import { describe, expect, it, vi } from 'vitest';
import { mountCompassRose } from './compass-rose';

function fakeMap(zoom: number, bearing: number) {
  const handlers = new Map<string, () => void>();
  const map = {
    zoom,
    bearing,
    getZoom: vi.fn(() => map.zoom),
    getBearing: vi.fn(() => map.bearing),
    on: vi.fn((type: string, fn: () => void) => {
      handlers.set(type, fn);
    }),
  };
  const fire = (type: string): void => handlers.get(type)?.();
  return { map, fire };
}

function mountAt(zoom: number, bearing = 0) {
  const host = document.createElement('div');
  document.body.append(host);
  const { map, fire } = fakeMap(zoom, bearing);
  mountCompassRose(host, map as unknown as MapLibreMap);
  const root = host.querySelector<HTMLElement>('.compass-rose');
  const dial = host.querySelector<HTMLElement>('.compass-rose__dial');
  if (!root || !dial) throw new Error('compass rose not mounted');
  return { host, map, fire, root, dial };
}

describe('mountCompassRose', () => {
  it('mounts a decorative rose with an N label, hidden from assistive tech', () => {
    const { root, dial } = mountAt(3);
    expect(root.getAttribute('aria-hidden')).toBe('true');
    expect(dial.querySelector('text')?.textContent).toBe('N');
  });

  it('is fully opaque on the overview and fades out as the map zooms into fields', () => {
    const { map, fire, root } = mountAt(6.2);
    expect(Number(root.style.opacity)).toBeCloseTo(1);
    map.zoom = 6.8;
    fire('zoom');
    expect(Number(root.style.opacity)).toBeCloseTo(0.5);
    map.zoom = 7.4;
    fire('zoom');
    expect(Number(root.style.opacity)).toBeCloseTo(0);
  });

  it('stays opaque below the fade start and transparent past the fade end', () => {
    const { map, fire, root } = mountAt(2);
    expect(Number(root.style.opacity)).toBeCloseTo(1);
    map.zoom = 12;
    fire('zoom');
    expect(Number(root.style.opacity)).toBeCloseTo(0);
  });

  it('counter-rotates the dial so north stays up when the map is rotated', () => {
    const { map, fire, dial } = mountAt(3, 30);
    expect(dial.style.transform).toBe('rotate(-30.00deg)');
    map.bearing = -15;
    fire('rotate');
    expect(dial.style.transform).toBe('rotate(15.00deg)');
  });
});
