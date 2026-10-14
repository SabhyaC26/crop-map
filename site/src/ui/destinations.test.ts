// @vitest-environment jsdom
import type { Map as MapLibreMap } from 'maplibre-gl';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  window.matchMedia = (query: string) =>
    ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }) as unknown as MediaQueryList;
  // jsdom implements neither pointer capture nor layout-driven scrolling.
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

import type { Crop } from '../data/crops';
import type { SearchPlace, SearchTarget } from '../markers/regions';
import { createDestinations, type Destinations } from './destinations';

const ALMOND: Crop = {
  cropId: 1,
  dwrCode: 'D1',
  name: 'Almonds',
  icon: 'almond',
  color: '#b5651d',
  group: 'Tree nuts',
  harvest: null,
};

const MODESTO: SearchPlace = { center: [-120.7, 37.6], zoom: 10, label: 'Modesto', acres: 130_000 };

const CENTRAL_VALLEY: SearchTarget = {
  center: [-120.7, 37.6],
  zoom: 8,
  label: 'Central Valley',
  acres_total: 1_500_000,
  places: [
    MODESTO,
    { center: [-120.2, 37.0], zoom: 10, label: 'Madera', acres: 118_000 },
    { center: [-119.3, 35.6], zoom: 10, label: 'Delano', acres: 117_000 },
  ],
  bbox: [-120.8, 35.4, -119.1, 37.7],
};

function fakeMap() {
  const container = document.createElement('div');
  return {
    getContainer: () => container,
    getCenter: vi.fn(() => ({ lng: -119.5, lat: 36.5 })),
    getZoom: vi.fn(() => 6),
    getPitch: vi.fn(() => 0),
    getBearing: vi.fn(() => 0),
    project: vi.fn(([x, y]: [number, number]) => ({ x, y })),
    unproject: vi.fn(([x, y]: [number, number]) => ({ lng: x, lat: y })),
    fitBounds: vi.fn(),
    jumpTo: vi.fn(),
    flyTo: vi.fn(),
    isMoving: vi.fn(() => false),
    once: vi.fn(),
  };
}

const live: Destinations[] = [];

afterEach(() => {
  for (const d of live.splice(0)) d.destroy();
  vi.useRealTimers();
  document.body.replaceChildren();
});

function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`missing ${what}`);
  return value;
}

function mount() {
  const map = fakeMap();
  const slot = document.createElement('div');
  document.body.append(slot);
  const cropPoints = vi.fn((): [number, number][] => []);
  const dest = createDestinations({ map: map as unknown as MapLibreMap, manifest: {}, cropPoints, slot });
  live.push(dest);
  const card = (): HTMLElement | null => slot.querySelector<HTMLElement>('.dc');
  const rows = (): HTMLButtonElement[] => Array.from(slot.querySelectorAll<HTMLButtonElement>('.dc-row'));
  const count = (): string | null => slot.querySelector('.dc-count')?.textContent ?? null;
  const nav = (label: string): HTMLButtonElement => must(slot.querySelector<HTMLButtonElement>(`.dc-nav[aria-label="${label}"]`), label);
  return { dest, map, slot, card, rows, count, nav };
}

describe('destinations: the "Where it grows" card', () => {
  it('shows the crop name and its statewide total', () => {
    const { dest, card, slot } = mount();
    dest.show(ALMOND, CENTRAL_VALLEY);
    expect(card()?.getAttribute('aria-label')).toBe('Where Almonds grows');
    expect(slot.querySelector('.dc-title')?.textContent).toBe('Where it grows');
    expect(slot.querySelector('.dc-total')?.textContent).toBe('1.5M acres statewide');
  });

  it('lists one row per place with its rank, label and acreage', () => {
    const { dest, rows } = mount();
    dest.show(ALMOND, CENTRAL_VALLEY);
    expect(rows()).toHaveLength(3);
    expect(rows()[0]?.getAttribute('aria-label')).toBe('1. Modesto, 130k acres. Fly there');
    expect(rows()[2]?.querySelector('.dc-label')?.textContent).toBe('Delano');
    expect(rows()[2]?.querySelector('.dc-rank')?.textContent).toBe('3');
  });

  it('falls back to a single row for the primary target when places are absent', () => {
    const { dest, rows } = mount();
    dest.show(ALMOND, { ...CENTRAL_VALLEY, places: undefined });
    expect(rows()).toHaveLength(1);
    expect(rows()[0]?.querySelector('.dc-label')?.textContent).toBe('Central Valley');
  });

  it('renders place labels as text, not markup', () => {
    const { dest, rows } = mount();
    const hostile: SearchTarget = {
      ...CENTRAL_VALLEY,
      places: [{ center: [-120, 37], zoom: 10, label: '<img src=x onerror="alert(1)">', acres: 10 }],
    };
    dest.show(ALMOND, hostile);
    const label = rows()[0]?.querySelector('.dc-label');
    expect(label?.querySelector('img')).toBeNull();
    expect(label?.textContent).toBe('<img src=x onerror="alert(1)">');
  });

  it('a second show() replaces the first card instead of stacking', () => {
    vi.useFakeTimers();
    const { dest, slot } = mount();
    dest.show(ALMOND, CENTRAL_VALLEY);
    dest.show({ ...ALMOND, cropId: 2, name: 'Walnuts' }, CENTRAL_VALLEY);
    vi.advanceTimersByTime(300);
    const cards = slot.querySelectorAll('.dc');
    expect(cards).toHaveLength(1);
    expect(cards[0]?.getAttribute('aria-label')).toBe('Where Walnuts grows');
  });
});

