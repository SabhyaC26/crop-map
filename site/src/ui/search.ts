import type { Map as MapLibreMap } from 'maplibre-gl';
import '../styles/search.css';
import type { Crop, CropIndex } from '../data/crops';
import { iconUrl } from '../lib/icons';
import type { EmphasisController, IconManifest, RegionsSearch, SearchTarget } from './emphasis';

interface SearchOptions {
  map: MapLibreMap;
  crops: CropIndex;
  regionsSearch: RegionsSearch;
  manifest: IconManifest;
  emphasis: EmphasisController;
  slot: HTMLElement;
}

interface Entry {
  crop: Crop;
  target: SearchTarget;
  name: string;
  words: string[];
  aliases: string[];
}

interface Match {
  entry: Entry;
  score: number;
  /** Alias the query hit, when the crop name itself did not match well. */
  alias: string | null;
}

/** Keyword found in a crop name -> everyday words people type for it. */
const ALIASES: readonly (readonly [string, readonly string[]])[] = [
  ['cole', ['broccoli', 'cauliflower', 'cabbage', 'brussels sprouts', 'kale', 'bok choy', 'collard']],
  ['lettuce', ['lettuce', 'spinach', 'greens', 'salad', 'romaine', 'arugula', 'chard', 'kale']],
  ['peach', ['peach', 'nectarine', 'stone fruit']],
  ['apricot', ['apricot', 'stone fruit']],
  ['plum', ['plum', 'prune', 'stone fruit']],
  ['prune', ['prune', 'dried plum', 'plum']],
  ['cherr', ['cherry', 'stone fruit']],
  ['grape', ['grape', 'wine', 'raisin', 'vineyard', 'napa']],
  ['citrus', ['orange', 'lemon', 'lime', 'citrus', 'grapefruit', 'mandarin', 'tangerine', 'clementine']],
  ['subtropical', ['lemon', 'citrus', 'subtropical']],
  ['almond', ['almond', 'nut', 'tree nut']],
  ['pistachio', ['pistachio', 'nut', 'tree nut']],
  ['walnut', ['walnut', 'nut', 'tree nut']],
  ['pecan', ['pecan', 'nut', 'tree nut']],
  ['tomato', ['tomato', 'ketchup', 'sauce']],
  ['corn', ['corn', 'maize', 'sorghum', 'silage']],
  ['alfalfa', ['alfalfa', 'hay', 'forage', 'feed']],
  ['grain', ['hay', 'grain', 'oats', 'barley', 'forage']],
  ['wheat', ['wheat', 'grain', 'flour']],
  ['rice', ['rice', 'paddy', 'sushi']],
  ['pasture', ['pasture', 'grazing', 'cattle', 'cow', 'rangeland', 'grass']],
  ['onion', ['onion', 'garlic', 'shallot']],
  ['melon', ['melon', 'cantaloupe', 'honeydew', 'watermelon', 'squash', 'pumpkin', 'zucchini']],
  ['strawberr', ['strawberry', 'berry']],
  ['blueberr', ['blueberry', 'raspberry', 'blackberry', 'berry']],
  ['olive', ['olive', 'olive oil']],
  ['avocado', ['avocado', 'guacamole', 'guac']],
  ['date', ['date', 'palm']],
  ['pomegranate', ['pomegranate']],
  ['kiwi', ['kiwi', 'kiwifruit']],
  ['pepper', ['pepper', 'chili', 'jalapeno', 'bell pepper']],
  ['sweet potato', ['sweet potato', 'yam']],
  ['potato', ['potato', 'spud', 'fries']],
  ['carrot', ['carrot']],
  ['apple', ['apple', 'cider']],
  ['pear', ['pear']],
  ['cotton', ['cotton', 'fiber']],
  ['sunflower', ['sunflower', 'seeds']],
  ['safflower', ['safflower', 'oil']],
  ['beet', ['beet', 'sugar']],
  ['bean', ['bean', 'beans']],
  ['flower', ['flower', 'nursery', 'plants', 'rose']],
  ['turf', ['turf', 'lawn', 'sod', 'grass']],
  ['greenhouse', ['greenhouse', 'hothouse']],
  ['eucalyptus', ['eucalyptus', 'tree']],
];

const MAX_RESULTS = 7;
const POPULAR_COUNT = 5;

const norm = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const tokens = (s: string): string[] => norm(s).split(/[^a-z0-9]+/).filter(Boolean);

const singular = (s: string): string => (s.length > 3 && s.endsWith('s') ? s.slice(0, -1) : s);

function isSubsequence(q: string, text: string): boolean {
  let i = 0;
  for (const ch of text) if (ch === q[i] && ++i === q.length) return true;
  return q.length === 0;
}

