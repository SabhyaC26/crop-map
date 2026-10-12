// Usage: node scripts/shot-overview.mjs <ca|z7|mobile> <out.png>   (URL env overrides http://localhost:5191/)
import { chromium } from 'playwright';

const [scenario, out] = process.argv.slice(2);
const url = process.env.URL ?? 'http://localhost:5191/';
const mobile = scenario === 'mobile';
const viewport = mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 };
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, hasTouch: mobile, isMobile: mobile });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.log('[console.error]', m.text().slice(0, 300)); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url);
await page.waitForFunction(() => window.__app, null, { timeout: 60000 });
if (scenario === 'z7') {
  await page.evaluate(() => window.__map.jumpTo({ center: [-120.2, 36.6], zoom: 7, pitch: 0 }));
}
await page.waitForTimeout(1200);
await page.waitForFunction(() => window.__map.areTilesLoaded() && window.__map.isStyleLoaded(), null, { timeout: 120000 });
await page.waitForTimeout(2500);
console.log(await page.evaluate(() => JSON.stringify({ z: window.__map.getZoom() })));
await page.screenshot({ path: out });
await browser.close();
