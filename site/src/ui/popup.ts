import type { LngLatLike, Map as MapLibreMap } from 'maplibre-gl';
import type { Crop, CropIndex } from '../data/crops';
import type { FieldHit, FieldsLayer } from '../layers/fields';
import { darken, mix, withAlpha } from '../lib/color';
import { iconUrl } from '../lib/icons';
import { prefersReducedMotion } from '../lib/motion';

export interface FieldPopup {
  /** Opens the card anchored at `lngLat` and marks the field as selected. */
  openField(hit: FieldHit, lngLat: LngLatLike): void;
  /** Queries the field under `lngLat` (must be at an interactive zoom) and opens it; false if none. */
  openAt(lngLat: LngLatLike): boolean;
  close(): void;
  readonly isOpen: boolean;
}

export interface FieldPopupOptions {
  map: MapLibreMap;
  crops: CropIndex;
  fields: FieldsLayer;
  root: HTMLElement;
  iconManifest: Record<string, string>;
}

const SHEET_QUERY = window.matchMedia('(max-width: 639px)');
const MONTH_LETTERS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'] as const;
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;
const MAX_ALSO_CHIPS = 6;
const CARD_GAP = 20;
const SCREEN_MARGIN = 12;
const TOP_CLEARANCE = 78;
const BOTTOM_CLEARANCE = 96;
const CLOSE_MS = 200;
const SWIPE_CLOSE_PX = 84;
const SWIPE_CLOSE_VELOCITY = 0.6;

const ACRES_ICON =
  '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M3 17.5 9 6l4 7 3-4 5 8.5z" fill="currentColor" opacity=".9"/></svg>';
const PIN_ICON =
  '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 2.5a6.5 6.5 0 0 0-6.5 6.5c0 4.6 6.5 12.5 6.5 12.5S18.5 13.6 18.5 9A6.5 6.5 0 0 0 12 2.5Zm0 8.8a2.3 2.3 0 1 1 0-4.6 2.3 2.3 0 0 1 0 4.6Z" fill="currentColor"/></svg>';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatAcres(acres: number): string {
  const text = acres.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `${text} ${text === '1.0' ? 'acre' : 'acres'}`;
}

const formatCounty = (county: string): string =>
  county === '' ? 'California' : /county$/i.test(county) ? county : `${county} County`;

function cropIcon(manifest: Record<string, string>, crop: Crop, className: string): HTMLImageElement {
  const img = el('img', className);
  img.src = iconUrl(manifest, crop.icon);
  img.alt = '';
  img.draggable = false;
  return img;
}

function applyCropTheme(node: HTMLElement, color: string): void {
  node.style.setProperty('--crop', color);
  node.style.setProperty('--crop-soft', mix(color, '#ffffff', 0.55));
  node.style.setProperty('--crop-tint', mix(color, '#ffffff', 0.84));
  node.style.setProperty('--crop-deep', darken(color, 0.25));
  node.style.setProperty('--crop-ink', darken(color, 0.62));
  node.style.setProperty('--crop-glow', withAlpha(color, 0.55));
  node.style.setProperty('--crop-ring', withAlpha(color, 0.22));
}

function buildHarvestStrip(crop: Crop, harvest: readonly boolean[]): HTMLElement {
  const wrap = el('section', 'fp-harvest');
  const months = el('div', 'fp-months');
  months.setAttribute('role', 'list');
  harvest.forEach((on, i) => {
    const chip = el('span', on ? 'fp-month is-on' : 'fp-month', MONTH_LETTERS[i]);
    chip.style.setProperty('--i', String(i));
    chip.setAttribute('role', 'listitem');
    chip.title = `${MONTH_NAMES[i]}${on ? ': harvest' : ''}`;
    chip.setAttribute('aria-label', `${MONTH_NAMES[i]}${on ? ', harvest season' : ''}`);
    months.append(chip);
  });
  wrap.append(months, el('p', 'fp-caption', 'Harvest (approx.)'));
  wrap.setAttribute('aria-label', `${crop.name} harvest months`);
  return wrap;
}

