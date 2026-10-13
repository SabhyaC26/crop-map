// Screenshots of the hillshade at a few zooms, for comparing terrain settings.
//   CHROMIUM_PATH=... node scripts/shot-terrain.mjs <label> [url]
import { chromium } from 'playwright';

const [label = 'shot', url = 'http://127.0.0.1:5173/'] = process.argv.slice(2);
const VIEWS = [
  ['state', null, null],
  ['sierra-z8', [-119.6, 37.4], 8],
  ['salinas-z11', [-121.55, 36.55], 11.5],
];

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);
for (const [name, center, zoom] of VIEWS) {
  if (center) await page.evaluate(([c, z]) => window.__map.jumpTo({ center: c, zoom: z }), [center, zoom]);
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(500);
    if (await page.evaluate(() => window.__map.areTilesLoaded())) break;
  }
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `/tmp/terrain-${label}-${name}.png` });
}
await browser.close();
