import type { Map as MapLibreMap } from 'maplibre-gl';
import '../styles/places.css';
import type { Crop } from '../data/crops';
import { solveFrame, type FramePadding } from '../lib/frame';
import { prefersReducedMotion } from '../lib/motion';
import type { IconManifest, SearchPlace, SearchTarget } from './emphasis';
import { cropImg, el, formatAcres, svg } from './format';
import { resolveBbox, resolvePlaces } from './places';

export interface Destinations {
  /** Fits the crop's statewide pattern and opens the "Where it grows" card under the search chip. */
  show(crop: Crop, target: SearchTarget): void;
  hide(): void;
  destroy(): void;
}

interface DestinationsOptions {
  map: MapLibreMap;
  manifest: IconManifest;
  cropPoints(cropId: number): readonly [number, number][];
  slot: HTMLElement;
}

const MOBILE = window.matchMedia('(max-width: 639px)');
const LEAVE_MS = 260;
const SWIPE_PX = 38;
const FIT_MAX_ZOOM = 10;
/** Margin around the places' bbox so the lit-up farms nearby stay in frame. */
const FIT_MARGIN = 0.12;
const CHEVRON_RIGHT = 'm9 5 7 7-7 7';
const CHEVRON_LEFT = 'm15 5-7 7 7 7';
const FIT_ICON = ['M4 9V5h4', 'M20 9V5h-4', 'M4 15v4h4', 'M20 15v4h-4'];

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

interface Session {
  crop: Crop;
  target: SearchTarget;
  places: readonly SearchPlace[];
  card: HTMLElement;
  rows: HTMLButtonElement[];
  active: number | null;
  setActive(index: number | null): void;
  step(dir: 1 | -1): void;
}

