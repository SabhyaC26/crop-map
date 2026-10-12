import type { Map as MapLibreMap } from 'maplibre-gl';
import { ICONS_BASE } from '../config';
import type { Crop } from '../data/crops';

type IconManifest = Record<string, string>;

const CANVAS_PX = 128;
const DISC_RADIUS = 50;
const DISC_CENTER_X = CANVAS_PX / 2;
const DISC_CENTER_Y = 59;
const GLYPH_PX = 72;
const GLYPH_OFFSET_X = DISC_CENTER_X - GLYPH_PX / 2;
const GLYPH_OFFSET_Y = DISC_CENTER_Y - GLYPH_PX / 2 - 1;
/** 128px canvas shown at 32 css px for icon-size 1; the 100px badge disc reads as ~25px. */
const PIXEL_RATIO = 4;

let manifestPromise: Promise<IconManifest> | undefined;

export const iconImageId = (slug: string): string => `icon-${slug}`;

export function loadIconManifest(): Promise<IconManifest> {
  manifestPromise ??= fetch(`${ICONS_BASE}manifest.json`).then((res) => {
    if (!res.ok) throw new Error(`icons manifest: HTTP ${res.status}`);
    return res.json() as Promise<IconManifest>;
  });
  return manifestPromise;
}

export function iconUrl(manifest: IconManifest, slug: string): string {
  const file = manifest[slug] ?? `${slug}.png`;
  return `${ICONS_BASE}${file}`;
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.decoding = 'async';
  img.width = CANVAS_PX;
  img.height = CANVAS_PX;
  img.src = src;
  await img.decode();
  return img;
}

function rasterize(img: HTMLImageElement): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_PX;
  canvas.height = CANVAS_PX;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2d canvas unavailable');
  ctx.imageSmoothingQuality = 'high';

  ctx.save();
  ctx.shadowColor = 'rgba(58, 52, 110, 0.30)';
  ctx.shadowBlur = 9;
  ctx.shadowOffsetY = 5;
  const disc = ctx.createRadialGradient(DISC_CENTER_X - 14, DISC_CENTER_Y - 18, 4, DISC_CENTER_X, DISC_CENTER_Y, DISC_RADIUS);
  disc.addColorStop(0, '#ffffff');
  disc.addColorStop(0.7, '#fffefb');
  disc.addColorStop(1, '#f1eefb');
  ctx.fillStyle = disc;
  ctx.beginPath();
  ctx.arc(DISC_CENTER_X, DISC_CENTER_Y, DISC_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.shadowColor = 'rgba(58, 52, 110, 0.18)';
  ctx.shadowBlur = 3;
  ctx.shadowOffsetY = 2;
  ctx.drawImage(img, GLYPH_OFFSET_X, GLYPH_OFFSET_Y, GLYPH_PX, GLYPH_PX);
  return ctx.getImageData(0, 0, CANVAS_PX, CANVAS_PX);
}

/** Registers `icon-<slug>` map images (shadow baked in) for every icon the crops use. */
export async function registerCropIcons(map: MapLibreMap, crops: readonly Crop[]): Promise<void> {
  const manifest = await loadIconManifest();
  const slugs = [...new Set(crops.map((c) => c.icon))];
  await Promise.all(
    slugs.map(async (slug) => {
      const id = iconImageId(slug);
      if (map.hasImage(id)) return;
      const img = await loadImage(iconUrl(manifest, slug));
      map.addImage(id, rasterize(img), { pixelRatio: PIXEL_RATIO });
    }),
  );
}