/** True when `q` is within one edit of the same-length prefix of `word`. */
function nearPrefix(q: string, word: string): boolean {
  if (q.length < 4 || word.length < q.length - 1 || q[0] !== word[0]) return false;
  for (const len of [q.length - 1, q.length, q.length + 1]) {
    const head = word.slice(0, len);
    if (head.length !== len) continue;
    if (editDistanceAtMostOne(q, head)) return true;
  }
  return false;
}

function editDistanceAtMostOne(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (a.length < b.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

export function formatAcres(acres: number): string {
  if (acres >= 1e6) return `${trim(acres / 1e6)}M`;
  if (acres >= 1e4) return `${Math.round(acres / 1e3)}k`;
  if (acres >= 1e3) return `${trim(acres / 1e3)}k`;
  return String(Math.round(acres));
}

const trim = (n: number): string => n.toFixed(1).replace(/\.0$/, '');

function buildEntries(crops: CropIndex, regionsSearch: RegionsSearch): Entry[] {
  const out: Entry[] = [];
  for (const crop of crops.list) {
    const target = regionsSearch[String(crop.cropId)];
    if (!target) continue;
    const name = norm(crop.name);
    const aliases = new Set<string>();
    for (const [keyword, words] of ALIASES) {
      if (name.includes(keyword)) for (const w of words) aliases.add(w);
    }
    out.push({ crop, target, name, words: tokens(crop.name), aliases: [...aliases] });
  }
  return out;
}

function scoreEntry(entry: Entry, qRaw: string): { score: number; alias: string | null } | null {
  const variants = [...new Set([qRaw, singular(qRaw)])];
  let best = 0;
  let alias: string | null = null;
  const bump = (score: number, viaAlias: string | null): void => {
    if (score > best) {
      best = score;
      alias = viaAlias;
    }
  };
  for (const q of variants) {
    if (entry.name === q) bump(120, null);
    else if (entry.name.startsWith(q)) bump(100, null);
    else if (entry.words.some((w) => w.startsWith(q))) bump(85, null);
    else if (entry.name.includes(q)) bump(55, null);
    for (const a of entry.aliases) {
      if (a === q) bump(95, a);
      else if (a.startsWith(q) || a.split(' ').some((w) => w.startsWith(q))) bump(72, a);
      else if (a.includes(q)) bump(45, a);
    }
    if (best === 0 && q.length >= 4) {
      if (entry.words.some((w) => nearPrefix(q, w))) bump(38, null);
      else if (entry.aliases.some((a) => nearPrefix(q, a))) bump(34, null);
    }
    if (best === 0 && q.length >= 3 && isSubsequence(q, entry.name)) bump(22, null);
  }
  return best > 0 ? { score: best, alias } : null;
}

function search(entries: readonly Entry[], raw: string): Match[] {
  const q = norm(raw).trim();
  if (q === '') {
    return [...entries]
      .sort((a, b) => b.target.acres_total - a.target.acres_total)
      .slice(0, POPULAR_COUNT)
      .map((entry) => ({ entry, score: 0, alias: null }));
  }
  const matches: Match[] = [];
  for (const entry of entries) {
    const hit = scoreEntry(entry, q);
    if (hit) matches.push({ entry, score: hit.score + Math.log10(entry.target.acres_total + 10) / 10, alias: hit.alias });
  }
  return matches.sort((a, b) => b.score - a.score).slice(0, MAX_RESULTS);
}

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

const SVG_NS = 'http://www.w3.org/2000/svg';

function svg(className: string, paths: readonly string[], strokeWidth = 2.4): SVGSVGElement {
  const node = document.createElementNS(SVG_NS, 'svg');
  node.setAttribute('viewBox', '0 0 24 24');
  node.setAttribute('class', className);
  node.setAttribute('aria-hidden', 'true');
  node.setAttribute('fill', 'none');
  node.setAttribute('stroke', 'currentColor');
  node.setAttribute('stroke-width', String(strokeWidth));
  node.setAttribute('stroke-linecap', 'round');
  node.setAttribute('stroke-linejoin', 'round');
  for (const d of paths) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    node.append(p);
  }
  return node;
}

function cropImg(manifest: IconManifest, crop: Crop, className: string): HTMLImageElement {
  const img = el('img', className);
  img.src = iconUrl(manifest, crop.icon);
  img.alt = '';
  img.decoding = 'async';
  img.draggable = false;
  return img;
}

function highlight(node: HTMLElement, text: string, q: string): void {
  node.textContent = '';
  const needle = singular(norm(q).trim());
  const at = needle ? norm(text).indexOf(needle) : -1;
  if (at < 0) {
    node.textContent = text;
    return;
  }
  node.append(text.slice(0, at));
  node.append(el('mark', 'cs-mark', text.slice(at, at + needle.length)));
  node.append(text.slice(at + needle.length));
}

type Mode = 'idle' | 'open' | 'chip';

export interface SearchControl {
  destroy(): void;
}

export function createSearch({ map, crops, regionsSearch, manifest, emphasis, slot }: SearchOptions): SearchControl {
  const entries = buildEntries(crops, regionsSearch);
  const uid = `cs-${Math.random().toString(36).slice(2, 7)}`;
  const listId = `${uid}-list`;

  const root = el('div', 'cs-root');
  const box = el('div', 'cs-search glass');
  const bar = el('div', 'cs-bar');
  const input = el('input', 'cs-input');
  input.type = 'text';
  input.placeholder = 'Search a crop… (try avocado)';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.enterKeyHint = 'search';
  input.setAttribute('autocapitalize', 'off');
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-label', 'Search crops');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-haspopup', 'listbox');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', listId);

  const lens = svg('cs-lens', ['M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z', 'm21 21-5.2-5.2'], 2.6);
  const resetBtn = el('button', 'cs-reset');
  resetBtn.type = 'button';
  resetBtn.setAttribute('aria-label', 'Clear search text');
  resetBtn.append(svg('cs-x-icon', ['M6 6l12 12', 'M18 6 6 18'], 2.8));
  bar.append(lens, input, resetBtn);

  const chip = el('div', 'cs-chip');
  chip.setAttribute('role', 'group');
  const chipMain = el('button', 'cs-chip-main');
  chipMain.type = 'button';
  const chipIcon = el('span', 'cs-chip-icon');
  const chipName = el('span', 'cs-chip-name');
  chipMain.append(chipIcon, chipName);
  const chipClear = el('button', 'cs-chip-clear');
  chipClear.type = 'button';
  chipClear.append(svg('cs-x-icon', ['M6 6l12 12', 'M18 6 6 18'], 3));
  chip.append(chipMain, chipClear);

  const list = el('ul', 'cs-list');
  list.id = listId;
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Crops');

  const status = el('div', 'cs-sr');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  box.append(bar, chip);
  root.append(box, list, status);
  slot.append(root);

  let mode: Mode = 'idle';
  let selected: Entry | null = null;
  let results: Match[] = [];
  let active = 0;

  const setMode = (next: Mode): void => {
    mode = next;
    root.dataset['mode'] = next;
    const open = next === 'open';
    bar.hidden = next === 'chip';
    chip.hidden = next !== 'chip';
    list.dataset['open'] = String(open);
    input.setAttribute('aria-expanded', String(open && results.length > 0));
  };

  const optionId = (i: number): string => `${uid}-opt-${i}`;

  const setActive = (i: number, scroll = true): void => {
    active = results.length === 0 ? 0 : (i + results.length) % results.length;
    list.querySelectorAll<HTMLElement>('.cs-option').forEach((node, idx) => {
      const on = idx === active;
      node.classList.toggle('is-active', on);
      node.setAttribute('aria-selected', String(on));
      if (on && scroll) node.scrollIntoView({ block: 'nearest' });
    });
    if (mode === 'open' && results.length > 0) input.setAttribute('aria-activedescendant', optionId(active));
    else input.removeAttribute('aria-activedescendant');
  };

  const renderList = (): void => {
    const q = input.value;
    results = search(entries, q);
    list.textContent = '';
    const frag = document.createDocumentFragment();
    if (q.trim() === '' && results.length > 0) {
      const head = el('li', 'cs-heading', 'Top crops in California');
      head.setAttribute('role', 'presentation');
      frag.append(head);
    }
    results.forEach((m, i) => {
      const { crop, target } = m.entry;
      const row = el('li', 'cs-option');
      row.id = optionId(i);
      row.setAttribute('role', 'option');
      row.style.setProperty('--i', String(i));
      row.style.setProperty('--crop', crop.color);
      row.dataset['index'] = String(i);
      const halo = el('span', 'cs-halo');
      halo.append(cropImg(manifest, crop, 'cs-icon'));
      const text = el('span', 'cs-text');
      const name = el('span', 'cs-name');
      highlight(name, crop.name, q);
      text.append(name, el('span', 'cs-sub', `${formatAcres(target.acres_total)} acres statewide`));
      row.append(halo, text);
      const tagText = m.alias && !norm(crop.name).includes(m.alias) ? `“${m.alias}”` : target.label;
      if (tagText) row.append(el('span', m.alias ? 'cs-tag is-alias' : 'cs-tag', tagText));
      frag.append(row);
    });
    if (results.length === 0) {
      const none = el('li', 'cs-empty');
      none.setAttribute('role', 'presentation');
      none.append(el('span', 'cs-empty-emoji', '🌾'), el('span', undefined, `No crop matches “${q.trim()}”`));
      frag.append(none);
    }
    list.append(frag);
    status.textContent = results.length === 0 ? 'No matching crops' : `${results.length} crops. Use up and down arrows.`;
    input.setAttribute('aria-expanded', String(mode === 'open' && results.length > 0));
    setActive(0, false);
    resetBtn.dataset['show'] = String(q !== '');
  };

  const renderChip = (): void => {
    if (!selected) return;
    const { crop } = selected;
    chip.style.setProperty('--crop', crop.color);
    chip.setAttribute('aria-label', `Showing ${crop.name}`);
    chipIcon.textContent = '';
    chipIcon.append(cropImg(manifest, crop, 'cs-icon'));
    chipName.textContent = crop.name;
    chipMain.setAttribute('aria-label', `${crop.name}. Search for a different crop`);
    chipClear.setAttribute('aria-label', `Clear ${crop.name} filter`);
  };

  const openSearch = (): void => {
    if (mode === 'open') return;
    setMode('open');
    renderList();
  };

  const closeSearch = (): void => {
    input.value = '';
    results = [];
    resetBtn.dataset['show'] = 'false';
    input.removeAttribute('aria-activedescendant');
    setMode(selected ? 'chip' : 'idle');
  };

  const choose = (entry: Entry): void => {
    selected = entry;
    renderChip();
    emphasis.setSearch(entry.crop.cropId);
    map.flyTo({ center: entry.target.center, zoom: entry.target.zoom, curve: 1.6, speed: 1.1 });
    input.blur();
    closeSearch();
    chipMain.focus({ preventScroll: true });
    status.textContent = `Showing ${entry.crop.name}`;
  };

  const clear = (): void => {
    selected = null;
    emphasis.setSearch(null);
    closeSearch();
    status.textContent = 'Crop filter cleared';
  };

  const onFocus = (): void => openSearch();
  const onBlur = (): void => {
    if (mode === 'open') closeSearch();
  };
  const onInput = (): void => {
    if (mode !== 'open') openSearch();
    else renderList();
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (mode !== 'open') openSearch();
        else setActive(active + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (mode !== 'open') openSearch();
        else setActive(active - 1);
        break;
      case 'Enter': {
        const pick = results[active];
        if (pick) {
          e.preventDefault();
          choose(pick.entry);
        }
        break;
      }
      case 'Escape':
        if (input.value !== '') {
          input.value = '';
          renderList();
        } else {
          input.blur();
        }
        e.stopPropagation();
        break;
      default:
        break;
    }
  };

  const optionAt = (target: EventTarget | null): Match | undefined => {
    const row = target instanceof Element ? target.closest<HTMLElement>('.cs-option') : null;
    return row ? results[Number(row.dataset['index'])] : undefined;
  };

  const onListPointerDown = (e: PointerEvent): void => e.preventDefault();
  const onListClick = (e: MouseEvent): void => {
    const hit = optionAt(e.target);
    if (hit) choose(hit.entry);
  };
  const onListMove = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') return;
    const row = e.target instanceof Element ? e.target.closest<HTMLElement>('.cs-option') : null;
    if (row && Number(row.dataset['index']) !== active) setActive(Number(row.dataset['index']), false);
  };

  const onResetPointerDown = (e: PointerEvent): void => e.preventDefault();
  const onResetClick = (): void => {
    input.value = '';
    renderList();
    input.focus();
  };

  const onChipMain = (): void => {
    setMode('open');
    renderList();
    input.focus();
  };

  const onDocKey = (e: KeyboardEvent): void => {
    if (e.key === '/' && mode !== 'open' && !(e.target instanceof HTMLInputElement) && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      if (mode === 'chip') onChipMain();
      else input.focus();
    }
  };

  input.addEventListener('focus', onFocus);
  input.addEventListener('blur', onBlur);
  input.addEventListener('input', onInput);
  input.addEventListener('keydown', onKeyDown);
  list.addEventListener('pointerdown', onListPointerDown);
  list.addEventListener('click', onListClick);
  list.addEventListener('pointermove', onListMove);
  resetBtn.addEventListener('pointerdown', onResetPointerDown);
  resetBtn.addEventListener('click', onResetClick);
  chipMain.addEventListener('click', onChipMain);
  chipClear.addEventListener('click', clear);
  document.addEventListener('keydown', onDocKey);

  setMode('idle');

  return {
    destroy() {
      document.removeEventListener('keydown', onDocKey);
      root.remove();
    },
  };
}
