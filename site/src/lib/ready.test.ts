// @vitest-environment jsdom
import type { Map as MapLibreMap } from 'maplibre-gl';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type * as Ready from './ready';

// motion.ts reads matchMedia at import time; the stub returns a shared object whose `matches` tests can flip.
const reducedMotion = vi.hoisted(() => {
  const query = { matches: false };
  window.matchMedia = () => query as MediaQueryList;
  return query;
});

const GIVE_UP_MS = 12000;
const SLOW_SOURCE_GRACE_MS = 500;
const SOURCES = { basemap: {}, fields: {}, terrain: {} };
const SLOW = ['terrain'];

interface FakeMap {
  map: MapLibreMap;
  /** Marks a source as having its tiles in. */
  load: (id: string) => void;
  /** Fires a `render` event, which is what the readiness check listens to. */
  render: () => void;
  on: Mock<(event: string, fn: () => void) => void>;
  off: Mock<(event: string, fn: () => void) => void>;
  triggerRepaint: Mock<() => void>;
}

function createFakeMap(): FakeMap {
  const loaded = new Set<string>();
  let listeners: Array<() => void> = [];
  const on = vi.fn((event: string, fn: () => void) => {
    if (event === 'render') listeners.push(fn);
  });
  const off = vi.fn((event: string, fn: () => void) => {
    if (event === 'render') listeners = listeners.filter((l) => l !== fn);
  });
  const triggerRepaint = vi.fn();
  const fake = {
    getStyle: () => ({ sources: SOURCES }),
    isSourceLoaded: (id: string) => loaded.has(id),
    on,
    off,
    triggerRepaint,
  };
  return {
    map: fake as unknown as MapLibreMap,
    load: (id) => {
      loaded.add(id);
    },
    render: () => {
      [...listeners].forEach((fn) => fn());
    },
    on,
    off,
    triggerRepaint,
  };
}

function deferred(): { promise: Promise<void>; resolve: () => void; reject: (err: Error) => void } {
  let resolve!: () => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const isShown = (): boolean => document.documentElement.classList.contains('map-ready');
const skeletonPresent = (): boolean => document.getElementById('boot') !== null;

describe('ready', () => {
  let ready: typeof Ready;

  beforeEach(async () => {
    // ready.ts keeps module-level state (the `started` flag and the mapShown promise), so each test gets a fresh copy.
    vi.resetModules();
    vi.useFakeTimers();
    reducedMotion.matches = false;
    document.body.innerHTML = '<div id="boot"></div>';
    document.documentElement.classList.remove('map-ready');
    ready = await import('./ready');
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
    document.documentElement.classList.remove('map-ready');
  });

  describe('showMap', () => {
    it('marks the page ready at once, then drops the skeleton after the fade', () => {
      ready.showMap();
      expect(isShown()).toBe(true);
      expect(skeletonPresent()).toBe(true);

      vi.advanceTimersByTime(ready.MAP_FADE_MS - 1);
      expect(skeletonPresent()).toBe(true);

      vi.advanceTimersByTime(1);
      expect(skeletonPresent()).toBe(false);
    });

    it('resolves mapShown only once the skeleton has faded away', async () => {
      let settled = false;
      void ready.mapShown.then(() => {
        settled = true;
      });

      ready.showMap();
      await vi.advanceTimersByTimeAsync(ready.MAP_FADE_MS - 1);
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      expect(settled).toBe(true);
    });

    it('skips the fade when the user prefers reduced motion', async () => {
      reducedMotion.matches = true;
      ready.showMap();
      await vi.advanceTimersByTimeAsync(0);
      expect(skeletonPresent()).toBe(false);
      await expect(ready.mapShown).resolves.toBeUndefined();
    });

    it('schedules the fade only once no matter how often it is called', () => {
      ready.showMap();
      ready.showMap();
      ready.showMap();
      expect(vi.getTimerCount()).toBe(1);
    });
  });

  describe('showMapWhenReady', () => {
    it('does not reveal the map before the crop layers have finished setting up', () => {
      const fake = createFakeMap();
      const setup = deferred();
      for (const id of Object.keys(SOURCES)) fake.load(id);

      ready.showMapWhenReady(fake.map, setup.promise, SLOW);
      fake.render();
      expect(isShown()).toBe(false);

      setup.resolve();
      return setup.promise.then(() => {
        fake.render();
        expect(isShown()).toBe(true);
      });
    });

    it('reveals straight away once every source, slow ones included, has its tiles', () => {
      const fake = createFakeMap();
      for (const id of Object.keys(SOURCES)) fake.load(id);

      ready.showMapWhenReady(fake.map, Promise.resolve(), SLOW);
      return Promise.resolve().then(() => {
        fake.render();
        expect(isShown()).toBe(true);
      });
    });

    it('gives slow sources a short grace period after everything else has loaded', async () => {
      const fake = createFakeMap();
      fake.load('basemap');
      fake.load('fields');

      ready.showMapWhenReady(fake.map, Promise.resolve(), SLOW);
      await Promise.resolve();
      fake.render();
      expect(isShown()).toBe(false);

      vi.advanceTimersByTime(SLOW_SOURCE_GRACE_MS - 1);
      expect(isShown()).toBe(false);

      vi.advanceTimersByTime(1);
      expect(isShown()).toBe(true);
    });

    it('reveals early if the slow source arrives within the grace period', async () => {
      const fake = createFakeMap();
      fake.load('basemap');
      fake.load('fields');

      ready.showMapWhenReady(fake.map, Promise.resolve(), SLOW);
      await Promise.resolve();
      fake.render();

      vi.advanceTimersByTime(100);
      fake.load('terrain');
      fake.render();
      expect(isShown()).toBe(true);
    });

    it('gives up and reveals the map after 12 seconds even if nothing finishes loading', () => {
      const fake = createFakeMap();
      ready.showMapWhenReady(fake.map, new Promise<void>(() => undefined), SLOW);

      vi.advanceTimersByTime(GIVE_UP_MS - 1);
      expect(isShown()).toBe(false);

      vi.advanceTimersByTime(1);
      expect(isShown()).toBe(true);
    });

    it('still starts watching the map when the setup promise rejects', async () => {
      const fake = createFakeMap();
      for (const id of Object.keys(SOURCES)) fake.load(id);
      const setup = deferred();

      ready.showMapWhenReady(fake.map, setup.promise, SLOW);
      setup.reject(new Error('crop layers failed'));
      await setup.promise.catch(() => undefined);
      await Promise.resolve();

      fake.render();
      expect(isShown()).toBe(true);
    });

    it('asks the map to repaint once setup settles so the readiness check runs', async () => {
      const fake = createFakeMap();
      const setup = deferred();
      ready.showMapWhenReady(fake.map, setup.promise, SLOW);
      expect(fake.triggerRepaint).not.toHaveBeenCalled();

      setup.resolve();
      await setup.promise;
      await Promise.resolve();
      expect(fake.triggerRepaint).toHaveBeenCalledTimes(1);
    });

    it('stops listening for render events once the map has been shown', async () => {
      const fake = createFakeMap();
      for (const id of Object.keys(SOURCES)) fake.load(id);
      ready.showMapWhenReady(fake.map, Promise.resolve(), SLOW);
      await Promise.resolve();

      fake.render();
      expect(isShown()).toBe(true);
      expect(fake.off).toHaveBeenCalledWith('render', fake.on.mock.calls[0]?.[1]);
    });
  });
});
