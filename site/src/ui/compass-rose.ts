import type { Map as MapLibreMap } from 'maplibre-gl';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** The rose belongs to the illustrated overview; it dissolves as the map zooms into fields. */
const FADE_START_ZOOM = 6.2;
const FADE_END_ZOOM = 7.4;

const el = (tag: string, attrs: Record<string, string>, parent?: Element): SVGElement => {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  parent?.appendChild(node);
  return node;
};

const ROSE_POINTS = {
  // Each arm is split in two facets (lit / shaded) like an engraved compass.
  north: ['50,6 56,50 50,50', '50,6 44,50 50,50'],
  east: ['94,50 50,56 50,50', '94,50 50,44 50,50'],
  south: ['50,94 44,50 50,50', '50,94 56,50 50,50'],
  west: ['6,50 50,44 50,50', '6,50 50,56 50,50'],
  diagonal: ['50,50 69,31 50,44', '50,50 69,31 56,50'],
} as const;

function buildRose(): SVGElement {
  const svg = el('svg', { viewBox: '0 0 100 112', width: '100%', height: '100%', 'aria-hidden': 'true' });
  const g = el('g', { transform: 'translate(0 12)' }, svg);
  el('circle', { cx: '50', cy: '50', r: '40', fill: 'none', stroke: '#ffffff', 'stroke-opacity': '0.55', 'stroke-width': '0.9' }, g);
  el('circle', { cx: '50', cy: '50', r: '35', fill: 'none', stroke: '#ffffff', 'stroke-opacity': '0.3', 'stroke-width': '0.6', 'stroke-dasharray': '0.8 3.2' }, g);

  for (const angle of [45, 135, 225, 315]) {
    const arm = el('g', { transform: `rotate(${angle - 45} 50 50)` }, g);
    el('polygon', { points: ROSE_POINTS.diagonal[0], fill: '#ffffff', 'fill-opacity': '0.55' }, arm);
    el('polygon', { points: ROSE_POINTS.diagonal[1], fill: '#ffffff', 'fill-opacity': '0.3' }, arm);
  }

  const cardinals = ['north', 'east', 'south', 'west'] as const;
  for (const dir of cardinals) {
    const [lit, shade] = ROSE_POINTS[dir];
    const tint = dir === 'north' ? '#ffb3cf' : '#ffffff';
    el('polygon', { points: lit, fill: tint, 'fill-opacity': '0.95' }, g);
    el('polygon', { points: shade, fill: tint, 'fill-opacity': '0.55' }, g);
  }
  el('circle', { cx: '50', cy: '50', r: '3', fill: '#ffffff', stroke: '#8f88b8', 'stroke-width': '0.8' }, g);

  const label = el('text', {
    x: '50',
    y: '9',
    'text-anchor': 'middle',
    'font-family': 'Figtree, system-ui, sans-serif',
    'font-weight': '800',
    'font-size': '12',
    fill: '#ffffff',
    'letter-spacing': '0.1em',
  }, svg);
  label.textContent = 'N';
  return svg;
}

/** A small engraved compass rose floating on the Pacific; turns with the map bearing. */
export function mountCompassRose(host: HTMLElement, map: MapLibreMap): void {
  const root = document.createElement('div');
  root.className = 'compass-rose';
  root.setAttribute('aria-hidden', 'true');
  const dial = document.createElement('div');
  dial.className = 'compass-rose__dial';
  dial.appendChild(buildRose());
  root.appendChild(dial);
  host.appendChild(root);

  const sync = (): void => {
    const z = map.getZoom();
    const t = Math.min(1, Math.max(0, (z - FADE_START_ZOOM) / (FADE_END_ZOOM - FADE_START_ZOOM)));
    root.style.opacity = String(1 - t);
    dial.style.transform = `rotate(${-map.getBearing()}deg)`;
  };
  map.on('zoom', sync);
  map.on('rotate', sync);
  sync();
}
