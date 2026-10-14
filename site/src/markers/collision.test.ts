// @vitest-environment jsdom
import type { Map as MapLibreMap, Marker } from 'maplibre-gl';
import { describe, expect, it } from 'vitest';
import type { Crop } from '../data/crops';
import type { MarkerItem } from './choreography';
import { type CollisionOptions, type Rect, resolveCollisions } from './collision';
import type { Region } from './regions';

// Screen coordinates are the lng/lat values themselves, so tests can place markers in pixels directly.
const fakeMap = (width = 800, height = 600): MapLibreMap =>
  ({
    getContainer: () => ({ clientWidth: width, clientHeight: height }),
    project: ([x, y]: [number, number]) => ({ x, y }),
  }) as unknown as MapLibreMap;

const crop: Crop = { cropId: 1, dwrCode: 'ALM', name: 'Almond', icon: '', color: '#fff', group: 'tree', harvest: null };

// Zoom 6 keeps coarse markers at ~0.99 scale, so icon boxes are ~40px with ~34px of glyph height.
const ZOOM = 6;

interface ItemOptions {
  size?: number;
  labelWidth?: number;
  nudgeY?: number;
  covered?: boolean;
}

const span = (): HTMLSpanElement => document.createElement('span');

function item(id: string, x: number, y: number, options: ItemOptions = {}): MarkerItem {
  const root = document.createElement('button');
  if (options.covered) root.classList.add('maplibregl-marker-covered');
  const region: Region = {
    id,
    level: 'coarse',
    cropId: crop.cropId,
    acres: 100,
    label: id,
    rank: 0,
    parent: null,
    lngLat: [x, y],
  };
  return {
    region,
    crop,
    marker: {} as Marker,
    parts: { root, fx: span(), band: span(), label: span(), name: span() },
    size: options.size ?? 40,
    labelWidth: options.labelWidth ?? 60,
    parent: null,
    sibling: 0,
    siblingCount: 1,
    anims: [],
    attached: true,
    shown: true,
    gateOn: true,
    labelOn: true,
    inert: false,
    bandOpacity: 1,
    bandScale: 1,
    nudgeY: options.nudgeY ?? 0,
  };
}

const run = (
  items: MarkerItem[],
  options?: CollisionOptions,
  obstacles?: Rect[],
  map: MapLibreMap = fakeMap(),
) => resolveCollisions(map, items, ZOOM, obstacles, options);

