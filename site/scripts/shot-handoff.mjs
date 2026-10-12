import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errs = [];
page.on('console', (m) => m.type() === 'error' && errs.push(m.text() + ' @ ' + JSON.stringify(m.location())));
await page.goto('http://127.0.0.1:5196/');
await page.waitForFunction(() => window.__app, null, { timeout: 90000 });
await page.waitForTimeout(1500);
await page.locator('.cs-input').click();
await page.keyboard.type('almond');
await page.waitForTimeout(400);
await page.keyboard.press('Enter');
await page.waitForTimeout(500);
for (const z of [8.5, 9.4, 10.2, 10.7, 11.2]) {
  await page.evaluate((z) => window.__map.jumpTo({ center: [-120.3, 37.0], zoom: z, pitch: 0, bearing: 0 }), z);
  await page.waitForFunction(() => window.__map.areTilesLoaded() && !window.__map.isMoving(), null, { timeout: 120000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `/tmp/hand-${z}.png` });
}
console.log(errs);
await browser.close();
