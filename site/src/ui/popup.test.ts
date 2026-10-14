// @vitest-environment jsdom
import type { Map as MapLibreMap } from 'maplibre-gl';
import { afterEach, describe, expect, it, vi } from 'vitest';

const media = vi.hoisted(() => {
  const state = { sheet: false };
  window.matchMedia = (query: string) =>
    ({
      get matches() {
        return query.includes('639px') && state.sheet;
      },
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }) as unknown as MediaQueryList;
  return state;
});

import { buildCropIndex } from '../data/crops';
import type { FieldHit, FieldsLayer } from '../layers/fields';
import { createFieldPopup, type FieldPopup } from './popup';

const ALMOND_HARVEST = [false, false, true, true, true, true, false, false, false, false, false, false];
const YEAR_ROUND = Array.from({ length: 12 }, () => true);

const RECORDS = [
  { crop_id: 1, dwr_code: 'D1', name: 'Almonds', icon: 'almond', color: '#b5651d', group: 'Tree nuts', harvest: ALMOND_HARVEST },
  { crop_id: 2, dwr_code: 'V1', name: 'Grapes', icon: 'grapes', color: '#6a3d9a', group: 'Vines', harvest: null },
  { crop_id: 3, dwr_code: 'T1', name: 'Walnuts', icon: 'walnut', color: '#8c6d31', group: 'Tree nuts', harvest: YEAR_ROUND },
  { crop_id: 4, dwr_code: 'F1', name: 'Corn', icon: 'corn', color: '#e0b528', group: 'Field', harvest: null },
  { crop_id: 5, dwr_code: 'F2', name: 'Rice', icon: 'rice', color: '#f0f0d0', group: 'Field', harvest: null },
  { crop_id: 6, dwr_code: 'F3', name: 'Cotton', icon: 'cotton', color: '#ffffff', group: 'Field', harvest: null },
  { crop_id: 7, dwr_code: 'F4', name: 'Pears', icon: 'pear', color: '#c5d86d', group: 'Orchard', harvest: null },
  { crop_id: 8, dwr_code: 'F5', name: 'Plums', icon: 'cherries', color: '#7b2d8e', group: 'Orchard', harvest: null },
  { crop_id: 9, dwr_code: 'F6', name: 'Apples', icon: 'apple', color: '#d62728', group: 'Orchard', harvest: null },
  { crop_id: 10, dwr_code: 'F7', name: 'Kiwis', icon: 'kiwi', color: '#8fbc3f', group: 'Orchard', harvest: null },
];

const crops = buildCropIndex(RECORDS);

function fakeMap() {
  const handlers = new Map<string, (e?: unknown) => void>();
  return {
    handlers,
    project: vi.fn((): { x: number; y: number } => ({ x: 400, y: 400 })),
    panBy: vi.fn((_offset: [number, number], _opts?: unknown) => {}),
    on: vi.fn((type: string, fn: (e?: unknown) => void) => {
      handlers.set(type, fn);
    }),
  };
}

const fields = {
  layerIds: [],
  setEmphasis: vi.fn(),
  setSelected: vi.fn(),
  queryAt: vi.fn((): FieldHit | null => null),
  isInteractive: vi.fn(() => true),
} satisfies FieldsLayer;

const popups: FieldPopup[] = [];

afterEach(() => {
  media.sheet = false;
  vi.useRealTimers();
  fields.setSelected.mockClear();
  fields.queryAt.mockReset();
  fields.queryAt.mockImplementation(() => null);
  for (const p of popups.splice(0)) if (p.isOpen) p.close();
  document.body.replaceChildren();
});

function mount(options: { height?: number; index?: typeof crops } = {}) {
  const map = fakeMap();
  const root = document.createElement('div');
  Object.defineProperty(root, 'clientWidth', { value: 1000 });
  Object.defineProperty(root, 'clientHeight', { value: options.height ?? 800 });
  document.body.append(root);
  const popup = createFieldPopup({
    map: map as unknown as MapLibreMap,
    crops: options.index ?? crops,
    fields,
    root,
    iconManifest: {},
  });
  popups.push(popup);
  const open = (hit: Partial<FieldHit> = {}): void => {
    popup.openField({ id: 42, cropId: 1, other: undefined, acres: 1234.5, county: 'Fresno', ...hit }, [-119.5, 36.5]);
  };
  const node = (): HTMLElement | null => root.querySelector<HTMLElement>('.field-popup');
  return { popup, map, root, open, node };
}

