import type { Map as MapLibreMap } from 'maplibre-gl';
import '../styles/legend.css';
import type { Crop, CropIndex } from '../data/crops';
import { FIELD_FILL_LAYER_ID } from '../layers/fields';
import { prefersReducedMotion } from '../lib/motion';
import type { EmphasisController, EmphasisState, IconManifest } from './emphasis';
import { cropImg, el, svg } from './format';

interface LegendOptions {
  map: MapLibreMap;
  crops: CropIndex;
  manifest: IconManifest;
  emphasis: EmphasisController;
  slot: HTMLElement;
  popupRoot: HTMLElement;
}

export interface Legend {
  destroy(): void;
}

interface Entry {
  crop: Crop;
  acres: number;
  share: number;
}

interface RowParts {
  item: HTMLLIElement;
  button: HTMLButtonElement;
  pct: HTMLElement;
  bar: HTMLElement;
}

const SHOW_ZOOM = 9.8;
const HIDE_ZOOM = 9.6;
const TOP_COUNT = 8;
const REFRESH_DEBOUNCE_MS = 140;
const HOVER_IN_MS = 130;
const HOVER_OUT_MS = 70;
const FLIP_MS = 460;
const SPRING = 'cubic-bezier(0.34, 1.56, 0.64, 1)';
const SHEET_QUERY = window.matchMedia('(max-width: 639px)');
const CHECK = 'm5 12.5 4.5 4.5L19 7.5';
const CHEVRON_DOWN = 'm6 9 6 6 6-6';
const CLOSE = ['M6 6l12 12', 'M18 6 6 18'];

const formatShare = (share: number): string => {
  const pct = share * 100;
  if (pct < 1) return '<1%';
  return `${Math.round(pct)}%`;
};

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

const sameRanking = (a: readonly Entry[], b: readonly Entry[]): boolean =>
  a.length === b.length && a.every((e, i) => e.crop.cropId === b[i]?.crop.cropId && e.acres === b[i]?.acres);

