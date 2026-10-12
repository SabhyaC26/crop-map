import type { Map as MapLibreMap } from 'maplibre-gl';
import type { MarkerItem } from './choreography';
import { bandScale, GROUND_GAP, LABEL_HEIGHT } from './zoom';


export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const PAD = 1;
/** The glyph fills roughly this much of the icon box; the rest is transparent margin. */
export const GLYPH_INSET = 0.14;
const VIEW_MARGIN = 140;

const overlaps = (a: Rect, b: Rect): boolean =>
  a.x0 < b.x1 + PAD && a.x1 + PAD > b.x0 && a.y0 < b.y1 + PAD && a.y1 + PAD > b.y0;

const isCovered = (item: MarkerItem): boolean => item.parts.root.classList.contains('maplibregl-marker-covered');

function boxes(item: MarkerItem, x: number, y: number, scale: number): [icon: Rect, label: Rect] {
  const size = item.size * scale;
  const labelW = item.labelWidth;
  // The label keeps a constant on-screen size (counter-scaled), hanging from the icon's bottom edge.
  const iconBottom = y - (GROUND_GAP + LABEL_HEIGHT) * scale;
  const inset = size * GLYPH_INSET;
  return [
    { x0: x - size / 2 + inset, x1: x + size / 2 - inset, y0: iconBottom - size + inset, y1: iconBottom },
    { x0: x - labelW / 2, x1: x + labelW / 2, y0: iconBottom, y1: iconBottom + LABEL_HEIGHT },
  ];
}

/**
 * Greedy screen-space declutter of one level, highest priority first. A marker whose icon overlaps an
 * already placed icon or label is hidden; otherwise it stays, and only its label is dropped when that
 * label would collide. Returns the items whose gate or label flipped and the screen boxes that ended up occupied.
 */
export interface CollisionOptions {
  /** Items that must stay hidden (declutter rules above the pixel-level check); they claim no space. */
  excluded?: ReadonlySet<MarkerItem>;
  /** Labels only appear on hover / focus: they neither show nor reserve space. */
  hideLabels?: boolean;
}

export function resolveCollisions(
  map: MapLibreMap,
  ordered: readonly MarkerItem[],
  zoom: number,
  obstacles: readonly Rect[] = [],
  { excluded, hideLabels = false }: CollisionOptions = {},
): { changed: MarkerItem[]; placed: Rect[] } {
  const { clientWidth: w, clientHeight: h } = map.getContainer();
  const placed: Rect[] = [...obstacles];
  const changed: MarkerItem[] = [];
  for (const item of ordered) {
    if (isCovered(item)) continue;
    const projected = map.project(item.region.lngLat);
    const p = { x: projected.x, y: projected.y + item.nudgeY };
    let gateOn = !excluded?.has(item);
    let labelOn = !hideLabels && gateOn;
    const onScreen = p.x > -VIEW_MARGIN && p.x < w + VIEW_MARGIN && p.y > -VIEW_MARGIN && p.y < h + VIEW_MARGIN;
    if (onScreen && gateOn) {
      const [icon, label] = boxes(item, p.x, p.y, bandScale(item.region.level, zoom, 1));
      gateOn = !placed.some((q) => overlaps(icon, q));
      if (gateOn) {
        labelOn = !hideLabels && !placed.some((q) => overlaps(label, q));
        placed.push(icon);
        if (labelOn) placed.push(label);
      }
    }
    if (gateOn !== item.gateOn || labelOn !== item.labelOn) {
      item.gateOn = gateOn;
      item.labelOn = labelOn;
      changed.push(item);
    }
  }
  return { changed, placed: placed.slice(obstacles.length) };
}
