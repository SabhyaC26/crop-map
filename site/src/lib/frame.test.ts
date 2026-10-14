import type { Map as MapLibreMap } from 'maplibre-gl';
import { describe, expect, it, vi, type Mock } from 'vitest';
import { frameInstant, solveFrame, type FramePadding } from './frame';

type Lng = number;
type Lat = number;
type Point2 = { x: number; y: number };

const CONTAINER = { clientWidth: 1000, clientHeight: 600 };
const PAD: FramePadding = { top: 84, bottom: 34, left: 40, right: 64 };
/** Pixels per degree at zoom 0. The fake projection is linear, so the zoom refinement should converge in one pass. */
const PX_PER_DEG = 40;
const CA_BOUNDS: [[Lng, Lat], [Lng, Lat]] = [
  [-124.6, 32.4],
  [-113.9, 42.1],
];
const DIAGONAL: [Lng, Lat][] = [
  [-124.4, 40.4],
  [-124.2, 42],
  [-120, 42],
  [-120, 39],
  [-114.1, 34.3],
  [-114.7, 32.7],
  [-117.1, 32.5],
  [-120.5, 34.4],
];

interface Camera {
  center: { lng: Lng; lat: Lat };
  zoom: number;
  pitch: number;
  bearing: number;
}

interface FitOptions {
  padding: FramePadding;
  maxZoom: number;
  pitch: number;
  bearing: number;
  duration: number;
}

interface FakeMap {
  map: MapLibreMap;
  camera: Camera;
  /** Zoom reached by each fitBounds seed, before any refinement. */
  seedZooms: number[];
  fitBounds: Mock<(bounds: [[Lng, Lat], [Lng, Lat]], options: FitOptions) => void>;
  project: (lngLat: [Lng, Lat]) => Point2;
}

/** Linear stand-in for maplibre: no mercator distortion, so the projection is exact and easy to reason about. */
function createFakeMap(initial: Camera = { center: { lng: -119, lat: 37 }, zoom: 5, pitch: 25, bearing: 10 }): FakeMap {
  const camera: Camera = { ...initial, center: { ...initial.center } };
  const seedZooms: number[] = [];
  const scale = (): number => PX_PER_DEG * 2 ** camera.zoom;
  const project = ([lng, lat]: [Lng, Lat]): Point2 => ({
    x: CONTAINER.clientWidth / 2 + (lng - camera.center.lng) * scale(),
    y: CONTAINER.clientHeight / 2 - (lat - camera.center.lat) * scale(),
  });
  const unproject = ([x, y]: [number, number]) => ({
    lng: camera.center.lng + (x - CONTAINER.clientWidth / 2) / scale(),
    lat: camera.center.lat - (y - CONTAINER.clientHeight / 2) / scale(),
  });
  const fitBounds = vi.fn((bounds: [[Lng, Lat], [Lng, Lat]], options: FitOptions) => {
    const [[west, south], [east, north]] = bounds;
    const freeW = CONTAINER.clientWidth - options.padding.left - options.padding.right;
    const freeH = CONTAINER.clientHeight - options.padding.top - options.padding.bottom;
    const fitZoom = Math.log2(Math.min(freeW / ((east - west) * PX_PER_DEG), freeH / ((north - south) * PX_PER_DEG)));
    camera.center = { lng: (west + east) / 2, lat: (south + north) / 2 };
    camera.zoom = Math.min(options.maxZoom, fitZoom);
    camera.pitch = options.pitch;
    camera.bearing = options.bearing;
    seedZooms.push(camera.zoom);
  });
  const fake = {
    getContainer: () => CONTAINER,
    fitBounds,
    jumpTo: (options: Partial<Camera>) => {
      if (options.center) camera.center = { ...options.center };
      if (options.zoom !== undefined) camera.zoom = options.zoom;
      if (options.pitch !== undefined) camera.pitch = options.pitch;
      if (options.bearing !== undefined) camera.bearing = options.bearing;
    },
    project,
    unproject,
    getCenter: () => ({ ...camera.center }),
    getZoom: () => camera.zoom,
    getPitch: () => camera.pitch,
    getBearing: () => camera.bearing,
  };
  return { map: fake as unknown as MapLibreMap, camera, seedZooms, fitBounds, project };
}

