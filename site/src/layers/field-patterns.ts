import type { ExpressionSpecification, Map as MapLibreMap } from 'maplibre-gl';
import type { Crop, CropIndex } from '../data/crops';
import { mix } from '../lib/color';

/** Logical tile edge; rendered at 2x so the pattern stays crisp on retina screens and when it scales up within a zoom level. */
const TILE = 64;
const RENDER_SCALE = 2;
const PIXEL_RATIO = 4;

const CREAM = '#f7f3e1';
const INK = '#4a4e7a';
/** The flat fill sits at ~85% opacity over cream; the pattern base matches that so the texture never shifts the colour. */
const BASE_CREAM_MIX = 0.12;

/** Only crops whose texture clearly reads as farmland get one; everything else stays a plain candy fill. */
export type FieldTextureKind = 'tree' | 'young-tree' | 'vine' | 'rows' | 'berry' | 'rice';

const TREE_GROUPS = new Set(['Tree nuts', 'Citrus & subtropical', 'Stone fruit', 'Tree fruit']);
const ROW_GROUPS = new Set(['Vegetables', 'Leafy greens']);

const KIND_BY_NAME: Readonly<Record<string, FieldTextureKind>> = {
  'Young orchards': 'young-tree',
  Eucalyptus: 'tree',
};

export function textureKindOf(crop: Crop): FieldTextureKind | null {
  const byName = KIND_BY_NAME[crop.name];
  if (byName) return byName;
  if (TREE_GROUPS.has(crop.group)) return 'tree';
  if (crop.group === 'Vineyards') return 'vine';
  if (ROW_GROUPS.has(crop.group)) return 'rows';
  if (crop.group === 'Berries') return 'berry';
  if (crop.group === 'Rice') return 'rice';
  return null;
}

/** Row textures get a second, rotated variant so neighbouring fields do not all share one grain. */
const DIRECTIONAL = new Set<FieldTextureKind>(['vine', 'rows', 'berry']);

const patternId = (cropId: number, variant: 0 | 1): string => `fp-${cropId}-${variant}`;

type Ctx = CanvasRenderingContext2D;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rgba = (hex: string, alpha: number): string => {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
};

/** Runs `draw` at the 3x3 neighbouring offsets so anything crossing a tile edge wraps seamlessly. */
function wrapped(ctx: Ctx, draw: (ctx: Ctx) => void): void {
  for (const dx of [-TILE, 0, TILE]) {
    for (const dy of [-TILE, 0, TILE]) {
      ctx.save();
      ctx.translate(dx, dy);
      draw(ctx);
      ctx.restore();
    }
  }
}

function fillBase(ctx: Ctx, base: string): void {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, TILE, TILE);
}

/** Smooth alternating bands running vertically; `period` must divide the tile. */
function bands(ctx: Ctx, period: number, light: string, dark: string, sharpness = 1): void {
  for (let x = 0; x < TILE; x += 0.5) {
    const wave = (Math.cos((2 * Math.PI * (x + 0.25)) / period) + 1) / 2;
    const t = Math.min(1, Math.max(0, 0.5 + (wave - 0.5) * sharpness));
    ctx.fillStyle = mix(dark, light, t);
    ctx.fillRect(x, 0, 0.5, TILE);
  }
}

function canopy(ctx: Ctx, cx: number, cy: number, radius: number, c: string, lift: number): void {
  wrapped(ctx, (w) => {
    const shadow = w.createRadialGradient(cx + 1.2, cy + 1.7, radius * 0.3, cx + 1.2, cy + 1.7, radius * 1.15);
    shadow.addColorStop(0, rgba(INK, 0.16));
    shadow.addColorStop(1, rgba(INK, 0));
    w.fillStyle = shadow;
    w.beginPath();
    w.arc(cx + 1.2, cy + 1.7, radius * 1.15, 0, Math.PI * 2);
    w.fill();

    const body = w.createRadialGradient(cx - radius * 0.25, cy - radius * 0.3, radius * 0.15, cx, cy, radius);
    body.addColorStop(0, mix(c, '#ffffff', lift));
    body.addColorStop(0.7, mix(c, INK, 0.1));
    body.addColorStop(1, mix(c, INK, 0.2));
    w.fillStyle = body;
    w.beginPath();
    w.arc(cx, cy, radius, 0, Math.PI * 2);
    w.fill();
  });
}

