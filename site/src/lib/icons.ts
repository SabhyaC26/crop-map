import type { Map as MapLibreMap } from 'maplibre-gl';
import { ICONS_BASE } from '../config';
import type { Crop } from '../data/crops';

type IconManifest = Record<string, string>;

const CANVAS_PX = 128;
const GLYPH_PX = 96;
const GLYPH_OFFSET_X = (CANVAS_PX - GLYPH_PX) / 2;
const GLYPH_OFFSET_Y = 10;
/** 128px canvas shown at 32 css px for icon-size 1. */
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
  ctx.shadowColor = 'rgba(58, 52, 110, 0.32)';
  ctx.shadowBlur = 9;
  ctx.shadowOffsetY = 5;
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
