// @vitest-environment jsdom
import type { Map as MapLibreMap } from 'maplibre-gl';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  window.matchMedia = (query: string) =>
    ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }) as unknown as MediaQueryList;
  // jsdom does not implement layout-driven scrolling.
  Element.prototype.scrollIntoView = () => {};
});

import { buildCropIndex } from '../data/crops';
import { createEmphasis, type HighlightSink } from './emphasis';
import { createSearch, type SearchControl } from './search';

interface Fixture {
  id: number;
  name: string;
  icon: string;
  acres: number;
}

const FIXTURE: Fixture[] = [
  { id: 1, name: 'Almonds', icon: 'almond', acres: 1_200_000 },
  { id: 5, name: 'Alfalfa', icon: 'alfalfa', acres: 1_000_000 },
  { id: 6, name: 'Walnuts', icon: 'walnut', acres: 700_000 },
  { id: 10, name: 'Corn & sorghum', icon: 'corn', acres: 500_000 },
  { id: 9, name: 'Cotton', icon: 'cotton', acres: 300_000 },
  { id: 15, name: 'Lettuce & greens', icon: 'lettuce', acres: 200_000 },
  { id: 3, name: 'Grapes, Table', icon: 'grapes', acres: 90_000 },
  { id: 24, name: 'Avocados', icon: 'avocado', acres: 60_000 },
  { id: 25, name: 'Strawberries', icon: 'strawberry', acres: 40_000 },
  { id: 43, name: 'Peppers, Jalapeño', icon: 'bell_pepper', acres: 5_000 },
  // Has no regions entry, so it must never appear in search results.
  { id: 99, name: 'Unmapped crop', icon: 'seedling', acres: 999_999 },
];

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
    on: vi.fn(),
    off: vi.fn(),
    panBy: vi.fn(),
  };
}

const controls: SearchControl[] = [];

afterEach(() => {
  for (const c of controls.splice(0)) c.destroy();
  document.body.replaceChildren();
});

function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`missing ${what}`);
  return value;
}

function mount(fixture: Fixture[] = FIXTURE) {
  const crops = buildCropIndex(
    fixture.map((f) => ({
      crop_id: f.id,
      dwr_code: `D${f.id}`,
      name: f.name,
      icon: f.icon,
      color: '#3b7a57',
      group: 'Test',
      harvest: null,
    })),
  );
  const regionsSearch = Object.fromEntries(
    fixture
      .filter((f) => f.name !== 'Unmapped crop')
      .map((f) => [String(f.id), { center: [-119.5, 36.5] as [number, number], zoom: 8, label: 'Statewide', acres_total: f.acres }]),
  );
  const fields = {
    layerIds: [],
    setEmphasis: vi.fn(),
    setSelected: vi.fn(),
    queryAt: vi.fn(() => null),
    isInteractive: vi.fn(() => true),
  };
  const overview: HighlightSink = { setHighlight: vi.fn() };
  const emphasis = createEmphasis({ crops, fields, overview, markers: undefined });
  const map = fakeMap();
  const slot = document.createElement('div');
  document.body.append(slot);
  const control = createSearch({
    map: map as unknown as MapLibreMap,
    crops,
    regionsSearch,
    cropPoints: () => [],
    manifest: {},
    emphasis,
    slot,
  });
  controls.push(control);
  const input = must(slot.querySelector<HTMLInputElement>('.cs-input'), 'search input');
  const root = must(slot.querySelector<HTMLElement>('.cs-root'), 'search root');
  return { control, emphasis, slot, input, root, map };
}

const type = (input: HTMLInputElement, text: string): void => {
  input.value = text;
  input.dispatchEvent(new Event('input'));
};

const press = (target: EventTarget, key: string): void => {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
};

const rowNames = (slot: HTMLElement): string[] =>
  Array.from(slot.querySelectorAll<HTMLElement>('.cs-option .cs-name'), (n) => n.textContent ?? '');

const optionRows = (slot: HTMLElement): HTMLElement[] => Array.from(slot.querySelectorAll<HTMLElement>('.cs-option'));