/** Staggered rows of canopies: reads as an orchard block rather than a stud grid. */
function drawTree(ctx: Ctx, c: string, radius: number, lift: number): void {
  const cell = 16;
  const n = TILE / cell;
  for (let gx = 0; gx < n; gx++) {
    for (let gy = 0; gy < n; gy++) {
      canopy(ctx, gx * cell, gy * cell, radius, c, lift);
      canopy(ctx, gx * cell + cell / 2, gy * cell + cell / 2, radius, c, lift);
    }
  }
}

function drawVine(ctx: Ctx, c: string, rand: () => number): void {
  const period = 16;
  const wire = mix(c, INK, 0.34);
  const leaf = mix(c, '#ffffff', 0.3);
  const leafDark = mix(c, INK, 0.2);
  for (let row = 0; row < TILE / period; row++) {
    const x = row * period + period / 2;
    const shade = ctx.createLinearGradient(x - 3.2, 0, x + 3.2, 0);
    shade.addColorStop(0, rgba(INK, 0));
    shade.addColorStop(0.5, rgba(INK, 0.17));
    shade.addColorStop(1, rgba(INK, 0));
    ctx.fillStyle = shade;
    ctx.fillRect(x - 3.2, 0, 6.4, TILE);
    ctx.fillStyle = rgba(mix(c, INK, 0.3), 0.18);
    ctx.fillRect(x + 3.4, 0, 1.2, TILE);
    ctx.strokeStyle = rgba(wire, 0.55);
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, TILE);
    ctx.stroke();
    for (let y = 1.5; y < TILE; y += 3.2) {
      const side = rand() > 0.5 ? 1 : -1;
      const r = 1.1 + rand() * 0.7;
      ctx.fillStyle = rand() > 0.35 ? rgba(leaf, 0.85) : rgba(leafDark, 0.65);
      ctx.beginPath();
      ctx.arc(x + side * (0.9 + rand() * 1.4), y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawRows(ctx: Ctx, base: string, period: number, contrast: number): void {
  bands(ctx, period, mix(base, '#ffffff', 0.12 * contrast), mix(base, INK, 0.1 * contrast), 1.35);
}

function drawBerry(ctx: Ctx, c: string, base: string, rand: () => number): void {
  const period = 16;
  bands(ctx, period, mix(base, '#ffffff', 0.16), mix(base, INK, 0.12), 1.8);
  for (let row = 0; row < TILE / period; row++) {
    const x = row * period;
    for (let y = 2; y < TILE; y += 5) {
      ctx.fillStyle = rgba(mix(c, INK, 0.22), 0.55);
      ctx.beginPath();
      ctx.arc(x + (rand() - 0.5) * 1.4, y + (rand() - 0.5), 1.15, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawRice(ctx: Ctx, c: string): void {
  const glint = mix(c, '#e6fcff', 0.78);
  const trough = mix(c, INK, 0.18);
  for (let k = 0; k < 4; k++) {
    const y0 = 8 + k * 16;
    const phase = k * 1.3;
    const path = (dy: number): void => {
      ctx.beginPath();
      for (let x = -2; x <= TILE + 2; x += 1) {
        const y = y0 + dy + 1.9 * Math.sin((2 * Math.PI * x) / 32 + phase);
        if (x === -2) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
    };
    ctx.lineCap = 'round';
    ctx.strokeStyle = rgba(trough, 0.2);
    ctx.lineWidth = 2.2;
    path(1.6);
    ctx.stroke();
    ctx.strokeStyle = rgba(glint, 0.62);
    ctx.lineWidth = 1.5;
    path(0);
    ctx.stroke();
  }
}

function drawKind(ctx: Ctx, kind: FieldTextureKind, crop: Crop, base: string): void {
  const rand = mulberry32(crop.cropId * 7919 + 17);
  const c = crop.color;
  fillBase(ctx, base);
  switch (kind) {
    case 'tree':
      drawTree(ctx, c, crop.group === 'Citrus & subtropical' ? 5.4 : 4.8, 0.08);
      return;
    case 'young-tree':
      drawTree(ctx, c, 2.6, 0.1);
      return;
    case 'vine':
      drawVine(ctx, c, rand);
      return;
    case 'rows':
      drawRows(ctx, base, 8, crop.group === 'Leafy greens' ? 1.15 : 1);
      return;
    case 'berry':
      drawBerry(ctx, c, base, rand);
      return;
    case 'rice':
      drawRice(ctx, c);
      return;
    default: {
      const unreachable: never = kind;
      throw new Error(`unhandled texture kind ${String(unreachable)}`);
    }
  }
}

let sharedCanvas: { canvas: HTMLCanvasElement; ctx: Ctx } | null = null;

function getCanvas(): { canvas: HTMLCanvasElement; ctx: Ctx } {
  if (!sharedCanvas) {
    const canvas = document.createElement('canvas');
    canvas.width = TILE * RENDER_SCALE;
    canvas.height = TILE * RENDER_SCALE;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('2d canvas unavailable');
    sharedCanvas = { canvas, ctx };
  }
  sharedCanvas.ctx.setTransform(RENDER_SCALE, 0, 0, RENDER_SCALE, 0, 0);
  return sharedCanvas;
}

function renderTile(draw: (ctx: Ctx) => void, rotate: boolean): ImageData {
  const { canvas, ctx } = getCanvas();
  if (rotate) {
    ctx.translate(TILE / 2, TILE / 2);
    ctx.rotate(Math.PI / 2);
    ctx.translate(-TILE / 2, -TILE / 2);
  }
  draw(ctx);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function addPattern(map: MapLibreMap, id: string, draw: (ctx: Ctx) => void, rotate = false): void {
  if (map.hasImage(id)) return;
  map.addImage(id, renderTile(draw, rotate), { pixelRatio: PIXEL_RATIO });
}

/**
 * Registers one tinted, seamless tile per textured crop (plus a rotated twin for row-based textures).
 * Patterns are only used at z11.5+, so they are rasterised on demand when MapLibre first requests them.
 */
export function registerFieldPatterns(map: MapLibreMap, crops: CropIndex): void {
  const builders = new Map<string, () => void>();
  for (const crop of crops.list) {
    const kind = textureKindOf(crop);
    if (!kind) continue;
    const base = mix(crop.color, CREAM, BASE_CREAM_MIX);
    const draw = (ctx: Ctx): void => drawKind(ctx, kind, crop, base);
    const id0 = patternId(crop.cropId, 0);
    builders.set(id0, () => addPattern(map, id0, draw));
    if (DIRECTIONAL.has(kind)) {
      const id1 = patternId(crop.cropId, 1);
      builders.set(id1, () => addPattern(map, id1, draw, true));
    }
  }
  if (typeof map.on === 'function') {
    map.on('styleimagemissing', (e: { id: string }) => {
      builders.get(e.id)?.();
    });
  } else {
    for (const build of builders.values()) build();
  }
}

/** Crop ids that have a texture; the texture layer filters to these so plain crops cost nothing. */
export function texturedCropIds(crops: CropIndex): number[] {
  return crops.list.filter((c) => textureKindOf(c) !== null).map((c) => c.cropId);
}

/** `match` on crop_id picking the tinted tile; row textures alternate orientation with feature-id parity. */
export function patternImageExpression(crops: CropIndex): ExpressionSpecification {
  const parity: ExpressionSpecification = ['==', ['%', ['to-number', ['id'], 0], 2], 0];
  const pairs = crops.list.flatMap((crop) => {
    const kind = textureKindOf(crop);
    if (!kind) return [];
    const a = patternId(crop.cropId, 0);
    return [crop.cropId, DIRECTIONAL.has(kind) ? ['case', parity, a, patternId(crop.cropId, 1)] : a];
  });
  if (pairs.length === 0) return ['literal', ''] as unknown as ExpressionSpecification;
  return ['match', ['get', 'crop_id'], ...pairs, ''] as unknown as ExpressionSpecification;
}