describe('field card: content', () => {
  it('names the crop, its group and the field stats', () => {
    const { open, node, root } = mount();
    open();
    expect(node()?.getAttribute('role')).toBe('dialog');
    expect(node()?.getAttribute('aria-label')).toBe('Almonds');
    expect(root.querySelector('.fp-name')?.textContent).toBe('Almonds');
    expect(root.querySelector('.fp-group')?.textContent).toBe('Tree nuts');
    const stats = Array.from(root.querySelectorAll('.fp-stat'), (s) => s.textContent);
    expect(stats).toEqual(['1,234.5 acres', 'Fresno County']);
  });

  it('uses the singular "acre" only for exactly one acre', () => {
    const { open, root } = mount();
    open({ acres: 1 });
    expect(root.querySelector('.fp-stat')?.textContent).toBe('1.0 acre');
    open({ acres: 2 });
    expect(root.querySelector('.fp-stat')?.textContent).toBe('2.0 acres');
  });

  it('falls back to a generic card for a field with an unknown crop', () => {
    const { open, node, root } = mount();
    open({ cropId: 999 });
    expect(node()?.getAttribute('aria-label')).toBe('Field details');
    expect(root.querySelector('.fp-name')?.textContent).toBe('Farmland');
    expect(root.querySelector('.fp-group')).toBeNull();
    expect(root.querySelector('.fp-harvest')).toBeNull();
  });

  it('formats the county: blank means California, and "County" is not doubled', () => {
    const { open, root } = mount();
    const stat = (): string | undefined => root.querySelectorAll('.fp-stat')[1]?.textContent ?? undefined;
    open({ county: '' });
    expect(stat()).toBe('California');
    open({ county: 'Kern' });
    expect(stat()).toBe('Kern County');
    open({ county: 'Kern County' });
    expect(stat()).toBe('Kern County');
  });

  it('shows crop names and counties as text, never as markup', () => {
    const hostile = buildCropIndex([
      { ...RECORDS[0]!, name: '<img src=x onerror="alert(1)">', group: '<b>group</b>' },
    ]);
    const { open, root } = mount({ index: hostile });
    open({ county: '<i>Fresno</i>' });
    expect(root.querySelector('.fp-name img')).toBeNull();
    expect(root.querySelector('.fp-name')?.textContent).toBe('<img src=x onerror="alert(1)">');
    expect(root.querySelector('.fp-group b')).toBeNull();
    expect(root.querySelectorAll('.fp-stat i')).toHaveLength(0);
    expect(root.querySelectorAll('.fp-stat')[1]?.textContent).toBe('<i>Fresno</i> County');
  });
});

describe('field card: harvest calendar', () => {
  it('draws twelve month chips, lighting the harvest months', () => {
    const { open, root } = mount();
    open();
    const chips = Array.from(root.querySelectorAll<HTMLElement>('.fp-month'));
    expect(chips.map((c) => c.textContent)).toEqual(['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D']);
    expect(chips.filter((c) => c.classList.contains('is-on')).map((c) => c.textContent)).toEqual(['M', 'A', 'M', 'J']);
  });

  it('names each month correctly in its tooltip and accessible label', () => {
    const { open, root } = mount();
    open();
    const chips = Array.from(root.querySelectorAll<HTMLElement>('.fp-month'));
    expect(chips[2]?.getAttribute('title')).toBe('March: harvest');
    expect(chips[6]?.getAttribute('aria-label')).toBe('July');
    expect(chips[11]?.getAttribute('title')).toBe('December');
    expect(chips[3]?.getAttribute('aria-label')).toBe('April, harvest season');
  });

  it('says so when a crop is harvested all year', () => {
    const { open, root } = mount();
    open({ cropId: 3 });
    expect(root.querySelector('.fp-caption')?.textContent).toBe('Harvested year-round (approx.)');
    expect(root.querySelectorAll('.fp-month.is-ramp')).toHaveLength(12);
  });

  it('omits the strip for a crop with no harvest calendar', () => {
    const { open, root } = mount();
    open({ cropId: 2 });
    expect(root.querySelector('.fp-harvest')).toBeNull();
  });
});

describe('field card: also grown', () => {
  it('lists the other crops in the field, skipping this one, capped at six with a "+N" chip', () => {
    const { open, root } = mount();
    open({ other: '1,3,4,5,6,7,8,9,10' });
    const names = Array.from(root.querySelectorAll('.fp-chip-name'), (n) => n.textContent);
    expect(names).toEqual(['Walnuts', 'Corn', 'Rice', 'Cotton', 'Pears', 'Plums']);
    expect(root.querySelector('.fp-chip-more')?.textContent).toBe('+2');
  });

  it('drops unknown crop ids from the list', () => {
    const { open, root } = mount();
    open({ other: '1,3,999' });
    expect(Array.from(root.querySelectorAll('.fp-chip-name'), (n) => n.textContent)).toEqual(['Walnuts']);
  });

  it('omits the section when the field grows nothing else', () => {
    const { open, root } = mount();
    open({ other: undefined });
    expect(root.querySelector('.fp-also')).toBeNull();
  });
});