export function createDestinations({ map, manifest, cropPoints, slot }: DestinationsOptions): Destinations {
  let session: Session | null = null;
  let leaveTimer: number | undefined;

  const duration = (ms: number): number => (prefersReducedMotion() ? 0 : ms);

  /** Space the card (and the search chip above it) takes from the top of the viewport. */
  const topInset = (): number => slot.getBoundingClientRect().bottom;

  const fitOverview = (s: Session): void => {
    const [bw, bs, be, bn] = resolveBbox(s.target);
    // The places' bbox plus the crop's other region markers, so every lit-up farm cluster stays in frame.
    const pts: [number, number][] = [[bw, bs], [be, bn], ...cropPoints(s.crop.cropId)];
    const lngs = pts.map(([lng]) => lng);
    const lats = pts.map(([, lat]) => lat);
    const w = Math.min(...lngs);
    const e = Math.max(...lngs);
    const south = Math.min(...lats);
    const n = Math.max(...lats);
    // Keep the farms clear of the chip + card above and (on phones) the zoom buttons at the lower right.
    const padding: FramePadding = MOBILE.matches
      ? { top: topInset() + 14, bottom: 30, left: 24, right: 66 }
      : { top: topInset() + 14, bottom: 40, left: 90, right: 90 };
    const dLng = (e - w) * FIT_MARGIN;
    const dLat = (n - south) * FIT_MARGIN;
    const corners: [[number, number], [number, number], [number, number], [number, number]] = [
      [w - dLng, south - dLat],
      [e + dLng, south - dLat],
      [e + dLng, n + dLat],
      [w - dLng, n + dLat],
    ];
    const camera = solveFrame(map, [corners[0], corners[2]], corners, padding, FIT_MAX_ZOOM);
    map.flyTo({ ...camera, pitch: 0, bearing: 0, curve: 1.5, speed: 0.85, duration: duration(2200) });
  };

  const flyToPlace = (place: SearchPlace): void => {
    // Land the place in the open area below the card instead of dead centre.
    const offsetY = Math.max(0, topInset() / 2 - 8);
    map.flyTo({ center: place.center, zoom: place.zoom, curve: 1.6, speed: 1.1, offset: [0, offsetY], essential: false });
  };

  const buildRow = (
    crop: Crop,
    places: readonly SearchPlace[],
    place: SearchPlace,
    i: number,
  ): HTMLButtonElement => {
    const top = places[0]?.acres ?? place.acres;
    const row = el('button', 'dc-row');
    row.type = 'button';
    row.style.setProperty('--i', String(i));
    row.style.setProperty('--share', String(top > 0 ? Math.max(0.06, place.acres / top) : 1));
    row.setAttribute('aria-pressed', 'false');
    row.setAttribute('aria-label', `${i + 1}. ${place.label}, ${formatAcres(place.acres)} acres. Fly there`);
    const halo = el('span', 'dc-halo');
    halo.append(cropImg(manifest, crop, 'dc-icon'), el('span', 'dc-rank', String(i + 1)));
    const text = el('span', 'dc-text');
    text.append(el('span', 'dc-label', place.label), el('span', 'dc-sub', `${formatAcres(place.acres)} acres`));
    const bar = el('span', 'dc-bar');
    bar.append(el('i'));
    row.append(halo, text, bar, svg('dc-go', [CHEVRON_RIGHT], 2.8));
    return row;
  };

  const teardownSession = (): void => {
    if (!session) return;
    const { card } = session;
    session = null;
    card.classList.add('is-leaving');
    window.setTimeout(() => card.remove(), duration(LEAVE_MS));
  };

  const build = (crop: Crop, target: SearchTarget): Session => {
    const places = resolvePlaces(target);
    const card = el('section', 'dc glass');
    card.style.setProperty('--crop', crop.color);
    card.setAttribute('aria-label', `Where ${crop.name} grows`);

    const head = el('header', 'dc-head');
    const title = el('h2', 'dc-title', 'Where it grows');
    const total = el('span', 'dc-total');
    total.append(el('b', undefined, formatAcres(target.acres_total)), ' acres statewide');
    const overview = el('button', 'dc-overview');
    overview.type = 'button';
    overview.setAttribute('aria-label', 'Zoom out to see every place');
    overview.append(svg('dc-fit', FIT_ICON, 2.6), el('span', undefined, 'All'));
    head.append(title, total, overview);

    const list = el('ol', 'dc-list');
    const rows = places.map((place, i) => buildRow(crop, places, place, i));
    for (const row of rows) {
      const item = el('li', 'dc-item');
      item.append(row);
      list.append(item);
    }

    const pager = el('div', 'dc-pager');
    const prev = el('button', 'dc-nav');
    prev.type = 'button';
    prev.setAttribute('aria-label', 'Previous place');
    prev.append(svg('dc-nav-icon', [CHEVRON_LEFT], 3));
    const next = el('button', 'dc-nav');
    next.type = 'button';
    next.setAttribute('aria-label', 'Next place');
    next.append(svg('dc-nav-icon', [CHEVRON_RIGHT], 3));
    const stage = el('div', 'dc-stage');
    const stageBody = el('div', 'dc-stage-body');
    stage.append(stageBody);
    const count = el('div', 'dc-count');
    const dots = el('div', 'dc-dots');
    dots.setAttribute('aria-hidden', 'true');
    places.forEach(() => dots.append(el('i')));
    const meta = el('div', 'dc-meta');
    meta.append(count, dots);
    const mid = el('div', 'dc-mid');
    mid.append(stage, meta);
    pager.append(prev, mid, next);

    card.append(head, list, pager);
    slot.append(card);

    const s: Session = {
      crop,
      target,
      places,
      card,
      rows,
      active: null,
      step(dir) {
        const n = places.length;
        const from = s.active ?? (dir === 1 ? -1 : 0);
        select((from + dir + n) % n);
      },
      setActive(index) {
        s.active = index;
        rows.forEach((row, i) => {
          row.setAttribute('aria-pressed', String(i === index));
          row.classList.toggle('is-active', i === index);
        });
        dots.querySelectorAll('i').forEach((d, i) => d.classList.toggle('is-on', i === index));
        card.dataset['active'] = index === null ? '' : String(index);
        renderStage();
      },
    };

    const renderStage = (): void => {
      stageBody.textContent = '';
      const place = s.active === null ? undefined : places[s.active];
      if (s.active === null || !place) {
        count.textContent = plural(places.length, 'place');
        stageBody.append(
          el('span', 'dc-stage-hint', places.length > 1 ? 'Swipe or tap › to explore' : 'Tap › to fly there'),
        );
        return;
      }
      count.textContent = `${s.active + 1} of ${places.length}`;
      const halo = el('span', 'dc-halo');
      halo.append(cropImg(manifest, crop, 'dc-icon'), el('span', 'dc-rank', String(s.active + 1)));
      const text = el('span', 'dc-text');
      text.append(el('span', 'dc-label', place.label), el('span', 'dc-sub', `${formatAcres(place.acres)} acres`));
      stageBody.append(halo, text);
      stageBody.classList.remove('is-pop');
      void stageBody.offsetWidth;
      stageBody.classList.add('is-pop');
    };


    rows.forEach((row, i) => row.addEventListener('click', () => select(i)));
    prev.addEventListener('click', () => s.step(-1));
    next.addEventListener('click', () => s.step(1));
    overview.addEventListener('click', () => {
      s.setActive(null);
      fitOverview(s);
    });

    let startX = 0;
    let dx = 0;
    let dragging = false;
    stage.addEventListener('pointerdown', (e) => {
      dragging = true;
      startX = e.clientX;
      dx = 0;
      stage.setPointerCapture(e.pointerId);
    });
    stage.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      dx = e.clientX - startX;
      stageBody.style.transform = `translateX(${Math.max(-40, Math.min(40, dx * 0.5))}px)`;
    });
    const endSwipe = (): void => {
      if (!dragging) return;
      dragging = false;
      stageBody.style.transform = '';
      if (Math.abs(dx) > SWIPE_PX) s.step(dx < 0 ? 1 : -1);
    };
    stage.addEventListener('pointerup', endSwipe);
    stage.addEventListener('pointercancel', endSwipe);

    return s;
  };

  function select(index: number): void {
    const s = session;
    const place = s?.places[index];
    if (!s || !place) return;
    s.setActive(index);
    flyToPlace(place);
  }

  const onKeyDown = (e: KeyboardEvent): void => {
    if (!session || e.target instanceof HTMLInputElement) return;
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    session.step(e.key === 'ArrowRight' ? 1 : -1);
  };
  slot.addEventListener('keydown', onKeyDown);

  return {
    show(crop, target) {
      window.clearTimeout(leaveTimer);
      teardownSession();
      const s = build(crop, target);
      session = s;
      s.setActive(null);
      if (s.places.length === 1 && s.places[0]) {
        s.setActive(0);
        flyToPlace(s.places[0]);
      } else {
        fitOverview(s);
      }
    },
    hide: teardownSession,
    destroy() {
      slot.removeEventListener('keydown', onKeyDown);
      teardownSession();
    },
  };
}