describe('createSearch: empty query', () => {
  it('lists the five largest crops under the "Top crops" heading on focus', () => {
    const { input, slot } = mount();
    input.focus();
    expect(slot.querySelector('.cs-heading')?.textContent).toBe('Top crops in California');
    expect(rowNames(slot)).toEqual(['Almonds', 'Alfalfa', 'Walnuts', 'Corn & sorghum', 'Cotton']);
  });

  it('never lists a crop that has no regions entry, even when it is the largest', () => {
    const { input, slot } = mount();
    input.focus();
    expect(rowNames(slot)).not.toContain('Unmapped crop');
  });
});

describe('createSearch: matching and ranking', () => {
  it('puts an exact name match first', () => {
    const { input, slot } = mount();
    type(input, 'Almonds');
    expect(rowNames(slot)[0]).toBe('Almonds');
  });

  it('ranks name-prefix matches above substring matches, breaking ties by acreage', () => {
    const { input, slot } = mount();
    type(input, 'al');
    // Prefix hits (score 100) come first, then word/substring hits, in score order.
    expect(rowNames(slot)).toEqual(['Almonds', 'Alfalfa', 'Walnuts', 'Peppers, Jalapeño', 'Lettuce & greens']);
  });

  it('matches a singular query against a plural crop name and highlights the matched stem', () => {
    const { input, slot } = mount();
    type(input, 'avocado');
    expect(rowNames(slot)[0]).toBe('Avocados');
    expect(slot.querySelector('.cs-option .cs-mark')?.textContent).toBe('Avocado');
  });

  it('ignores accents on both the query and the crop name', () => {
    const { input, slot } = mount();
    type(input, 'jalapeno');
    expect(rowNames(slot)[0]).toBe('Peppers, Jalapeño');
    // The highlight keeps the crop's own spelling, accent included.
    expect(slot.querySelector('.cs-option .cs-mark')?.textContent).toBe('Jalapeño');
  });

  it('matches a common word (alias) and tags the row with the alias', () => {
    const { input, slot } = mount();
    type(input, 'guac');
    expect(rowNames(slot)[0]).toBe('Avocados');
    const tag = optionRows(slot)[0]?.querySelector('.cs-tag');
    expect(tag?.textContent).toBe('“guac”');
    expect(tag?.classList.contains('is-alias')).toBe(true);
  });

  it('tolerates a single-letter typo in a long-enough word', () => {
    const { input, slot } = mount();
    type(input, 'avacado');
    expect(rowNames(slot)).toEqual(['Avocados']);
  });

  it('falls back to in-order letter matching when nothing else matches', () => {
    const { input, slot } = mount();
    type(input, 'lttc');
    expect(rowNames(slot)).toEqual(['Lettuce & greens']);
  });

  it('shows an empty state with the query echoed back when nothing matches', () => {
    const { input, slot } = mount();
    type(input, 'zzzq');
    expect(rowNames(slot)).toEqual([]);
    expect(slot.querySelector('.cs-empty')?.textContent).toContain('No crop matches “zzzq”');
    expect(slot.querySelector('.cs-sr')?.textContent).toBe('No matching crops');
    expect(input.getAttribute('aria-expanded')).toBe('false');
  });

  it('caps the results list at seven rows', () => {
    const berries = Array.from({ length: 9 }, (_, i) => ({ id: 200 + i, name: `Berry ${i + 1}`, icon: 'seedling', acres: 1000 + i }));
    const { input, slot } = mount(berries);
    type(input, 'berry');
    expect(optionRows(slot)).toHaveLength(7);
  });
});

