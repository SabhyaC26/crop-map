// @vitest-environment jsdom
import type { Map as MapLibreMap } from 'maplibre-gl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  window.matchMedia = (query: string) =>
    ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }) as unknown as MediaQueryList;
});

vi.mock('../layers/fields', () => ({ FIELD_FILL_LAYER_ID: 'fields-fill' }));

import { buildCropIndex } from '../data/crops';
import type { FieldsLayer } from '../layers/fields';
import { createEmphasis, type HighlightSink } from './emphasis';
import { createLegend, type Legend } from './legend';

type Feature = { id?: number; properties: Record<string, unknown> };

const feature = (id: number | undefined, cropId: unknown, acres: unknown): Feature => ({
  ...(id === undefined ? {} : { id }),
  properties: { crop_id: cropId, acres },
});

function makeRecords(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    crop_id: i + 1,
    dwr_code: `D${i + 1}`,
    name: `Crop ${i + 1}`,
    icon: 'seedling',
    color: '#3b7a57',
    group: 'Test',
    harvest: null,
  }));
}

const state = {
  zoom: 10,
  lng: -120,
  features: [] as Feature[],
  tilesLoaded: false,
};

const legends: Legend[] = [];

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  for (const l of legends.splice(0)) l.destroy();
  vi.useRealTimers();
  state.zoom = 10;
  state.lng = -120;
  state.features = [];
  state.tilesLoaded = false;
  document.body.replaceChildren();
});

function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`missing ${what}`);
  return value;
}

function mount(recordCount = 4) {
  const handlers = new Map<string, () => void>();
  const map = {
    getLayer: vi.fn(() => ({})),
    getZoom: vi.fn(() => state.zoom),
    getCenter: vi.fn(() => ({ lng: state.lng, lat: 36.8 })),
    getBearing: vi.fn(() => 0),
    areTilesLoaded: vi.fn(() => state.tilesLoaded),
    queryRenderedFeatures: vi.fn(() => state.features),
    on: vi.fn((type: string, fn: () => void) => {
      handlers.set(type, fn);
    }),
    off: vi.fn(),
  };
  const fields = {
    layerIds: [],
    setEmphasis: vi.fn(),
    setSelected: vi.fn(),
    queryAt: vi.fn(() => null),
    isInteractive: vi.fn(() => true),
  } satisfies FieldsLayer;
  const overview: HighlightSink = { setHighlight: vi.fn() };
  const crops = buildCropIndex(makeRecords(recordCount));
  const emphasis = createEmphasis({ crops, fields, overview, markers: undefined });
  const slot = document.createElement('div');
  const popupRoot = document.createElement('div');
  document.body.append(slot, popupRoot);
  const legend = createLegend({
    map: map as unknown as MapLibreMap,
    crops,
    manifest: {},
    emphasis,
    slot,
    popupRoot,
  });
  legends.push(legend);
  const root = must(slot.querySelector<HTMLElement>('.lg-root'), 'legend root');
  const settle = (): void => {
    vi.advanceTimersByTime(140);
  };
  settle();
  const rows = (): HTMLButtonElement[] => Array.from(root.querySelectorAll<HTMLButtonElement>('.lg-row'));
  const rowFor = (cropId: number): HTMLButtonElement => must(rows().find((r) => r.dataset['crop'] === String(cropId)) ?? null, `row ${cropId}`);
  return { legend, emphasis, overview, root, settle, rows, rowFor, handlers, map, slot };
}

/** Four crops in view: Almonds 300, Grapes 100 (listed twice), Walnuts 90, Rice 1; plus a feature with unreadable acres. */
const FOUR_CROPS: Feature[] = [
  feature(1, 1, 300),
  feature(2, 2, 100),
  feature(2, 2, 100),
  feature(3, 3, 90),
  feature(4, 4, 1),
  feature(6, 1, 'n/a'),
];

describe('legend: visibility', () => {
  it('stays hidden below field zoom and appears once zoomed in past 9.8', () => {
    state.zoom = 9.7;
    state.features = FOUR_CROPS;
    const { root, settle, handlers } = mount();
    settle();
    expect(root.dataset['visible']).toBe('false');
    state.zoom = 9.9;
    handlers.get('zoom')?.();
    expect(root.dataset['visible']).toBe('true');
  });

  it('keeps showing between 9.6 and 9.8 once shown (no flicker), and hides below 9.6', () => {
    state.zoom = 10;
    state.features = FOUR_CROPS;
    const { root, settle, handlers } = mount();
    settle();
    state.zoom = 9.65;
    handlers.get('zoom')?.();
    expect(root.dataset['visible']).toBe('true');
    state.zoom = 9.5;
    handlers.get('zoom')?.();
    expect(root.dataset['visible']).toBe('false');
  });
});

