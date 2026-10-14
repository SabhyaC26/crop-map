import type { Crop } from '../data/crops';
import { GROUND_GAP, LABEL_HEIGHT } from './zoom';
import type { Region } from './regions';

export interface MarkerParts {
  root: HTMLButtonElement;
  /** Web Animations target: split / merge / intro (translate, scale, opacity). */
  fx: HTMLElement;
  /** Zoom-driven opacity + scale, written every frame while zooming. */
  band: HTMLElement;
  /** Label wrapper: counter-scaled against the band so text keeps a constant size. */
  label: HTMLElement;
  /** The label pill, measured for collision boxes. */
  name: HTMLElement;
  /** Assigns the `<img>` src on first display when built with `deferIcon = true`. */
  loadIcon?: () => void;
}

const hash01 = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
};

export function formatAcres(acres: number): string {
  if (acres >= 10000) return `${Math.round(acres / 1000)}k acres`;
  if (acres >= 999.5) return `${(acres / 1000).toFixed(1).replace(/\.0$/, '')}k acres`;
  return `${Math.round(acres)} acres`;
}

const span = (className: string, text?: string): HTMLSpanElement => {
  const el = document.createElement('span');
  el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
};

/** Placeholder until the real pill width can be measured (fonts loaded). */
export const estimateLabelWidth = (label: string, level: Region['level']): number =>
  label.length * (level === 'coarse' ? 7.6 : 6.9) + 26;

export function buildMarkerElement(
  region: Region,
  crop: Crop,
  iconSrc: string,
  size: number,
  deferIcon = false,
): MarkerParts {
  const root = document.createElement('button');
  root.type = 'button';
  root.className = 'crop-marker';
  root.dataset.level = region.level;
  root.dataset.state = 'hidden';
  root.dataset.id = region.id;
  root.setAttribute('aria-label', `${crop.name} in ${region.label}, ${formatAcres(region.acres)}`);

  const duration = 3.5 + hash01(`${region.id}:d`) * 1.0;
  const delay = -hash01(`${region.id}:p`) * duration;
  root.style.setProperty('--size', `${size}px`);
  root.style.setProperty('--crop-color', crop.color);
  root.style.setProperty('--bob-dur', `${duration.toFixed(2)}s`);
  root.style.setProperty('--bob-delay', `${delay.toFixed(2)}s`);
  root.style.setProperty('--bob-tilt', `${(hash01(`${region.id}:t`) < 0.5 ? -1 : 1) * (1 + hash01(`${region.id}:r`))}deg`);
  root.style.width = `${size}px`;
  root.style.height = `${size + LABEL_HEIGHT + GROUND_GAP}px`;

  const img = document.createElement('img');
  img.className = 'crop-marker__img';
  img.alt = '';
  img.draggable = false;
  img.decoding = 'async';
  let iconLoaded = !deferIcon;
  if (!deferIcon) img.src = iconSrc;
  const loadIcon = (): void => {
    if (iconLoaded) return;
    iconLoaded = true;
    img.src = iconSrc;
  };

  const icon = span('crop-marker__icon');
  icon.append(img);

  const label = span('crop-marker__label');
  const name = span('crop-marker__name', region.label);
  label.append(
    name,
    span('crop-marker__sub', `${formatAcres(region.acres)} · ${crop.name}`),
  );

  const float = span('crop-marker__float');
  float.append(icon, label);

  const gate = span('crop-marker__gate');
  gate.append(float, span('crop-marker__shadow'));

  const band = span('crop-marker__band');
  band.append(gate);

  const fx = span('crop-marker__fx');
  fx.append(band);

  root.append(fx);
  return { root, fx, band, label, name, loadIcon };
}