describe('createSearch: keyboard navigation', () => {
  it('ArrowDown and ArrowUp move the highlight and wrap at both ends', () => {
    const { input, slot } = mount();
    type(input, 'a');
    const rows = optionRows(slot);
    const n = rows.length;
    expect(n).toBeGreaterThan(2);
    const activeIndex = () => optionRows(slot).findIndex((r) => r.classList.contains('is-active'));

    expect(activeIndex()).toBe(0);
    press(input, 'ArrowDown');
    expect(activeIndex()).toBe(1);
    expect(input.getAttribute('aria-activedescendant')).toBe(rows[1]?.id);

    press(input, 'ArrowUp');
    press(input, 'ArrowUp');
    expect(activeIndex()).toBe(n - 1);
    press(input, 'ArrowDown');
    expect(activeIndex()).toBe(0);
  });

  it('Enter picks the highlighted row, not necessarily the first', () => {
    const { input, slot, emphasis } = mount();
    type(input, 'a');
    const second = rowNames(slot)[1];
    press(input, 'ArrowDown');
    press(input, 'Enter');
    expect(slot.querySelector('.cs-sr')?.textContent).toBe(`Showing ${second}`);
    expect(emphasis.state.search).toBe(FIXTURE.find((f) => f.name === second)?.id);
  });

  it('Enter with no results does nothing', () => {
    const { input, emphasis, root } = mount();
    type(input, 'zzzq');
    press(input, 'Enter');
    expect(emphasis.state.search).toBeNull();
    expect(root.dataset['mode']).toBe('open');
  });

  it('Escape clears a non-empty query first, then blurs the input on a second press', () => {
    const { input, root } = mount();
    input.focus();
    type(input, 'alm');
    press(input, 'Escape');
    expect(input.value).toBe('');
    expect(root.dataset['mode']).toBe('open');
    press(input, 'Escape');
    expect(document.activeElement).not.toBe(input);
    expect(root.dataset['mode']).toBe('idle');
  });

  it('pressing "/" anywhere on the page focuses the search input', () => {
    const { input } = mount();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }));
    expect(document.activeElement).toBe(input);
  });
});

describe('createSearch: choosing a crop', () => {
  it('clicking a row pins that crop, shows the chip and its status line', () => {
    const { input, slot, emphasis, root } = mount();
    type(input, 'walnut');
    must(optionRows(slot)[0], 'first option').click();
    expect(emphasis.state.search).toBe(6);
    expect(root.dataset['mode']).toBe('chip');
    expect(slot.querySelector('.cs-chip-name')?.textContent).toBe('Walnuts');
    expect(slot.querySelector('.cs-sr')?.textContent).toBe('Showing Walnuts');
  });

  it('choosing a crop opens its "Where it grows" card', () => {
    const { input, slot } = mount();
    type(input, 'almond');
    press(input, 'Enter');
    expect(slot.querySelector('.dc')?.getAttribute('aria-label')).toBe('Where Almonds grows');
  });

  it('the chip clear button drops the filter and marks the card as leaving', () => {
    const { input, slot, emphasis, root } = mount();
    type(input, 'almond');
    press(input, 'Enter');
    must(slot.querySelector<HTMLButtonElement>('.cs-chip-clear'), 'chip clear').click();
    expect(emphasis.state.search).toBeNull();
    expect(root.dataset['mode']).toBe('idle');
    expect(slot.querySelector('.cs-sr')?.textContent).toBe('Crop filter cleared');
    expect(slot.querySelector('.dc')?.classList.contains('is-leaving')).toBe(true);
  });

  it('unselecting the searched crop from the legend resets the chip too', () => {
    const { input, slot, emphasis, root } = mount();
    type(input, 'almond');
    press(input, 'Enter');
    emphasis.toggle(1);
    expect(root.dataset['mode']).toBe('idle');
    expect(slot.querySelector('.cs-sr')?.textContent).toBe('Crop filter cleared');
  });

  it('the reset (x) button empties the query and restores the top list', () => {
    const { input, slot } = mount();
    type(input, 'zzz');
    const reset = must(slot.querySelector<HTMLButtonElement>('.cs-reset'), 'reset button');
    expect(reset.dataset['show']).toBe('true');
    reset.click();
    expect(input.value).toBe('');
    expect(slot.querySelector('.cs-heading')?.textContent).toBe('Top crops in California');
    expect(reset.dataset['show']).toBe('false');
  });
});

describe('createSearch: lifecycle', () => {
  it('destroy removes the search UI and stops the "/" shortcut', () => {
    const { control, input, slot } = mount();
    control.destroy();
    controls.splice(controls.indexOf(control), 1);
    expect(slot.querySelector('.cs-root')).toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }));
    expect(document.activeElement).not.toBe(input);
  });
});
