import type { LngLatLike, Map as MapLibreMap } from 'maplibre-gl';
import type { Crop, CropIndex } from '../data/crops';
import { computeEconomics, type CropEconomics, type EconomicsIndex } from '../data/economics';
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
  economics: EconomicsIndex;
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
  const yearRound = harvest.every(Boolean);
  const pale = mix(crop.color, '#ffffff', 0.5);
  harvest.forEach((on, i) => {
    const chip = el('span', on ? 'fp-month is-on' : 'fp-month', MONTH_LETTERS[i]);
    if (yearRound) {
      chip.style.setProperty('--ga', mix(pale, crop.color, i / 12));
      chip.style.setProperty('--gb', mix(pale, crop.color, (i + 1) / 12));
      chip.classList.add('is-ramp');
    }
    chip.style.setProperty('--i', String(i));
    chip.setAttribute('role', 'listitem');
    chip.title = `${MONTH_NAMES[i]}${on ? ': harvest' : ''}`;
    chip.setAttribute('aria-label', `${MONTH_NAMES[i]}${on ? ', harvest season' : ''}`);
    months.append(chip);
  });
  wrap.append(months, el('p', 'fp-caption', yearRound ? 'Harvested year-round (approx.)' : 'Harvest (approx.)'));
  wrap.setAttribute('aria-label', `${crop.name} harvest months`);
  return wrap;
}

const usd = (n: number, opts: Intl.NumberFormatOptions = {}): string =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0, ...opts });

const signedUsd = (n: number, opts?: Intl.NumberFormatOptions): string =>
  `${n < 0 ? '−' : '+'}${usd(Math.abs(n), opts)}`;

const signedPct = (n: number): string => `${n < 0 ? '−' : ''}${Math.abs(Math.round(n * 100))}%`;

const COMPACT: Intl.NumberFormatOptions = { notation: 'compact', maximumFractionDigits: 1 };

/** "$2.20/lb", "$259/ton": cents only when the unit price is small. */
const unitPrice = (price: number, unit: string): string =>
  `${usd(price, price < 20 ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : {})}/${unit}`;

const formatYield = (n: number, unit: string): string =>
  `${n.toLocaleString('en-US', { maximumFractionDigits: n < 100 ? 2 : 0 })} ${unit}`;

