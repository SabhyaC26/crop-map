// Usage: node scripts/shot.mjs <out.png> <lng> <lat> <zoom|fit> [width] [height] [pitch]
import { chromium } from 'playwright';

const [out, lng, lat, zoom, w = '1440', h = '900', pitch = '0'] = process.argv.slice(2);
const url = process.env.URL ?? 'http://localhost:5173/';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 2 });
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) console.log('[console]', m.text().slice(0, 200)); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url);
await page.waitForFunction(() => window.__map && window.__map.loaded?.() !== undefined);
if (zoom !== 'fit') {
  await page.evaluate(([lng, lat, zoom, pitch]) => window.__map.jumpTo({ center: [lng, lat], zoom, pitch }), [+lng, +lat, +zoom, +pitch]);
}
await page.waitForTimeout(1500);
await page.waitForFunction(() => window.__map.areTilesLoaded() && window.__map.isStyleLoaded(), null, { timeout: 90000 });
await page.waitForTimeout(2500);
console.log(await page.evaluate(() => JSON.stringify({ z: window.__map.getZoom(), c: window.__map.getCenter(), w: innerWidth, h: innerHeight, n: window.__map.project([-119, 42]) })));
await page.screenshot({ path: out });
await browser.close();
console.log('saved', out);
