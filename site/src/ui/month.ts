import type { ExpressionSpecification, Map as MapLibreMap } from 'maplibre-gl';
import '../styles/month.css';
import type { CropIndex } from '../data/crops';
import {
  FIELD_FILL_LAYER_ID,
  FIELD_GLOW_LAYER_ID,
  FIELDS_LAYER,
  FIELDS_SOURCE,
} from '../layers/fields';
import { darken } from '../lib/color';
import { iconUrl } from '../lib/icons';
import { prefersReducedMotion } from '../lib/motion';
import { MONTH_NAMES, type EmphasisController, type IconManifest, type RegionsSearch } from './emphasis';

interface MonthOptions {
  map: MapLibreMap;
  crops: CropIndex;
  regionsSearch: RegionsSearch;
  manifest: IconManifest;
  emphasis: EmphasisController;
  slot: HTMLElement;
  popupRoot: HTMLElement | null;
}

export interface MonthControl {
  destroy(): void;
}

const BLOOM_LAYER_ID = 'fields-bloom';
const BLOOM_DEEPEN = 0.12;
const BLOOM_MIN = 0.42;
const BLOOM_MAX = 0.9;
const BLOOM_PERIOD_MS = 2000;
const BLOOM_FADE_MS = 520;
const BLOOM_FRAME_MS = 32;
const BLOOM_MIN_ZOOM = 8.8;
const PLAY_INTERVAL_MS = 1400;
const COMMIT_DELAY_MS = 130;
const TOP_ICONS = 3;
const LETTERS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'] as const;

const SVG_NS = 'http://www.w3.org/2000/svg';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function svgPath(className: string, d: string, viewBox = '0 0 24 24'): SVGSVGElement {
  const node = document.createElementNS(SVG_NS, 'svg');
  node.setAttribute('viewBox', viewBox);
  node.setAttribute('class', className);
  node.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', d);
  p.setAttribute('fill', 'currentColor');
  node.append(p);
  return node;
}

const PLAY_PATH = 'M8.2 5.3c0-1.1 1.2-1.8 2.2-1.2l9 5.9c.9.6.9 1.9 0 2.5l-9 5.9c-1 .6-2.2-.1-2.2-1.2V5.3Z';
const PAUSE_PATH =
  'M7 4.5h3.2c.7 0 1.3.6 1.3 1.3v12.4c0 .7-.6 1.3-1.3 1.3H7c-.7 0-1.3-.6-1.3-1.3V5.8c0-.7.6-1.3 1.3-1.3Zm6.8 0H17c.7 0 1.3.6 1.3 1.3v12.4c0 .7-.6 1.3-1.3 1.3h-3.2c-.7 0-1.3-.6-1.3-1.3V5.8c0-.7.6-1.3 1.3-1.3Z';

/** Opacity must be a camera-only expression: data-driven paint changes would re-layout every tile. */
const zoomFade = (o: number): ExpressionSpecification =>
  ['interpolate', ['linear'], ['zoom'], 9, 0, 9.9, o * 0.85, 12, o] as ExpressionSpecification;

const idFilter = (ids: readonly number[]): ExpressionSpecification =>
  ['in', ['get', 'crop_id'], ['literal', [...ids]]] as ExpressionSpecification;

interface Bloom {
  setCrops(ids: readonly number[]): void;
  destroy(): void;
}