function sourceLink(label: string, url: string): HTMLElement {
  if (!url) return el('span', '', label);
  const a = el('a', 'fp-econ-link', label);
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

/** "* 2024 data": the year behind the yield and price (sources are in the breakdown). */
function basisLine(e: CropEconomics): string {
  return `* ${e.year} data${e.isStatewide ? ' (California average)' : ''}`;
}

function buildEconomics(e: CropEconomics, acres: number, onToggle: () => void): HTMLElement {
  const r = computeEconomics(e, acres);
  const toneOf = (n: number): string => (n >= 0 ? 'is-gain' : 'is-loss');
  const tone = toneOf(r.netPerAcre);

  const wrap = el('details', `fp-econ ${tone}`);
  wrap.addEventListener('toggle', onToggle);

  const summary = el('summary', 'fp-econ-summary');
  // A loss is labeled in words; a lone minus sign reads like a "no data" dash.
  const isLoss = r.netPerAcre < 0;
  const label = el('span', 'fp-econ-label', isLoss ? 'Loss/acre' : 'Profit/acre');
  const value = el('span', 'fp-econ-value', isLoss ? usd(-r.netPerAcre) : signedUsd(r.netPerAcre));
  const field = el(
    'span',
    'fp-econ-field',
    isLoss ? `${usd(-r.net, COMPACT)} loss` : `${signedUsd(r.net, COMPACT)} field`,
  );
  field.title = `${signedUsd(r.net)} after land for this ${acres.toFixed(1)}-acre field`;
  const chevron = el('span', 'fp-econ-chevron');
  chevron.setAttribute('aria-hidden', 'true');
  const basis = el('span', 'fp-econ-basis', basisLine(e));
  summary.append(label, value, field, chevron, basis);

  const table = el('div', 'fp-econ-table');
  table.setAttribute('role', 'table');
  const row = (cls: string, name: string, perAcre: string, total: string, note?: string): void => {
    const tr = el('div', `fp-econ-row ${cls}`);
    tr.setAttribute('role', 'row');
    const nameCell = el('span', 'fp-econ-name', name);
    nameCell.setAttribute('role', 'cell');
    if (note) nameCell.append(el('small', 'fp-econ-note', note));
    const a = el('span', 'fp-econ-num', perAcre);
    const b = el('span', 'fp-econ-num', total);
    a.setAttribute('role', 'cell');
    b.setAttribute('role', 'cell');
    tr.append(nameCell, a, b);
    table.append(tr);
  };

  row('is-head', '', 'Per acre', 'This field');
  const salesNote = `${e.variant ? `${e.variant} · ` : ''}${formatYield(e.yield, e.unit)} × ${unitPrice(e.price, e.unit)}${e.extras.map((x) => ` + ${x.label.toLowerCase()}`).join('')}`;
  row('', 'Crop sales', usd(r.revenuePerAcre), usd(r.revenue), salesNote);
  row('', 'Growing cost', `−${usd(r.costPerAcre)}`, `−${usd(r.cost)}`, 'seed, water, labor, harvest…');
  row(
    `is-subtotal ${toneOf(r.grossPerAcre)}`,
    'Gross profit',
    signedUsd(r.grossPerAcre),
    signedUsd(r.gross),
    `${signedPct(r.margin)} margin`,
  );
  row(
    '',
    'Land cost',
    `−${usd(r.landPerAcre)}`,
    `−${usd(r.land)}`,
    e.landBasis === 'rent' ? 'cash rent' : 'cost of capital on owned land',
  );
  row(
    `is-total ${tone}`,
    'Profit after land',
    signedUsd(r.netPerAcre),
    signedUsd(r.net),
    `${signedPct(r.netMargin)} margin`,
  );

  const breakEven = el(
    'p',
    'fp-econ-breakeven',
    `Breaks even at ${unitPrice(r.breakEvenPriceWithLand, e.unit)} with land, ${unitPrice(r.breakEvenPrice, e.unit)} without (sold at ${unitPrice(e.price, e.unit)})`,
  );

  const scope = e.isStatewide ? 'California average' : formatCounty(e.county);
  const sources = el('dl', 'fp-econ-sources');
  const fact = (term: string, ...lines: (string | Node)[]): void => {
    const dd = el('dd', 'fp-econ-dd');
    for (const line of lines) {
      const div = el('div', 'fp-econ-line');
      div.append(line);
      dd.append(div);
    }
    sources.append(el('dt', 'fp-econ-dt', term), dd);
  };
  if (e.variant && e.variantShare !== null) {
    fact('Assumes', `${e.variant}: ${Math.round(e.variantShare * 100)}% of these acres in ${scope}`);
  }
  fact('Yield & price', `${scope} · ${e.year}`, sourceLink(e.revenueSource.label, e.revenueSource.url));
  fact('Growing cost', sourceLink(e.costSource.label, e.costSource.url), ...e.costSteps);
  fact('Land cost', ...e.landSteps);
  fact('Not included', 'Taxes, depreciation, orchard/vineyard establishment');
  if (e.costCaveat) fact('Note', e.costCaveat);

  const body = el('div', 'fp-econ-body');
  body.append(table, breakEven, sources);
  wrap.append(summary, body);
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
  const { map, crops, fields, root, iconManifest, economics } = options;
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
    const econ = economics.get(hit.cropId, hit.county);
    if (econ) card.append(buildEconomics(econ, hit.acres, onResize));
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
    // Never taller than one side of the screen can hold, so panning always keeps the field in view.
    s.card.style.maxHeight = `${Math.max(240, vh - TOP_CLEARANCE - BOTTOM_CLEARANCE - CARD_GAP - SCREEN_MARGIN * 2)}px`;
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

  /** The card changed height (breakdown opened/closed): re-fit it on screen. */
  const onResize = (): void => {
    if (!state) return;
    if (state.placement === 'sheet') revealSheetPoint(state);
    else choosePlacement(state);
    state.node.dataset['placement'] = state.placement;
    layout(state);
  };

  const attachSwipe = (card: HTMLElement): void => {
    let startY = 0;
    let startT = 0;
    let dy = 0;
    let dragging = false;

    card.addEventListener('pointerdown', (e) => {
      const target = e.target as HTMLElement;
      if (state?.placement !== 'sheet' || target.closest('button, summary, a')) return;
      // Once the sheet is scrolled, only the handle/header drags it closed; elsewhere it scrolls.
      if (card.scrollTop > 0 && !target.closest('.fp-handle, .fp-head')) return;
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
      // Scrolling a tall card shouldn't zoom the map underneath.
      card.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
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