export function createLegend({ map, crops, manifest, emphasis, slot, popupRoot }: LegendOptions): Legend {
  const uid = `lg-${Math.random().toString(36).slice(2, 7)}`;
  const cardId = `${uid}-card`;

  const root = el('div', 'lg-root');
  root.dataset['visible'] = 'false';
  root.dataset['open'] = 'false';

  const pill = el('button', 'lg-pill glass');
  pill.type = 'button';
  pill.setAttribute('aria-controls', cardId);
  pill.setAttribute('aria-expanded', 'false');
  const pillLabel = el('span', 'lg-pill-label');
  pill.append(el('span', 'lg-pill-emoji', '🎨'), pillLabel, svg('lg-pill-chev', [CHEVRON_DOWN], 3));

  const card = el('section', 'lg-card glass');
  card.id = cardId;
  card.setAttribute('aria-label', 'Crops in view');
  const handle = el('div', 'lg-handle');
  handle.setAttribute('aria-hidden', 'true');
  const head = el('header', 'lg-head');
  const title = el('h2', 'lg-title', "What's in view");
  const sub = el('span', 'lg-sub');
  const clearBtn = el('button', 'lg-clear', 'Show all');
  clearBtn.type = 'button';
  clearBtn.hidden = true;
  clearBtn.setAttribute('aria-label', 'Show all crops');
  const closeBtn = el('button', 'lg-close');
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Close legend');
  closeBtn.append(svg('lg-close-icon', CLOSE, 3));
  head.append(title, sub, clearBtn, closeBtn);

  const list = el('ul', 'lg-list');
  const more = el('button', 'lg-more');
  more.type = 'button';
  more.hidden = true;
  const status = el('div', 'lg-sr');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  card.append(handle, head, list, more);
  root.append(pill, card, status);
  slot.append(root);

  const rows = new Map<number, RowParts>();
  let ranked: Entry[] = [];
  let expanded = false;
  let visible = false;
  let open = false;
  let lastSelected: ReadonlySet<number> = emphasis.state.selected;
  let refreshTimer: number | undefined;
  let hoverTimer: number | undefined;

  const setVisible = (next: boolean): void => {
    if (next === visible) return;
    visible = next;
    root.dataset['visible'] = String(next);
    if (!next) setOpen(false);
  };

  function setOpen(next: boolean): void {
    if (next === open) return;
    open = next;
    root.dataset['open'] = String(next);
    pill.setAttribute('aria-expanded', String(next));
  }

  const buildRow = (crop: Crop): RowParts => {
    const item = el('li', 'lg-item');
    const button = el('button', 'lg-row');
    button.type = 'button';
    button.dataset['crop'] = String(crop.cropId);
    button.style.setProperty('--crop', crop.color);
    const swatch = el('span', 'lg-swatch');
    swatch.append(svg('lg-check', [CHECK], 4));
    const name = el('span', 'lg-name', crop.name);
    name.title = crop.name;
    const pct = el('span', 'lg-pct');
    const bar = el('span', 'lg-bar');
    bar.append(el('i'));
    button.append(swatch, cropImg(manifest, crop, 'lg-icon'), name, pct, bar);
    item.append(button);
    return { item, button, pct, bar };
  };

  const applyRowState = (cropId: number, parts: RowParts, state: EmphasisState): void => {
    const on = state.selected.has(cropId);
    parts.button.setAttribute('aria-pressed', String(on));
    parts.item.classList.toggle('is-on', on);
    parts.item.classList.toggle('is-dim', state.selected.size > 0 && !on);
  };

  const displayed = (): Entry[] => {
    if (expanded) return ranked;
    const shown = ranked.slice(0, TOP_COUNT);
    const keep = new Set(shown.map((e) => e.crop.cropId));
    // A selected crop must stay reachable so it can be toggled off.
    for (const e of ranked) if (emphasis.state.selected.has(e.crop.cropId) && !keep.has(e.crop.cropId)) shown.push(e);
    return shown;
  };

  const withOffscreenSelected = (list: Entry[]): Entry[] => {
    const have = new Set(list.map((e) => e.crop.cropId));
    const out = [...list];
    for (const id of emphasis.state.selected) {
      const crop = crops.get(id);
      if (crop && !have.has(id)) out.push({ crop, acres: 0, share: 0 });
    }
    return out;
  };

  const render = (): void => {
    const state = emphasis.state;
    const entries = withOffscreenSelected(displayed());
    const before = new Map<number, number>();
    for (const [id, parts] of rows) before.set(id, parts.item.getBoundingClientRect().top);

    const focused = card.contains(document.activeElement) ? document.activeElement : null;
    const keep = new Set(entries.map((e) => e.crop.cropId));
    for (const [id, parts] of rows) {
      if (keep.has(id)) continue;
      parts.item.remove();
      rows.delete(id);
    }

    const lead = ranked[0]?.share ?? 1;
    entries.forEach((entry, index) => {
      const id = entry.crop.cropId;
      let parts = rows.get(id);
      const isNew = parts === undefined;
      if (!parts) {
        parts = buildRow(entry.crop);
        rows.set(id, parts);
      }
      parts.item.classList.toggle('is-away', entry.share === 0);
      parts.pct.textContent = entry.share === 0 ? 'off-screen' : formatShare(entry.share);
      parts.bar.style.setProperty('--fill', String(lead > 0 ? Math.max(0.03, entry.share / lead) : 0));
      parts.button.setAttribute(
        'aria-label',
        `${entry.crop.name}, ${entry.share === 0 ? 'not in view' : `${formatShare(entry.share)} of the view`}`,
      );
      applyRowState(id, parts, state);
      const at = list.children[index] ?? null;
      if (at !== parts.item) list.insertBefore(parts.item, at);
      if (isNew && visible) parts.item.classList.add('is-new');
    });
    if (focused instanceof HTMLElement && document.activeElement !== focused) focused.focus({ preventScroll: true });

    if (visible && !prefersReducedMotion() && (!SHEET_QUERY.matches || open)) {
      for (const [id, parts] of rows) {
        const from = before.get(id);
        if (from === undefined) continue;
        const delta = from - parts.item.getBoundingClientRect().top;
        if (Math.abs(delta) < 1) continue;
        parts.item.animate([{ transform: `translateY(${delta}px)` }, { transform: 'none' }], {
          duration: FLIP_MS,
          easing: SPRING,
        });
      }
    }

    const hidden = ranked.length - displayed().length;
    more.hidden = ranked.length <= TOP_COUNT;
    more.textContent = expanded ? 'Show less' : `+${hidden} more`;
    more.setAttribute('aria-expanded', String(expanded));
    card.dataset['expanded'] = String(expanded);

    sub.textContent = plural(ranked.length, 'crop');
    pillLabel.textContent =
      state.selected.size > 0
        ? `Legend · ${state.selected.size} selected`
        : `Legend · ${plural(ranked.length, 'crop')}`;
    clearBtn.hidden = state.selected.size === 0;
    sub.hidden = state.selected.size > 0;
    status.textContent = `${plural(ranked.length, 'crop')} in view`;
  };

  const measure = (): Entry[] => {
    if (!map.getLayer(FIELD_FILL_LAYER_ID)) return [];
    const acres = new Map<number, number>();
    const seen = new Set<number>();
    for (const feature of map.queryRenderedFeatures({ layers: [FIELD_FILL_LAYER_ID] })) {
      const id = typeof feature.id === 'number' ? feature.id : undefined;
      if (id !== undefined) {
        if (seen.has(id)) continue;
        seen.add(id);
      }
      const props = feature.properties as Record<string, unknown> | null;
      const cropId = Number(props?.['crop_id']);
      const size = Number(props?.['acres']);
      if (!Number.isFinite(cropId) || !Number.isFinite(size)) continue;
      acres.set(cropId, (acres.get(cropId) ?? 0) + size);
    }
    const out: Entry[] = [];
    let total = 0;
    for (const [cropId, a] of acres) {
      const crop = crops.get(cropId);
      if (!crop) continue;
      total += a;
      out.push({ crop, acres: a, share: 0 });
    }
    if (total <= 0) return [];
    for (const entry of out) entry.share = entry.acres / total;
    return out.sort((a, b) => b.acres - a.acres);
  };

  // The tally scans every rendered field, so it only reruns when the camera moved or the last scan ran before
  // all tiles had arrived.
  let measuredAt = '';
  let measuredComplete = false;
  const cameraKey = (): string => {
    const c = map.getCenter();
    return `${map.getZoom().toFixed(3)}/${c.lng.toFixed(6)}/${c.lat.toFixed(6)}/${map.getBearing().toFixed(1)}`;
  };

  const refresh = (): void => {
    refreshTimer = undefined;
    if (map.getZoom() < HIDE_ZOOM) return;
    const key = cameraKey();
    if (key === measuredAt && measuredComplete) return;
    measuredAt = key;
    measuredComplete = map.areTilesLoaded();
    const next = measure();
    if (!sameRanking(ranked, next)) {
      ranked = next;
      render();
    }
    setVisible(ranked.length > 0 && map.getZoom() >= (visible ? HIDE_ZOOM : SHOW_ZOOM));
  };

  const scheduleRefresh = (): void => {
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(refresh, REFRESH_DEBOUNCE_MS);
  };

  const onIdle = (): void => {
    if (!measuredComplete) scheduleRefresh();
  };

  const onResize = (): void => {
    measuredAt = '';
    scheduleRefresh();
  };

  const onZoom = (): void => {
    const z = map.getZoom();
    if (visible && z < HIDE_ZOOM) setVisible(false);
    else if (!visible && z >= SHOW_ZOOM && ranked.length > 0) setVisible(true);
  };

  const onRowClick = (e: MouseEvent): void => {
    const button = e.target instanceof Element ? e.target.closest<HTMLButtonElement>('.lg-row') : null;
    if (!button) return;
    window.clearTimeout(hoverTimer);
    emphasis.setPreview(null);
    emphasis.toggle(Number(button.dataset['crop']));
  };

  const previewFrom = (e: PointerEvent, on: boolean): void => {
    if (e.pointerType !== 'mouse') return;
    const button = e.target instanceof Element ? e.target.closest<HTMLButtonElement>('.lg-row') : null;
    if (!button) return;
    window.clearTimeout(hoverTimer);
    hoverTimer = window.setTimeout(
      () => emphasis.setPreview(on ? Number(button.dataset['crop']) : null),
      on ? HOVER_IN_MS : HOVER_OUT_MS,
    );
  };
  const onRowEnter = (e: PointerEvent): void => previewFrom(e, true);
  const onRowLeave = (e: PointerEvent): void => previewFrom(e, false);

  const onState = (state: EmphasisState): void => {
    if (state.selected !== lastSelected) {
      lastSelected = state.selected;
      render();
      return;
    }
    for (const [id, parts] of rows) applyRowState(id, parts, state);
  };
  const unsubscribe = emphasis.subscribe(onState);

  const onMore = (): void => {
    expanded = !expanded;
    render();
  };

  // On phones the legend rides above an open field sheet.
  const syncLift = (): void => {
    const sheet = popupRoot.querySelector<HTMLElement>('.field-popup[data-placement="sheet"]:not(.is-closing) .fp-card');
    root.style.setProperty('--lift', sheet ? `${sheet.offsetHeight + 8}px` : '0px');
  };
  const observer = new MutationObserver(syncLift);
  observer.observe(popupRoot, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'data-placement'] });

  const onMapClick = (): void => {
    if (SHEET_QUERY.matches) setOpen(false);
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && open) {
      setOpen(false);
      pill.focus({ preventScroll: true });
    }
  };

  list.addEventListener('click', onRowClick);
  list.addEventListener('pointerover', onRowEnter);
  list.addEventListener('pointerout', onRowLeave);
  more.addEventListener('click', onMore);
  clearBtn.addEventListener('click', () => emphasis.clear());
  pill.addEventListener('click', () => setOpen(!open));
  closeBtn.addEventListener('click', () => {
    setOpen(false);
    pill.focus({ preventScroll: true });
  });
  root.addEventListener('keydown', onKeyDown);
  map.on('zoom', onZoom);
  map.on('moveend', scheduleRefresh);
  map.on('idle', onIdle);
  map.on('resize', onResize);
  map.on('click', onMapClick);

  render();
  scheduleRefresh();

  return {
    destroy() {
      window.clearTimeout(refreshTimer);
      window.clearTimeout(hoverTimer);
      unsubscribe();
      observer.disconnect();
      map.off('zoom', onZoom);
      map.off('moveend', scheduleRefresh);
      map.off('idle', onIdle);
      map.off('resize', onResize);
      map.off('click', onMapClick);
      root.remove();
    },
  };
}
