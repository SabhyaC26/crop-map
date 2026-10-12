// Usage: node scripts/shot-sticker.mjs <out.png> <width> <height> [pitch] [terrainExaggeration] [crop=x,y,w,h]
import { chromium } from 'playwright';

const [out, w = '1440', h = '1000', pitch = '0', exag = '0', crop] = process.argv.slice(2);
const url = process.env.URL ?? 'http://localhost:5192/';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text().slice(0, 200)); });
await page.goto(url);
await page.waitForFunction(() => window.__map && window.__map.loaded?.() !== undefined);
await page.waitForTimeout(1500);
if (+pitch || +exag) {
  await page.evaluate(([pitch, exag]) => {
    const map = window.__map;
    if (exag > 0) map.setTerrain({ source: 'terrain', exaggeration: exag });
    map.jumpTo({ pitch });
  }, [+pitch, +exag]);
}
await page.waitForFunction(() => window.__map.areTilesLoaded() && window.__map.isStyleLoaded(), null, { timeout: 90000 });
await page.waitForTimeout(3000);
const clip = crop ? Object.fromEntries(crop.split(',').map((v, i) => [['x', 'y', 'width', 'height'][i], +v])) : undefined;
await page.screenshot({ path: out, clip });
await browser.close();
console.log('saved', out);