describe('resolveCollisions', () => {
  it('keeps isolated markers visible with their labels and reports no changes', () => {
    const a = item('a', 100, 200);
    const b = item('b', 400, 200);
    const { changed, placed } = run([a, b]);
    expect(a.gateOn && a.labelOn && b.gateOn && b.labelOn).toBe(true);
    expect(changed).toEqual([]);
    expect(placed).toHaveLength(4);
  });

  it('hides the lower-priority marker when icons overlap', () => {
    const a = item('a', 100, 200);
    const b = item('b', 110, 200);
    const { changed } = run([a, b]);
    expect(a.gateOn).toBe(true);
    expect(b.gateOn).toBe(false);
    expect(changed).toEqual([b]);
  });

  it('a marker hidden by an icon collision also has its label switched off', () => {
    // collision.ts:62 seeds labelOn from gateOn before the icon test, and the icon-overlap branch never clears it.
    const a = item('a', 100, 200);
    const b = item('b', 110, 200);
    run([a, b]);
    expect(b.gateOn).toBe(false);
    expect(b.labelOn).toBe(false);
  });

  it('gives priority to list order, not to screen position', () => {
    const left = item('left', 100, 200);
    const right = item('right', 110, 200);
    run([right, left]);
    expect(right.gateOn).toBe(true);
    expect(left.gateOn).toBe(false);
  });

  it('keeps only the first of two markers at identical positions', () => {
    const first = item('first', 250, 250);
    const second = item('second', 250, 250);
    run([first, second]);
    expect(first.gateOn).toBe(true);
    expect(second.gateOn).toBe(false);
  });

  it('drops a colliding label while its icon stays visible', () => {
    // Icons are clear of each other, but the second label runs into the first label.
    const a = item('a', 100, 200);
    const b = item('b', 152, 187);
    const { changed } = run([a, b]);
    expect(b.gateOn).toBe(true);
    expect(b.labelOn).toBe(false);
    expect(a.labelOn).toBe(true);
    expect(changed).toEqual([b]);
  });

  it('excluded markers claim no space and stay hidden, so an overlapping neighbour stays visible', () => {
    const excluded = item('excluded', 100, 200);
    const neighbour = item('neighbour', 110, 200);
    run([excluded, neighbour], { excluded: new Set([excluded]) });
    expect(excluded.gateOn).toBe(false);
    expect(excluded.labelOn).toBe(false);
    expect(neighbour.gateOn).toBe(true);
    expect(neighbour.labelOn).toBe(true);
  });

  it('with hideLabels, labels never show and never reserve space', () => {
    const a = item('a', 100, 200);
    const b = item('b', 152, 187);
    const { placed } = run([a, b], { hideLabels: true });
    expect(a.labelOn).toBe(false);
    expect(b.labelOn).toBe(false);
    expect(b.gateOn).toBe(true);
    // Only the two icon boxes end up occupied.
    expect(placed).toHaveLength(2);
  });

  it('off-screen markers stay visible and claim no space even when they overlap', () => {
    const a = item('a', -150, 100);
    const b = item('b', -140, 100);
    const { placed } = run([a, b]);
    expect(a.gateOn).toBe(true);
    expect(b.gateOn).toBe(true);
    expect(placed).toEqual([]);
  });

  it('markers inside the 140px view margin are tested for collisions like on-screen ones', () => {
    const a = item('a', -100, 100);
    const b = item('b', -90, 100);
    run([a, b]);
    expect(b.gateOn).toBe(false);
  });

  it('obstacles block markers but are not returned as occupied space', () => {
    const a = item('a', 100, 200);
    const obstacle: Rect = { x0: 80, y0: 150, x1: 120, y1: 190 };
    const { changed, placed } = run([a], undefined, [obstacle]);
    expect(a.gateOn).toBe(false);
    expect(changed).toEqual([a]);
    expect(placed).toEqual([]);
  });

  it('nudgeY pushes the marker box down before the overlap test', () => {
    const top = item('top', 100, 100);
    const lower = item('lower', 100, 60);
    run([top, lower]);
    expect(lower.gateOn).toBe(true);

    const nudged = item('nudged', 100, 60, { nudgeY: 30 });
    const anchor = item('anchor', 100, 100);
    run([anchor, nudged]);
    expect(nudged.gateOn).toBe(false);
  });

  it('covered markers are skipped: they keep their state, change nothing and claim no space', () => {
    const covered = item('covered', 100, 200, { covered: true });
    const neighbour = item('neighbour', 110, 200);
    const { changed, placed } = run([covered, neighbour]);
    expect(covered.gateOn).toBe(true);
    expect(changed).not.toContain(covered);
    expect(neighbour.gateOn).toBe(true);
    expect(placed.length).toBe(2);
  });

  it('reports only the items whose visibility flipped, and is stable on a second pass', () => {
    const a = item('a', 100, 200);
    const b = item('b', 110, 200);
    const first = run([a, b]);
    expect(first.changed).toEqual([b]);
    const second = run([a, b]);
    expect(second.changed).toEqual([]);
  });

  it('two zero-size markers at the same point: the second is hidden', () => {
    const a = item('a', 300, 300, { size: 0, labelWidth: 0 });
    const b = item('b', 300, 300, { size: 0, labelWidth: 0 });
    run([a, b]);
    expect(a.gateOn).toBe(true);
    expect(b.gateOn).toBe(false);
  });
});