function createBloom(map: MapLibreMap, crops: CropIndex): Bloom {
  if (!map.getLayer(FIELD_FILL_LAYER_ID)) return { setCrops() {}, destroy() {} };

  const pairs = crops.list.flatMap((c) => [c.cropId, darken(c.color, BLOOM_DEEPEN)]);
  const color = (pairs.length > 0
    ? ['match', ['get', 'crop_id'], ...pairs, '#ffffff']
    : '#ffffff') as ExpressionSpecification | string;

  map.addLayer(
    {
      id: BLOOM_LAYER_ID,
      type: 'fill',
      source: FIELDS_SOURCE,
      'source-layer': FIELDS_LAYER,
      minzoom: 9,
      filter: idFilter([]),
      paint: {
        'fill-color': color,
        'fill-opacity': 0,
        'fill-opacity-transition': { duration: 0, delay: 0 },
        'fill-antialias': false,
      },
    },
    map.getLayer(FIELD_GLOW_LAYER_ID) ? FIELD_GLOW_LAYER_ID : undefined,
  );

  let amp = 0;
  let target = 0;
  let raf = 0;
  let lastFrame = 0;
  let shown = -1;
  const t0 = performance.now();

  const stop = (): void => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };

  const frame = (now: number): void => {
    raf = requestAnimationFrame(frame);
    const dt = now - lastFrame;
    if (dt < BLOOM_FRAME_MS) return;
    lastFrame = now;

    const step = dt / BLOOM_FADE_MS;
    amp = target > amp ? Math.min(target, amp + step) : Math.max(target, amp - step);

    const reduced = prefersReducedMotion();
    const wave = reduced ? 1 : (1 - Math.cos((2 * Math.PI * (now - t0)) / BLOOM_PERIOD_MS)) / 2;
    const opacity = amp * (reduced ? BLOOM_MAX : BLOOM_MIN + (BLOOM_MAX - BLOOM_MIN) * wave);

    if (map.getZoom() >= BLOOM_MIN_ZOOM && Math.abs(opacity - shown) > 0.003) {
      shown = opacity;
      map.setPaintProperty(BLOOM_LAYER_ID, 'fill-opacity', zoomFade(opacity));
    }
    if (amp === target && (reduced || target === 0)) {
      if (target === 0) map.setFilter(BLOOM_LAYER_ID, idFilter([]));
      stop();
    }
  };

  const start = (): void => {
    if (raf) return;
    lastFrame = 0;
    raf = requestAnimationFrame(frame);
  };

  const onZoomEnd = (): void => {
    shown = -1;
  };
  map.on('zoomend', onZoomEnd);

  return {
    setCrops(ids) {
      target = ids.length > 0 ? 1 : 0;
      if (ids.length > 0) map.setFilter(BLOOM_LAYER_ID, idFilter(ids));
      start();
    },
    destroy() {
      stop();
      map.off('zoomend', onZoomEnd);
      if (map.getLayer(BLOOM_LAYER_ID)) map.removeLayer(BLOOM_LAYER_ID);
    },
  };
}

/** Acreage-weighted share of statewide crops in harvest for each month, 0..1. */
function seasonCurve(crops: CropIndex, regionsSearch: RegionsSearch): number[] {
  const sums = Array<number>(12).fill(0);
  for (const crop of crops.list) {
    const acres = regionsSearch[String(crop.cropId)]?.acres_total ?? 0;
    crop.harvest?.forEach((on, m) => {
      if (on) sums[m] = (sums[m] ?? 0) + acres;
    });
  }
  const max = Math.max(...sums, 1);
  return sums.map((s) => s / max);
}