describe('legend: when it re-measures', () => {
  it('does not rescan the fields when the camera has not moved since a complete tally', () => {
    state.features = FOUR_CROPS;
    state.tilesLoaded = true;
    const { handlers, settle, map } = mount();
    const scans = map.queryRenderedFeatures.mock.calls.length;
    handlers.get('idle')?.();
    handlers.get('moveend')?.();
    settle();
    expect(map.queryRenderedFeatures.mock.calls.length).toBe(scans);
  });

  it('rescans on idle when the last tally ran before every tile had loaded', () => {
    state.features = [feature(1, 1, 10)];
    const { handlers, settle, rows } = mount();
    expect(rows()).toHaveLength(1);
    state.features = FOUR_CROPS;
    state.tilesLoaded = true;
    handlers.get('idle')?.();
    settle();
    expect(rows()).toHaveLength(4);
  });

  it('rescans after the camera moves', () => {
    state.features = [feature(1, 1, 10)];
    state.tilesLoaded = true;
    const { handlers, settle, rows } = mount();
    state.features = FOUR_CROPS;
    state.lng = -119.5;
    handlers.get('moveend')?.();
    settle();
    expect(rows()).toHaveLength(4);
  });
});

describe('legend: what is in view', () => {
  it('ranks crops by acreage share, rounding to whole percents and "<1%" for slivers', () => {
    state.features = FOUR_CROPS;
    const { rows } = mount();
    expect(rows().map((r) => r.dataset['crop'])).toEqual(['1', '2', '3', '4']);
    const pcts = Array.from(document.querySelectorAll('.lg-pct'), (p) => p.textContent);
    expect(pcts).toEqual(['61%', '20%', '18%', '<1%']);
  });

  it('counts a feature id only once, so a duplicate tile does not inflate a crop', () => {
    state.features = FOUR_CROPS;
    const { rowFor } = mount();
    // If the duplicate Grapes feature were counted twice, Almonds would read 51% instead of 61%.
    expect(rowFor(1).querySelector('.lg-pct')?.textContent).toBe('61%');
    expect(rowFor(2).querySelector('.lg-pct')?.textContent).toBe('20%');
  });

  it('ignores a feature whose acreage cannot be read', () => {
    state.features = FOUR_CROPS;
    const { rows } = mount();
    expect(rows()).toHaveLength(4);
  });

  // Bug: measure() adds acres for crop ids missing from the crop index to the denominator, so the
  // shares of the crops the legend can show do not reflect the visible acreage.
  it('does not let unknown crop ids dilute the shares of known crops', () => {
    state.features = [...FOUR_CROPS, feature(7, 99, 500)];
    const { rowFor } = mount();
    expect(rowFor(1).querySelector('.lg-pct')?.textContent).toBe('61%');
  });

  it('gives each row an accessible label with its share', () => {
    state.features = FOUR_CROPS;
    const { rowFor } = mount();
    expect(rowFor(1).getAttribute('aria-label')).toBe('Crop 1, 61% of the view');
  });

  it('summarises the count in the pill, subtitle and live status', () => {
    state.features = FOUR_CROPS;
    const { root } = mount();
    expect(root.querySelector('.lg-pill-label')?.textContent).toBe('Legend · 4 crops');
    expect(root.querySelector('.lg-sub')?.textContent).toBe('4 crops');
    expect(root.querySelector('.lg-sr')?.textContent).toBe('4 crops in view');
  });

  it('uses the singular for a single crop', () => {
    state.features = [feature(1, 1, 10)];
    const { root } = mount();
    expect(root.querySelector('.lg-sub')?.textContent).toBe('1 crop');
  });

  it('hides the legend when nothing is in view', () => {
    state.features = [];
    const { root } = mount();
    expect(root.dataset['visible']).toBe('false');
  });
});

