// Screenshots at fixed camera positions for before/after visual comparison.
//   node scripts/perf-shots.mjs --url http://127.0.0.1:5199/ --prefix after [--out ../docs/screens/]
// Writes <out>/perf-<prefix>-<view>.png. Views: ca, z7, z12-salinas, plus z14/z15 overzoom checks for the basemap extract.
import { chromium } from 'playwright';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const url = arg('url', 'http://127.0.0.1:5199/');
const prefix = arg('prefix', 'run');
const outDir = arg('out', new URL('../../docs/screens/', import.meta.url).pathname);

const VIEWS = [
  ['ca', null],
  ['z7', { center: [-120.2, 36.6], zoom: 7, pitch: 0, bearing: 0 }],
  ['z12-salinas', { center: [-121.65, 36.68], zoom: 12, pitch: 0, bearing: 0 }],
  ['z14-sf', { center: [-122.42, 37.77], zoom: 14, pitch: 0, bearing: 0 }],
  ['z15-fresno', { center: [-119.79, 36.74], zoom: 15, pitch: 0, bearing: 0 }],
];

const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(url);
await page.waitForFunction(() => window.__app && document.querySelector('.crop-marker[data-state=shown]'), null, { timeout: 120000 });
for (const [name, camera] of VIEWS) {
  if (camera) await page.evaluate((c) => window.__map.jumpTo(c), camera);
  await page.waitForFunction(() => window.__map.areTilesLoaded() && !window.__map.isMoving(), null, { timeout: 120000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${outDir}perf-${prefix}-${name}.png` });
  console.log('saved', `perf-${prefix}-${name}.png`);
}
console.log('console errors', errors.length, errors.slice(0, 5));
await browser.close();