export function createMonth({
  map,
  crops,
  regionsSearch,
  manifest,
  emphasis,
  slot,
  popupRoot,
}: MonthOptions): MonthControl {
  const bloom = createBloom(map, crops);
  const curve = seasonCurve(crops, regionsSearch);

  const root = el('section', 'cm-root glass');
  root.setAttribute('aria-label', 'Harvest month');

  const top = el('div', 'cm-top');
  const play = el('button', 'cm-play');
  play.type = 'button';
  play.setAttribute('aria-label', 'Play through the months');
  const playIcon = svgPath('cm-play-icon', PLAY_PATH);
  const pauseIcon = svgPath('cm-pause-icon', PAUSE_PATH);
  play.append(playIcon, pauseIcon);

  const info = el('div', 'cm-info');
  const title = el('div', 'cm-title');
  const sub = el('div', 'cm-sub');
  info.append(title, sub);

  const allBtn = el('button', 'cm-all');
  allBtn.type = 'button';
  allBtn.append(el('span', 'cm-all-dot'), el('span', undefined, 'All year'));

  top.append(play, info, allBtn);

  const track = el('div', 'cm-track');
  track.tabIndex = 0;
  track.setAttribute('role', 'slider');
  track.setAttribute('aria-label', 'Harvest month');
  track.setAttribute('aria-orientation', 'horizontal');
  track.setAttribute('aria-valuemin', '0');
  track.setAttribute('aria-valuemax', '12');
  const cols = el('div', 'cm-cols');
  LETTERS.forEach((letter, m) => {
    const col = el('span', 'cm-col');
    col.style.setProperty('--h', String(0.18 + 0.82 * (curve[m] ?? 0)));
    col.append(el('span', 'cm-letter', letter));
    cols.append(col);
  });
  const thumb = el('div', 'cm-thumb');
  const thumbLetter = el('span', 'cm-thumb-letter');
  thumb.append(thumbLetter);
  cols.append(thumb);
  track.append(cols);

  root.append(top, track);
  slot.append(root);

  let uiMonth: number | null = null;
  let playing = false;
  let playTimer = 0;
  let commitTimer = 0;
  let dragging = false;
  let renderedMonth: number | null | undefined;
  let renderedHint: string | null = null;

  const reveal = (node: HTMLElement): void => {
    if (prefersReducedMotion()) return;
    node.animate(
      [
        { opacity: 0, transform: 'translateY(7px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ],
      { duration: 380, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' },
    );
  };

  const topCrops = (month: number) =>
    crops
      .harvestingIn(month)
      .map((id) => ({ id, acres: regionsSearch[String(id)]?.acres_total ?? 0 }))
      .sort((a, b) => b.acres - a.acres);

  const renderInfo = (): void => {
    const hint = emphasis.state.month === uiMonth ? emphasis.state.hint : null;
    const monthChanged = uiMonth !== renderedMonth;
    if (!monthChanged && hint === renderedHint) return;
    renderedMonth = uiMonth;
    renderedHint = hint;

    if (monthChanged) {
      title.textContent = '';
      if (uiMonth === null) {
        title.append(el('span', 'cm-title-main', 'What’s in season?'));
      } else {
        title.append('Harvest in ', el('strong', 'cm-month-name', MONTH_NAMES[uiMonth]));
      }
      reveal(title);
    }

    sub.textContent = '';
    if (uiMonth === null) {
      sub.append(el('span', 'cm-prompt', 'Drag the month or press play'));
    } else if (hint) {
      const pill = el('span', 'cm-hint', hint);
      pill.setAttribute('role', 'status');
      sub.append(pill);
    } else {
      const ranked = topCrops(uiMonth);
      const row = el('span', 'cm-icons');
      const names: string[] = [];
      ranked.slice(0, TOP_ICONS).forEach(({ id }, i) => {
        const crop = crops.get(id);
        if (!crop) return;
        names.push(crop.name);
        const bubble = el('span', 'cm-bubble');
        bubble.style.setProperty('--i', String(i));
        bubble.style.setProperty('--crop', crop.color);
        bubble.title = crop.name;
        const img = el('img', 'cm-icon');
        img.src = iconUrl(manifest, crop.icon);
        img.alt = '';
        img.draggable = false;
        bubble.append(img);
        row.append(bubble);
      });
      const more = ranked.length - TOP_ICONS;
      sub.append(row);
      if (more > 0) sub.append(el('span', 'cm-more', `+${more} more`));
      const sr = el('span', 'cm-sr', `Top harvests: ${names.join(', ')}`);
      sub.append(sr);
    }
  };

  const renderValue = (pos: number): void => {
    const idx = Math.round(pos);
    thumb.style.setProperty('--pos', String(pos));
    thumbLetter.textContent = LETTERS[Math.min(11, Math.max(0, idx))] ?? '';
  };

  /** Jumps the thumb to its slot without sliding in from the hidden "All year" position. */
  const snapThumb = (pos: number): void => {
    thumb.classList.add('is-snap');
    renderValue(pos);
    void thumb.offsetWidth;
    thumb.classList.remove('is-snap');
  };

  const render = (): void => {
    root.dataset['state'] = uiMonth === null ? 'all' : 'month';
    allBtn.setAttribute('aria-pressed', String(uiMonth === null));
    const value = uiMonth === null ? 0 : uiMonth + 1;
    track.setAttribute('aria-valuenow', String(value));
    track.setAttribute('aria-valuetext', uiMonth === null ? 'All year' : (MONTH_NAMES[uiMonth] ?? ''));
    if (!dragging && uiMonth !== null) renderValue(uiMonth);
    renderInfo();
  };

  const commitNow = (): void => {
    window.clearTimeout(commitTimer);
    commitTimer = 0;
    emphasis.setMonth(uiMonth);
  };

  const commitSoon = (): void => {
    window.clearTimeout(commitTimer);
    commitTimer = window.setTimeout(commitNow, COMMIT_DELAY_MS);
  };

  const setMonth = (month: number | null, immediate: boolean): void => {
    if (month === uiMonth) {
      if (immediate) commitNow();
      return;
    }
    if (uiMonth === null && month !== null) snapThumb(month);
    uiMonth = month;
    render();
    if (immediate) commitNow();
    else commitSoon();
  };

  const setPlaying = (next: boolean): void => {
    playing = next;
    window.clearTimeout(playTimer);
    root.classList.toggle('is-playing', next);
    play.setAttribute('aria-label', next ? 'Pause' : 'Play through the months');
    play.setAttribute('aria-pressed', String(next));
    if (!next) return;
    const tick = (): void => {
      setMonth(uiMonth === null ? 0 : (uiMonth + 1) % 12, true);
      playTimer = window.setTimeout(tick, PLAY_INTERVAL_MS);
    };
    tick();
  };

  const pause = (): void => {
    if (playing) setPlaying(false);
  };

  const monthAt = (clientX: number): number => {
    const rect = cols.getBoundingClientRect();
    const pos = ((clientX - rect.left) / rect.width) * 12 - 0.5;
    return Math.min(11, Math.max(0, pos));
  };

  const onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    pause();
    dragging = true;
    track.setPointerCapture(e.pointerId);
    track.classList.add('is-dragging');
    const pos = monthAt(e.clientX);
    if (uiMonth === null) snapThumb(pos);
    renderValue(pos);
    setMonth(Math.round(pos), false);
  };

  const onPointerMove = (e: PointerEvent): void => {
    if (!dragging) return;
    const pos = monthAt(e.clientX);
    renderValue(pos);
    setMonth(Math.round(pos), false);
  };

  const endDrag = (e: PointerEvent): void => {
    if (!dragging) return;
    dragging = false;
    if (track.hasPointerCapture(e.pointerId)) track.releasePointerCapture(e.pointerId);
    track.classList.remove('is-dragging');
    if (uiMonth !== null) renderValue(uiMonth);
    commitNow();
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    const value = uiMonth === null ? 0 : uiMonth + 1;
    let next: number | null = null;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        next = Math.min(12, value + 1);
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        next = Math.max(0, value - 1);
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = 12;
        break;
      case 'PageUp':
        next = Math.min(12, value + 3);
        break;
      case 'PageDown':
        next = Math.max(0, value - 3);
        break;
      default:
        return;
    }
    e.preventDefault();
    pause();
    setMonth(next === 0 ? null : next - 1, true);
  };

  const onPlayClick = (): void => setPlaying(!playing);
  const onAllClick = (): void => {
    pause();
    setMonth(null, true);
  };

  const unsubscribe = emphasis.subscribe((state) => {
    bloom.setCrops(state.bloom);
    renderInfo();
  });

  const syncTucked = (): void => {
    const sheet = popupRoot?.querySelector('.field-popup[data-placement="sheet"]:not(.is-closing)');
    const tucked = sheet !== null && sheet !== undefined;
    if (tucked) pause();
    root.classList.toggle('is-tucked', tucked);
    root.inert = tucked;
  };

  const observer = new MutationObserver(syncTucked);
  if (popupRoot) {
    observer.observe(popupRoot, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'data-placement'],
    });
  }

  track.addEventListener('pointerdown', onPointerDown);
  track.addEventListener('pointermove', onPointerMove);
  track.addEventListener('pointerup', endDrag);
  track.addEventListener('pointercancel', endDrag);
  track.addEventListener('keydown', onKeyDown);
  play.addEventListener('click', onPlayClick);
  allBtn.addEventListener('click', onAllClick);

  setPlaying(false);
  render();
  renderValue(0);

  return {
    destroy() {
      window.clearTimeout(playTimer);
      window.clearTimeout(commitTimer);
      observer.disconnect();
      unsubscribe();
      bloom.destroy();
      root.remove();
    },
  };
}