describe('field card: placement and layout', () => {
  it('opens above the field when there is room', () => {
    const { open, node } = mount();
    open();
    expect(node()?.dataset['placement']).toBe('above');
  });

  it('opens below the field when it sits too close to the top', () => {
    const { open, node, map } = mount();
    map.project.mockReturnValue({ x: 400, y: 50 });
    open();
    expect(node()?.dataset['placement']).toBe('below');
  });

  it('pans the map to make room when neither side fits', () => {
    const { open, node, map } = mount({ height: 100 });
    map.project.mockReturnValue({ x: 400, y: 50 });
    open();
    expect(node()?.dataset['placement']).toBe('above');
    // Needs 20px above, has -28px, so the point must move 48px down (viewport moves up).
    expect(map.panBy).toHaveBeenCalledWith([0, -48], expect.anything());
  });

  it('positions the card at the projected anchor point', () => {
    const { open, node, map } = mount();
    map.project.mockReturnValue({ x: 321.24, y: 210 });
    open();
    expect(node()?.style.transform).toBe('translate3d(321.2px, 210.0px, 0)');
  });

  it('flags the card as off-screen when the anchor leaves the viewport', () => {
    const { open, node, map } = mount();
    map.project.mockReturnValue({ x: -200, y: 300 });
    open();
    expect(node()?.classList.contains('is-offscreen')).toBe(true);
  });

  it('re-lays out the card when the map moves', () => {
    const { open, node, map } = mount();
    open();
    map.project.mockReturnValue({ x: 500, y: 300 });
    map.handlers.get('move')?.();
    expect(node()?.style.transform).toBe('translate3d(500.0px, 300.0px, 0)');
  });

  it('on phones, uses a bottom sheet with no pointer tail', () => {
    media.sheet = true;
    const { open, node, root } = mount();
    open();
    expect(node()?.dataset['placement']).toBe('sheet');
    expect(root.querySelector('.fp-tail')).toBeNull();
  });

  it('on phones, pans the map when the anchor would sit under the sheet', () => {
    media.sheet = true;
    const { open, map } = mount();
    map.project.mockReturnValue({ x: 400, y: 790 });
    open();
    expect(map.panBy).toHaveBeenCalledTimes(1);
    const offset = map.panBy.mock.calls[0]?.[0];
    expect(offset?.[1]).toBeGreaterThan(0);
  });

  it('on phones, leaves the map alone when the anchor is already above the sheet', () => {
    media.sheet = true;
    const { open, map } = mount();
    map.project.mockReturnValue({ x: 400, y: 300 });
    open();
    expect(map.panBy).not.toHaveBeenCalled();
  });
});

describe('field popup: opening and closing', () => {
  it('opening a field selects it on the map', () => {
    const { open } = mount();
    open({ id: 77 });
    expect(fields.setSelected).toHaveBeenLastCalledWith(77);
  });

  it('opening a second field replaces the first card', () => {
    const { open, root } = mount();
    open({ cropId: 1 });
    open({ cropId: 2 });
    expect(root.querySelectorAll('.field-popup')).toHaveLength(1);
    expect(root.querySelector('.fp-name')?.textContent).toBe('Grapes');
  });

  it('openAt opens the field under the pointer, and reports false when there is none', () => {
    const { popup } = mount();
    expect(popup.openAt([-119, 36])).toBe(false);
    fields.queryAt.mockReturnValue({ id: 5, cropId: 3, other: undefined, acres: 10, county: 'Kern' });
    expect(popup.openAt([-119, 36])).toBe(true);
    expect(popup.isOpen).toBe(true);
  });

  it('close() marks the card as closing, removes it after the animation, and clears the selection', () => {
    vi.useFakeTimers();
    const { popup, open, root } = mount();
    open();
    popup.close();
    expect(popup.isOpen).toBe(false);
    expect(fields.setSelected).toHaveBeenLastCalledWith(null);
    expect(root.querySelector('.field-popup')?.classList.contains('is-closing')).toBe(true);
    vi.advanceTimersByTime(200);
    expect(root.querySelector('.field-popup')).toBeNull();
  });

  it('the card close button dismisses the card', () => {
    const { popup, open, root } = mount();
    open();
    root.querySelector<HTMLButtonElement>('.fp-close')?.click();
    expect(popup.isOpen).toBe(false);
  });

  it('Escape anywhere on the page dismisses the card', () => {
    const { popup, open } = mount();
    open();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(popup.isOpen).toBe(false);
  });

  it('tapping a field on the map opens it, and tapping empty ground closes it', () => {
    const { popup, map } = mount();
    const onClick = map.handlers.get('click');
    const hit: FieldHit = { id: 9, cropId: 2, other: undefined, acres: 80, county: 'Tulare' };
    fields.queryAt.mockReturnValueOnce(hit);
    onClick?.({ point: [10, 10], lngLat: { lng: -119, lat: 36 } });
    expect(popup.isOpen).toBe(true);
    fields.queryAt.mockReturnValueOnce(null);
    onClick?.({ point: [10, 10], lngLat: { lng: -119, lat: 36 } });
    expect(popup.isOpen).toBe(false);
  });
});