describe('destinations: framing the camera', () => {
  it('a multi-place crop fits the statewide overview', () => {
    const { dest, map } = mount();
    dest.show(ALMOND, CENTRAL_VALLEY);
    expect(map.fitBounds).toHaveBeenCalled();
    expect(map.flyTo).toHaveBeenCalledTimes(1);
  });

  it('a single-place crop flies straight to that place instead of fitting', () => {
    const { dest, map, count } = mount();
    dest.show(ALMOND, { ...CENTRAL_VALLEY, places: [MODESTO] });
    expect(map.fitBounds).not.toHaveBeenCalled();
    expect(map.flyTo).toHaveBeenCalledWith(expect.objectContaining({ center: [-120.7, 37.6], zoom: 10 }));
    expect(count()).toBe('1 of 1');
  });
});

describe('destinations: navigating places', () => {
  it('Next steps from the overview to the first place and flies there', () => {
    const { dest, map, nav, count, rows } = mount();
    dest.show(ALMOND, CENTRAL_VALLEY);
    nav('Next place').click();
    expect(count()).toBe('1 of 3');
    expect(rows()[0]?.getAttribute('aria-pressed')).toBe('true');
    expect(map.flyTo).toHaveBeenLastCalledWith(expect.objectContaining({ center: [-120.7, 37.6], zoom: 10 }));
  });

  it('Previous from the overview wraps to the last place', () => {
    const { dest, nav, count } = mount();
    dest.show(ALMOND, CENTRAL_VALLEY);
    nav('Previous place').click();
    expect(count()).toBe('3 of 3');
  });

  it('Next from the last place wraps back to the first', () => {
    const { dest, nav, count } = mount();
    dest.show(ALMOND, CENTRAL_VALLEY);
    nav('Previous place').click();
    nav('Next place').click();
    expect(count()).toBe('1 of 3');
  });

  it('clicking a row selects that place', () => {
    const { dest, rows, count } = mount();
    dest.show(ALMOND, CENTRAL_VALLEY);
    must(rows()[1], 'second row').click();
    expect(count()).toBe('2 of 3');
  });

  it('ArrowRight and ArrowLeft on the slot step through places, wrapping', () => {
    const { dest, slot, count } = mount();
    dest.show(ALMOND, CENTRAL_VALLEY);
    slot.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    expect(count()).toBe('1 of 3');
    slot.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
    expect(count()).toBe('3 of 3');
  });

  it('arrow keys typed into a text field inside the slot are ignored', () => {
    const { dest, slot, count } = mount();
    dest.show(ALMOND, CENTRAL_VALLEY);
    const field = document.createElement('input');
    slot.append(field);
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    expect(count()).toBe('3 places');
  });

  it('a swipe past the threshold advances to the next place', () => {
    const { dest, slot, count } = mount();
    dest.show(ALMOND, CENTRAL_VALLEY);
    const stage = must(slot.querySelector<HTMLElement>('.dc-stage'), 'stage');
    stage.dispatchEvent(new MouseEvent('pointerdown', { clientX: 200, bubbles: true }));
    stage.dispatchEvent(new MouseEvent('pointermove', { clientX: 100, bubbles: true }));
    stage.dispatchEvent(new MouseEvent('pointerup', { clientX: 100, bubbles: true }));
    expect(count()).toBe('1 of 3');
  });

  it('a short drag below the threshold does not change the place', () => {
    const { dest, slot, count } = mount();
    dest.show(ALMOND, CENTRAL_VALLEY);
    const stage = must(slot.querySelector<HTMLElement>('.dc-stage'), 'stage');
    stage.dispatchEvent(new MouseEvent('pointerdown', { clientX: 200, bubbles: true }));
    stage.dispatchEvent(new MouseEvent('pointerup', { clientX: 190, bubbles: true }));
    expect(count()).toBe('3 places');
  });

  it('the "All" button returns to the overview and refits the map', () => {
    const { dest, map, nav, count, slot } = mount();
    dest.show(ALMOND, CENTRAL_VALLEY);
    nav('Next place').click();
    const fitsBefore = map.fitBounds.mock.calls.length;
    must(slot.querySelector<HTMLButtonElement>('.dc-overview'), 'overview button').click();
    expect(count()).toBe('3 places');
    expect(map.fitBounds.mock.calls.length).toBeGreaterThan(fitsBefore);
  });

  it('the chosen row is marked as flying, then cleared once the camera lands', async () => {
    const { dest, rows } = mount();
    dest.show(ALMOND, CENTRAL_VALLEY);
    must(rows()[0], 'first row').click();
    expect(rows()[0]?.classList.contains('is-flying')).toBe(true);
    await vi.waitFor(() => expect(rows()[0]?.classList.contains('is-flying')).toBe(false));
  });
});

describe('destinations: hide and destroy', () => {
  it('hide() marks the card as leaving and removes it after the leave animation', () => {
    vi.useFakeTimers();
    const { dest, card } = mount();
    dest.show(ALMOND, CENTRAL_VALLEY);
    dest.hide();
    expect(card()?.classList.contains('is-leaving')).toBe(true);
    vi.advanceTimersByTime(259);
    expect(card()).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(card()).toBeNull();
  });

  it('destroy() removes the card and stops responding to arrow keys', () => {
    const { dest, slot, count } = mount();
    dest.show(ALMOND, CENTRAL_VALLEY);
    dest.destroy();
    live.splice(live.indexOf(dest), 1);
    slot.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    expect(count()).toBe('3 places');
    expect(slot.querySelector('.dc')?.classList.contains('is-leaving')).toBe(true);
  });
});