function projectAll(fake: FakeMap, points: [Lng, Lat][]): { minX: number; maxX: number; minY: number; maxY: number } {
  const pts = points.map((p) => fake.project(p));
  return {
    minX: Math.min(...pts.map((p) => p.x)),
    maxX: Math.max(...pts.map((p) => p.x)),
    minY: Math.min(...pts.map((p) => p.y)),
    maxY: Math.max(...pts.map((p) => p.y)),
  };
}

const freeW = CONTAINER.clientWidth - PAD.left - PAD.right;
const freeH = CONTAINER.clientHeight - PAD.top - PAD.bottom;

describe('frameInstant', () => {
  it('places every point inside the free area left after padding', () => {
    const fake = createFakeMap();
    frameInstant(fake.map, CA_BOUNDS, DIAGONAL, PAD);
    const e = projectAll(fake, DIAGONAL);
    expect(e.minX).toBeGreaterThanOrEqual(PAD.left - 0.5);
    expect(e.maxX).toBeLessThanOrEqual(CONTAINER.clientWidth - PAD.right + 0.5);
    expect(e.minY).toBeGreaterThanOrEqual(PAD.top - 0.5);
    expect(e.maxY).toBeLessThanOrEqual(CONTAINER.clientHeight - PAD.bottom + 0.5);
  });

  it('fills the free area on the limiting axis, so the framing is tight', () => {
    const fake = createFakeMap();
    frameInstant(fake.map, CA_BOUNDS, DIAGONAL, PAD);
    const e = projectAll(fake, DIAGONAL);
    const fillX = (e.maxX - e.minX) / freeW;
    const fillY = (e.maxY - e.minY) / freeH;
    expect(Math.max(fillX, fillY)).toBeCloseTo(1, 2);
    expect(Math.min(fillX, fillY)).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('centres the points within the free area, not the whole container', () => {
    const fake = createFakeMap();
    frameInstant(fake.map, CA_BOUNDS, DIAGONAL, PAD);
    const e = projectAll(fake, DIAGONAL);
    expect((e.minX + e.maxX) / 2).toBeCloseTo(PAD.left + freeW / 2, 0);
    expect((e.minY + e.maxY) / 2).toBeCloseTo(PAD.top + freeH / 2, 0);
  });

  it('zooms tighter than the bounding box for a diagonal shape', () => {
    const fake = createFakeMap();
    frameInstant(fake.map, CA_BOUNDS, DIAGONAL, PAD);
    const seed = fake.seedZooms[0] ?? NaN;
    expect(fake.camera.zoom).toBeGreaterThan(seed);
  });

  it('seeds from fitBounds flat, with no animation', () => {
    const fake = createFakeMap();
    frameInstant(fake.map, CA_BOUNDS, DIAGONAL, PAD);
    expect(fake.fitBounds).toHaveBeenCalledWith(
      CA_BOUNDS,
      expect.objectContaining({ padding: PAD, duration: 0, pitch: 0, bearing: 0, maxZoom: 22 }),
    );
    expect(fake.camera.pitch).toBe(0);
    expect(fake.camera.bearing).toBe(0);
  });

  it('never zooms past the maxZoom it was given', () => {
    const fake = createFakeMap();
    const tiny: [Lng, Lat][] = [
      [-120, 37],
      [-120.001, 37.001],
    ];
    frameInstant(fake.map, CA_BOUNDS, tiny, PAD, 9);
    expect(fake.camera.zoom).toBe(9);
  });
});

describe('solveFrame', () => {
  it('reports the camera that frameInstant would produce', () => {
    const measured = createFakeMap();
    const applied = createFakeMap();
    const camera = solveFrame(measured.map, CA_BOUNDS, DIAGONAL, PAD);
    frameInstant(applied.map, CA_BOUNDS, DIAGONAL, PAD);
    expect(camera.zoom).toBe(applied.camera.zoom);
    expect(camera.center).toEqual(applied.camera.center);
  });

  it('puts the original camera back, pitch and bearing included', () => {
    const fake = createFakeMap();
    const before = { ...fake.camera, center: { ...fake.camera.center } };
    solveFrame(fake.map, CA_BOUNDS, DIAGONAL, PAD);
    expect(fake.camera).toEqual(before);
  });
});
