// Usage: node scripts/shot-view.mjs <out.png> <lng> <lat> <zoom> [w] [h]  (URL env, default :5196)
import { chromium } from 'playwright';

const [out, lng, lat, zoom, w = '1440', h = '1000'] = process.argv.slice(2);
const url = process.env.URL ?? 'http://127.0.0.1:5196/';
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 })).newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(url);
await page.waitForFunction(() => window.__app, null, { timeout: 90000 });
await page.waitForTimeout(1500);
await page.evaluate(([lng, lat, z]) => window.__map.jumpTo({ center: [lng, lat], zoom: z, pitch: 0, bearing: 0 }), [+lng, +lat, +zoom]);
await page.waitForFunction(() => window.__map.areTilesLoaded() && !window.__map.isMoving(), null, { timeout: 120000 });
await page.waitForTimeout(2500);
console.log(await page.evaluate(() => JSON.stringify({ z: window.__map.getZoom(), c: window.__map.getCenter() })));
await page.screenshot({ path: out });
console.log('errors', errors);
await browser.close();
