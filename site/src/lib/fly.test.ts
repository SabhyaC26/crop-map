// @vitest-environment jsdom
import type { FlyToOptions, Map as MapLibreMap } from 'maplibre-gl';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { flyTo, type FlyTarget } from './fly';

// motion.ts reads matchMedia once at import time, so the stub must be installed before the module loads.
const reducedMotion = vi.hoisted(() => {
  const query = { matches: false };
  window.matchMedia = () => query as MediaQueryList;
  return query;
});

interface FakeMap {
  map: MapLibreMap;
  flyTo: Mock<(options: FlyToOptions) => void>;
  /** Simulates maplibre finishing the current camera move. */
  land: () => void;
}

/**
 * Minimal stand-in for maplibre's movement lifecycle: `flyTo` starts a move, which fires `moveend` when it
 * ends or when it is replaced by another move (maplibre stops the old one first).
 */
function createFakeMap(options: { pitch?: number; bearing?: number; movesOnFlyTo?: boolean } = {}): FakeMap {
  const { pitch = 0, bearing = 0, movesOnFlyTo = true } = options;
  let moving = false;
  let moveEndListeners: Array<() => void> = [];
  const fireMoveEnd = (): void => {
    const listeners = moveEndListeners;
    moveEndListeners = [];
    listeners.forEach((fn) => fn());
  };
  const flyTo = vi.fn((_options: FlyToOptions) => {
    if (moving) {
      moving = false;
      fireMoveEnd();
    }
    moving = movesOnFlyTo;
  });
  const fake = {
    flyTo,
    getPitch: vi.fn(() => pitch),
    getBearing: vi.fn(() => bearing),
    isMoving: vi.fn(() => moving),
    once: vi.fn((event: string, fn: () => void) => {
      if (event === 'moveend') moveEndListeners.push(fn);
    }),
  };
  return {
    map: fake as unknown as MapLibreMap,
    flyTo,
    land: () => {
      moving = false;
      fireMoveEnd();
    },
  };
}

function lastFlyOptions(flyToMock: Mock<(options: FlyToOptions) => void>): FlyToOptions {
  const call = flyToMock.mock.lastCall;
  if (!call) throw new Error('flyTo was not called');
  return call[0];
}

function easingOf(options: FlyToOptions): (t: number) => number {
  if (!options.easing) throw new Error('flyTo options have no easing');
  return options.easing;
}

const TARGET: FlyTarget = { center: [-119.5, 37.2], zoom: 7.5, offset: [40, -20] };

describe('flyTo camera options', () => {
  beforeEach(() => {
    reducedMotion.matches = false;
  });

  it('keeps the current pitch and bearing so the move stays flat', () => {
    const fake = createFakeMap({ pitch: 0, bearing: -35 });
    void flyTo(fake.map, TARGET);
    expect(lastFlyOptions(fake.flyTo)).toMatchObject({ pitch: 0, bearing: -35 });
  });

  it('forwards the destination and screen offset untouched', () => {
    const fake = createFakeMap();
    void flyTo(fake.map, TARGET);
    expect(lastFlyOptions(fake.flyTo)).toMatchObject({
      center: [-119.5, 37.2],
      zoom: 7.5,
      offset: [40, -20],
    });
  });

  it('marks the move essential so maplibre never drops it', () => {
    const fake = createFakeMap();
    void flyTo(fake.map, TARGET);
    expect(lastFlyOptions(fake.flyTo).essential).toBe(true);
  });

  it('lets maplibre pick the duration normally', () => {
    const fake = createFakeMap();
    void flyTo(fake.map, TARGET);
    expect(lastFlyOptions(fake.flyTo)).not.toHaveProperty('duration');
  });

  it('skips the animation entirely when the user prefers reduced motion', () => {
    reducedMotion.matches = true;
    const fake = createFakeMap();
    void flyTo(fake.map, TARGET);
    expect(lastFlyOptions(fake.flyTo)).toMatchObject({ duration: 0 });
  });
});

describe('flyTo promise', () => {
  beforeEach(() => {
    reducedMotion.matches = false;
  });

  it('resolves straight away when the camera did not start moving', async () => {
    const fake = createFakeMap({ movesOnFlyTo: false });
    await expect(flyTo(fake.map, TARGET)).resolves.toBeUndefined();
  });

  it('stays pending while the camera is moving and resolves on moveend', async () => {
    const fake = createFakeMap();
    let settled = false;
    const done = flyTo(fake.map, TARGET).then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    fake.land();
    await done;
    expect(settled).toBe(true);
  });

  it('resolves the earlier flight when a new flight replaces it', async () => {
    const fake = createFakeMap();
    const first = flyTo(fake.map, TARGET);
    const second = flyTo(fake.map, { center: [-121, 36], zoom: 6 });
    await expect(first).resolves.toBeUndefined();

    let secondSettled = false;
    void second.then(() => {
      secondSettled = true;
    });
    await Promise.resolve();
    expect(secondSettled).toBe(false);
    fake.land();
    await expect(second).resolves.toBeUndefined();
  });
});

function easingFromFlight(): (t: number) => number {
  const fake = createFakeMap();
  void flyTo(fake.map, TARGET);
  return easingOf(lastFlyOptions(fake.flyTo));
}

describe('flyTo easing curve', () => {
  it('starts at 0 and lands exactly on 1', () => {
    const easing = easingFromFlight();
    expect(easing(0)).toBe(0);
    expect(easing(1)).toBeCloseTo(1, 10);
  });

  it('never leaves [0, 1] and never goes backwards', () => {
    const easing = easingFromFlight();
    let previous = easing(0);
    for (let t = 0; t <= 1.0001; t += 0.01) {
      const value = easing(t);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1 + 1e-9);
      expect(value).toBeGreaterThanOrEqual(previous - 1e-12);
      previous = value;
    }
  });

  it('eases in and out: slow near both ends, point-symmetric about the midpoint', () => {
    const easing = easingFromFlight();
    expect(easing(0.1)).toBeLessThan(0.1);
    expect(easing(0.9)).toBeGreaterThan(0.9);
    for (const t of [0.1, 0.25, 0.4]) {
      expect(easing(t) + easing(1 - t)).toBeCloseTo(1, 10);
    }
  });
});