function buildAlso(others: readonly Crop[], manifest: Record<string, string>): HTMLElement {
  const wrap = el('section', 'fp-also');
  wrap.append(el('p', 'fp-caption', 'Also grown this year'));
  const chips = el('div', 'fp-chips');
  others.slice(0, MAX_ALSO_CHIPS).forEach((crop, i) => {
    const chip = el('span', 'fp-chip');
    chip.style.setProperty('--i', String(i));
    chip.style.setProperty('--chip', crop.color);
    chip.style.setProperty('--chip-soft', mix(crop.color, '#ffffff', 0.72));
    chip.append(cropIcon(manifest, crop, 'fp-chip-icon'), el('span', 'fp-chip-name', crop.name));
    chips.append(chip);
  });
  const extra = others.length - MAX_ALSO_CHIPS;
  if (extra > 0) chips.append(el('span', 'fp-chip fp-chip-more', `+${extra}`));
  wrap.append(chips);
  return wrap;
}

type Placement = 'above' | 'below' | 'sheet';

interface OpenState {
  lngLat: LngLatLike;
  placement: Placement;
  node: HTMLElement;
  card: HTMLElement;
  tail: HTMLElement | null;
}

export function createFieldPopup(options: FieldPopupOptions): FieldPopup {
  const { map, crops, fields, root, iconManifest } = options;
  let state: OpenState | null = null;
  let closeTimer: number | undefined;

  const buildCard = (hit: FieldHit, crop: Crop | undefined): HTMLElement => {
    const card = el('div', 'fp-card');
    const color = crop?.color ?? '#d8d3c4';
    applyCropTheme(card, color);

    const handle = el('div', 'fp-handle');
    handle.setAttribute('aria-hidden', 'true');

    const close = el('button', 'fp-close', '✕');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', () => api.close());

    const halo = el('div', 'fp-halo');
    if (crop) halo.append(cropIcon(iconManifest, crop, 'fp-icon'));

    const titles = el('div', 'fp-titles');
    titles.append(el('h2', 'fp-name', crop?.name ?? 'Farmland'));
    if (crop) titles.append(el('p', 'fp-group', crop.group));

    const head = el('div', 'fp-head');
    head.append(halo, titles);

    const stats = el('div', 'fp-stats');
    const acres = el('span', 'fp-stat');
    acres.insertAdjacentHTML('afterbegin', ACRES_ICON);
    acres.append(el('span', '', formatAcres(hit.acres)));
    const county = el('span', 'fp-stat');
    county.insertAdjacentHTML('afterbegin', PIN_ICON);
    county.append(el('span', '', formatCounty(hit.county)));
    stats.append(acres, county);

    card.append(handle, close, head, stats);
    if (crop?.harvest) card.append(buildHarvestStrip(crop, crop.harvest));
    const others = crops.parseOther(hit.other).filter((c) => c.cropId !== hit.cropId);
    if (others.length > 0) card.append(buildAlso(others, iconManifest));
    return card;
  };

  const layout = (s: OpenState): void => {
    const { x, y } = map.project(s.lngLat as Parameters<MapLibreMap['project']>[0]);
    const vw = root.clientWidth;
    const vh = root.clientHeight;
    if (s.placement === 'sheet') return;

    const w = s.card.offsetWidth;
    const h = s.card.offsetHeight;
    const offscreen = x < -60 || x > vw + 60 || y < -60 || y > vh + 60;
    s.node.classList.toggle('is-offscreen', offscreen);
    s.node.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;

    const left = Math.min(Math.max(-w / 2, SCREEN_MARGIN - x), vw - SCREEN_MARGIN - w - x);
    s.card.style.left = `${left}px`;
    const above = s.placement === 'above';
    s.card.style.top = above ? `${-(h + CARD_GAP)}px` : `${CARD_GAP}px`;
    s.node.style.setProperty('--ox', `${-left}px`);
    s.node.style.setProperty('--oy', above ? `${h + CARD_GAP}px` : `${-CARD_GAP}px`);
    if (s.tail) {
      s.tail.style.display = -left < 22 || -left > w - 22 ? 'none' : '';
    }
  };

  const choosePlacement = (s: OpenState): void => {
    const { y } = map.project(s.lngLat as Parameters<MapLibreMap['project']>[0]);
    const vh = root.clientHeight;
    const needed = s.card.offsetHeight + CARD_GAP;
    const roomAbove = y - TOP_CLEARANCE;
    const roomBelow = vh - BOTTOM_CLEARANCE - y;
    if (roomAbove >= needed) s.placement = 'above';
    else if (roomBelow >= needed) s.placement = 'below';
    else {
      s.placement = roomAbove >= roomBelow ? 'above' : 'below';
      map.panBy([0, s.placement === 'above' ? -(needed - roomAbove) : needed - roomBelow], {
        duration: prefersReducedMotion() ? 0 : 450,
      });
    }
  };

  const revealSheetPoint = (s: OpenState): void => {
    const { y } = map.project(s.lngLat as Parameters<MapLibreMap['project']>[0]);
    const vh = root.clientHeight;
    const visibleBottom = vh - s.card.offsetHeight - 36;
    if (y > visibleBottom) {
      const target = Math.max(TOP_CLEARANCE + 40, visibleBottom * 0.55);
      map.panBy([0, y - target], { duration: prefersReducedMotion() ? 0 : 450 });
    }
  };

  const onMove = (): void => {
    if (state) layout(state);
  };

  const attachSwipe = (card: HTMLElement): void => {
    let startY = 0;
    let startT = 0;
    let dy = 0;
    let dragging = false;

    card.addEventListener('pointerdown', (e) => {
      if (state?.placement !== 'sheet' || (e.target as HTMLElement).closest('button')) return;
      dragging = true;
      startY = e.clientY;
      startT = e.timeStamp;
      dy = 0;
      card.setPointerCapture(e.pointerId);
      card.style.transition = 'none';
    });
    card.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      dy = Math.max(0, e.clientY - startY);
      card.style.transform = `translateY(${dy}px)`;
    });
    const end = (e: PointerEvent): void => {
      if (!dragging) return;
      dragging = false;
      const velocity = dy / Math.max(1, e.timeStamp - startT);
      card.style.transition = '';
      card.style.transform = '';
      if (dy > SWIPE_CLOSE_PX || velocity > SWIPE_CLOSE_VELOCITY) api.close();
    };
    card.addEventListener('pointerup', end);
    card.addEventListener('pointercancel', end);
  };

  const teardown = (): void => {
    window.clearTimeout(closeTimer);
    root.querySelectorAll('.field-popup').forEach((n) => n.remove());
  };

  const api: FieldPopup & { isOpen: boolean } = {
    isOpen: false,

    openField(hit, lngLat) {
      teardown();
      const crop = crops.get(hit.cropId);
      const node = el('div', 'field-popup');
      node.setAttribute('role', 'dialog');
      node.setAttribute('aria-label', crop?.name ?? 'Field details');
      const card = buildCard(hit, crop);
      node.append(card);
      const tail = SHEET_QUERY.matches ? null : el('div', 'fp-tail');
      if (tail) {
        applyCropTheme(tail, crop?.color ?? '#d8d3c4');
        node.append(tail);
      }
      node.dataset['placement'] = SHEET_QUERY.matches ? 'sheet' : 'above';
      root.append(node);

      state = { lngLat, placement: SHEET_QUERY.matches ? 'sheet' : 'above', node, card, tail };
      if (state.placement === 'sheet') revealSheetPoint(state);
      else choosePlacement(state);
      node.dataset['placement'] = state.placement;
      layout(state);
      attachSwipe(card);
      fields.setSelected(hit.id);
      api.isOpen = true;
    },

    openAt(lngLat) {
      const { x, y } = map.project(lngLat as Parameters<MapLibreMap['project']>[0]);
      const hit = fields.queryAt([x, y]);
      if (!hit) return false;
      api.openField(hit, lngLat);
      return true;
    },

    close() {
      if (!state) return;
      const { node } = state;
      state = null;
      api.isOpen = false;
      fields.setSelected(null);
      node.classList.add('is-closing');
      closeTimer = window.setTimeout(() => node.remove(), prefersReducedMotion() ? 0 : CLOSE_MS);
    },
  };

  map.on('move', onMove);
  map.on('resize', onMove);
  map.on('click', (e) => {
    const hit = fields.queryAt(e.point);
    if (hit) api.openField(hit, e.lngLat);
    else api.close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') api.close();
  });

  return api;
}
