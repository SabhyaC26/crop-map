// Generates site/public/data/storybook-ocean.geojson: little wave marks (LineStrings),
// and sparkle points scattered over open Pacific water.
// Usage: node scripts/make-storybook-ocean.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', 'public', 'data');
const mask = JSON.parse(readFileSync(join(dataDir, 'ocean-mask.geojson'), 'utf8'));
const polygons = mask.features[0].geometry.coordinates;

const inRing = (x, y, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const inOcean = (x, y) =>
  polygons.some((poly) => inRing(x, y, poly[0]) && !poly.slice(1).some((hole) => inRing(x, y, hole)));

const clearOfCoast = (x, y, radius) => {
  for (let a = 0; a < 8; a++) {
    const t = (a / 8) * Math.PI * 2;
    if (!inOcean(x + Math.cos(t) * radius * 1.25, y + Math.sin(t) * radius)) return false;
  }
  return inOcean(x, y);
};

let seed = 20261012;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

const BOX = { w: -136, e: -118.5, s: 30.5, n: 43.6 };
const sample = (clear) => {
  for (let i = 0; i < 400; i++) {
    const x = BOX.w + rand() * (BOX.e - BOX.w);
    const y = BOX.s + rand() * (BOX.n - BOX.s);
    if (clearOfCoast(x, y, clear)) return [x, y];
  }
  return null;
};

const farEnough = (pts, p, min) => pts.every((q) => Math.hypot(q[0] - p[0], (q[1] - p[1]) * 1.25) > min);

const waveLine = ([cx, cy], len, amp) => {
  const coords = [];
  const n = 14;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    coords.push([cx + (t - 0.5) * len, cy + Math.sin(t * Math.PI * 2) * amp]);
  }
  return coords;
};

const features = [];
const centres = [];
while (centres.length < 30) {
  const p = sample(0.55);
  if (!p) break;
  if (!farEnough(centres, p, 1.45)) continue;
  centres.push(p);
  const len = 0.38 + rand() * 0.3;
  features.push({
    type: 'Feature',
    properties: { kind: 'wave', k: Math.floor(rand() * 3) },
    geometry: { type: 'LineString', coordinates: waveLine(p, len, len * 0.1) },
  });
}

const sparkles = [];
while (sparkles.length < 55) {
  const p = sample(0.3);
  if (!p) break;
  if (!farEnough(sparkles, p, 0.7)) continue;
  sparkles.push(p);
  features.push({
    type: 'Feature',
    properties: { kind: 'sparkle', k: sparkles.length % 3, r: 0.6 + rand() },
    geometry: { type: 'Point', coordinates: p },
  });
}

writeFileSync(
  join(dataDir, 'storybook-ocean.geojson'),
  JSON.stringify({ type: 'FeatureCollection', features }),
);
console.log({ waves: centres.length, sparkles: sparkles.length });