describe('legend: selecting crops', () => {
  it('clicking a row pins that crop and dims the rest', () => {
    state.features = FOUR_CROPS;
    const { rowFor, root, emphasis } = mount();
    rowFor(1).click();
    expect(emphasis.state.selected.has(1)).toBe(true);
    expect(rowFor(1).getAttribute('aria-pressed')).toBe('true');
    expect(rowFor(2).getAttribute('aria-pressed')).toBe('false');
    expect(rowFor(1).closest('.lg-item')?.classList.contains('is-on')).toBe(true);
    expect(rowFor(2).closest('.lg-item')?.classList.contains('is-dim')).toBe(true);
    expect(root.querySelector('.lg-pill-label')?.textContent).toBe('Legend · 1 selected');
  });

  it('"Show all" clears the selection and hides itself', () => {
    state.features = FOUR_CROPS;
    const { rowFor, root } = mount();
    rowFor(1).click();
    const clear = must(root.querySelector<HTMLButtonElement>('.lg-clear'), 'show all');
    expect(clear.hidden).toBe(false);
    clear.click();
    expect(root.querySelector('.lg-pill-label')?.textContent).toBe('Legend · 4 crops');
    expect(clear.hidden).toBe(true);
  });

  it('a pinned crop that has scrolled out of view stays listed and is marked off-screen', () => {
    state.features = FOUR_CROPS;
    const { emphasis, rowFor } = mount(5);
    emphasis.toggle(5);
    expect(rowFor(5).closest('.lg-item')?.classList.contains('is-away')).toBe(true);
    expect(rowFor(5).querySelector('.lg-pct')?.textContent).toBe('off-screen');
    expect(rowFor(5).getAttribute('aria-label')).toBe('Crop 5, not in view');
  });

  it('hovering a row previews that crop on the map after a short delay, and clears it on leave', () => {
    state.features = FOUR_CROPS;
    const { rowFor, overview } = mount();
    const enter = new MouseEvent('pointerover', { bubbles: true });
    Object.defineProperty(enter, 'pointerType', { value: 'mouse' });
    rowFor(2).dispatchEvent(enter);
    vi.advanceTimersByTime(130);
    expect(overview.setHighlight).toHaveBeenLastCalledWith([2]);

    const leave = new MouseEvent('pointerout', { bubbles: true });
    Object.defineProperty(leave, 'pointerType', { value: 'mouse' });
    rowFor(2).dispatchEvent(leave);
    vi.advanceTimersByTime(70);
    expect(overview.setHighlight).toHaveBeenLastCalledWith(null);
  });
});

describe('legend: showing more than eight crops', () => {
  const TEN = Array.from({ length: 10 }, (_, i) => feature(i + 1, i + 1, (10 - i) * 100));

  it('shows the top eight with a "+N more" toggle', () => {
    state.features = TEN;
    const { rows, root } = mount(10);
    expect(rows()).toHaveLength(8);
    const more = must(root.querySelector<HTMLButtonElement>('.lg-more'), 'more');
    expect(more.hidden).toBe(false);
    expect(more.textContent).toBe('+2 more');
  });

  it('expanding shows everything; collapsing returns to the top eight', () => {
    state.features = TEN;
    const { rows, root } = mount(10);
    const more = must(root.querySelector<HTMLButtonElement>('.lg-more'), 'more');
    more.click();
    expect(rows()).toHaveLength(10);
    expect(more.textContent).toBe('Show less');
    expect(more.getAttribute('aria-expanded')).toBe('true');
    more.click();
    expect(rows()).toHaveLength(8);
  });

  it('a pinned crop beyond the top eight stays reachable so it can be unpinned', () => {
    state.features = TEN;
    const { rows, root, emphasis } = mount(10);
    emphasis.toggle(10);
    expect(rows()).toHaveLength(9);
    expect(rows().map((r) => r.dataset['crop'])).toContain('10');
    expect(root.querySelector('.lg-more')?.textContent).toBe('+1 more');
  });

  it('hides the toggle when there are eight or fewer crops', () => {
    state.features = FOUR_CROPS;
    const { root } = mount();
    expect(root.querySelector<HTMLButtonElement>('.lg-more')?.hidden).toBe(true);
  });
});

describe('legend: the card', () => {
  it('the pill opens and closes the card, reflected in aria-expanded', () => {
    state.features = FOUR_CROPS;
    const { root, slot } = mount();
    const pill = must(slot.querySelector<HTMLButtonElement>('.lg-pill'), 'pill');
    expect(pill.getAttribute('aria-expanded')).toBe('false');
    pill.click();
    expect(root.dataset['open']).toBe('true');
    expect(pill.getAttribute('aria-expanded')).toBe('true');
    pill.click();
    expect(root.dataset['open']).toBe('false');
  });

  it('Escape closes an open card and returns focus to the pill', () => {
    state.features = FOUR_CROPS;
    const { root, slot } = mount();
    const pill = must(slot.querySelector<HTMLButtonElement>('.lg-pill'), 'pill');
    pill.click();
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(root.dataset['open']).toBe('false');
    expect(document.activeElement).toBe(pill);
  });

  it('the close button dismisses the card', () => {
    state.features = FOUR_CROPS;
    const { root, slot } = mount();
    must(slot.querySelector<HTMLButtonElement>('.lg-pill'), 'pill').click();
    must(root.querySelector<HTMLButtonElement>('.lg-close'), 'close').click();
    expect(root.dataset['open']).toBe('false');
  });
});

describe('legend: teardown', () => {
  it('destroy removes the legend and detaches its map listeners', () => {
    state.features = FOUR_CROPS;
    const { legend, slot, map } = mount();
    legend.destroy();
    legends.splice(legends.indexOf(legend), 1);
    expect(slot.querySelector('.lg-root')).toBeNull();
    for (const type of ['zoom', 'moveend', 'idle', 'click']) {
      expect(map.off).toHaveBeenCalledWith(type, expect.any(Function));
    }
  });
});