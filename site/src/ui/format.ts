import { iconUrl } from '../lib/icons';

const trim = (n: number): string => n.toFixed(1).replace(/\.0$/, '');

export function formatAcres(acres: number): string {
  if (acres >= 1e6) return `${trim(acres / 1e6)}M`;
  if (acres >= 1e4) return `${Math.round(acres / 1e3)}k`;
  if (acres >= 1e3) return `${trim(acres / 1e3)}k`;
  return String(Math.round(acres));
}

export function el<K extends keyof HTMLElementTagNameMap>(
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

export function svg(className: string, paths: readonly string[], strokeWidth = 2.4): SVGSVGElement {
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

export function cropImg(manifest: Record<string, string>, crop: { icon: string }, className: string): HTMLImageElement {
  const img = el('img', className);
  img.src = iconUrl(manifest, crop.icon);
  img.alt = '';
  img.decoding = 'async';
  img.draggable = false;
  return img;
}
