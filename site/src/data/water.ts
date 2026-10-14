import type { Feature, FeatureCollection, MultiPolygon, Polygon, Position } from 'geojson';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import { WATER_URL } from '../config';

export interface BasinInfo {
  name: string;
  critical: boolean;
}

export interface WaterInfo {
  /** The most local public water agency serving the point (smallest containing polygon). */
  district: string | null;
  /** The widest agency it sits inside (a wholesaler or project contractor), when there is one. */
  within: string | null;
  basin: BasinInfo | null;
}

/** `u`: a town or utility system, ranked after agricultural agencies (cities annex the farmland around them). */
type DistrictProps = { n: string; u?: 1 };
type BasinProps = { n: string; c?: 1 };

interface Shape<P> {
  bbox: [number, number, number, number];
  /** Polygons, each a list of rings (outer + holes): even-odd crossing over all rings handles the holes. */
  polygons: Position[][][];
  area: number;
  props: P;
}

interface WaterIndex {
  districts: Shape<DistrictProps>[];
  basins: Shape<BasinProps>[];
}

let index: WaterIndex | null = null;
let loading: Promise<void> | undefined;

/** Shoelace area in square degrees: only used to rank overlapping agencies, so the projection does not matter. */
function ringArea(ring: Position[]): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j];
    const b = ring[i];
    if (a && b) sum += ((a[0] ?? 0) - (b[0] ?? 0)) * ((a[1] ?? 0) + (b[1] ?? 0));
  }
  return Math.abs(sum / 2);
}

function toShape<P>(geometry: Polygon | MultiPolygon, props: P): Shape<P> | null {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const bbox: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  let area = 0;
  for (const [outer = [], ...holes] of polygons) {
    for (const [x = NaN, y = NaN] of outer) {
      bbox[0] = Math.min(bbox[0], x);
      bbox[1] = Math.min(bbox[1], y);
      bbox[2] = Math.max(bbox[2], x);
      bbox[3] = Math.max(bbox[3], y);
    }
    area += ringArea(outer) - holes.reduce((s, r) => s + ringArea(r), 0);
  }
  return Number.isFinite(bbox[0]) ? { bbox, polygons, area, props } : null;
}

function contains<P>(shape: Shape<P>, x: number, y: number): boolean {
  const [x0, y0, x1, y1] = shape.bbox;
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  let inside = false;
  for (const rings of shape.polygons) {
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi = 0, yi = 0] = ring[i] ?? [];
        const [xj = 0, yj = 0] = ring[j] ?? [];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
    }
  }
  return inside;
}

function layer<P extends Record<string, unknown>>(topology: Topology, name: string): Shape<P>[] {
  const collection = topology.objects[name] as GeometryCollection<P> | undefined;
  if (!collection) return [];
  const { features } = feature(topology, collection) as FeatureCollection<Polygon | MultiPolygon, P>;
  return features.flatMap((f: Feature<Polygon | MultiPolygon, P>) => (f.geometry ? (toShape(f.geometry, f.properties) ?? []) : []));
}

/** Fetches and indexes the water polygons once; later calls share the same promise. */
export function loadWater(): Promise<void> {
  loading ??= fetch(WATER_URL)
    .then((res) => {
      if (!res.ok) throw new Error(`water: HTTP ${res.status}`);
      return res.json() as Promise<Topology>;
    })
    .then((topology) => {
      index = { districts: layer<DistrictProps>(topology, 'districts'), basins: layer<BasinProps>(topology, 'basins') };
    });
  return loading;
}

/** Water context at a point, or null until `loadWater` has finished. */
export function waterAt(lng: number, lat: number): WaterInfo | null {
  if (!index) return null;
  const districts = index.districts
    .filter((s) => contains(s, lng, lat))
    .sort((a, b) => (a.props.u ?? 0) - (b.props.u ?? 0) || a.area - b.area);
  const local = districts[0];
  const widest = districts.filter((s) => !s.props.u).reduce<Shape<DistrictProps> | undefined>((w, s) => (!w || s.area > w.area ? s : w), undefined);
  const basin = index.basins.find((s) => contains(s, lng, lat));
  return {
    district: local?.props.n ?? null,
    within: local && widest && widest.props.n !== local.props.n ? widest.props.n : null,
    basin: basin ? { name: basin.props.n, critical: basin.props.c === 1 } : null,
  };
}
