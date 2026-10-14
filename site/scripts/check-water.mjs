// Opens the field popup at a few well-known farm areas and prints the water section, with a screenshot of each.
//   URL=http://127.0.0.1:5173/ CHROMIUM_PATH=... node scripts/check-water.mjs
import { chromium } from 'playwright';

const url = process.env.URL ?? 'http://127.0.0.1:5173/';
const PLACES = [
  ['westlands', [-120.33, 36.42]],
  ['salinas', [-121.6, 36.62]],
  ['imperial', [-115.52, 32.93]],
  ['kern-arvin', [-118.85, 35.15]],
  ['kern-shafter', [-119.2, 35.48]],
];

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(url);
await page.waitForFunction(() => window.__app && document.querySelector('.crop-marker[data-state=shown]'), null, { timeout: 90000 });

for (const [name, center] of PLACES) {
  await page.evaluate((c) => window.__map.jumpTo({ center: c, zoom: 13.5 }), center);
  for (let i = 0; i < 80 && !(await page.evaluate(() => window.__map.areTilesLoaded())); i++) await page.waitForTimeout(250);
  await page.waitForTimeout(600);
  // Nearest field to the centre: walk outwards until the popup finds one.
  const opened = await page.evaluate(() => {
    const m = window.__map;
    const { width, height } = m.getCanvas().getBoundingClientRect();
    for (let r = 0; r <= 200; r += 20)
      for (let a = 0; a < 360; a += 45) {
        const p = [width / 2 + r * Math.cos((a * Math.PI) / 180), height / 2 + r * Math.sin((a * Math.PI) / 180)];
        if (window.__app.popup.openAt(m.unproject(p))) return true;
      }
    return false;
  });
  await page.waitForFunction(() => document.querySelector('.fp-water'), null, { timeout: 15000 }).catch(() => undefined);
  await page.waitForTimeout(700);
  const water = await page.evaluate(() =>
    [...document.querySelectorAll('.fp-water-row')].map((r) => r.innerText.replace(/\s*\n\s*/g, ' | ')),
  );
  const crop = await page.evaluate(() => document.querySelector('.fp-name')?.textContent ?? '');
  console.log(`${name.padEnd(10)} ${opened ? crop : '(no field)'}\n    ${water.join('\n    ')}`);
  await page.screenshot({ path: `/tmp/water-${name}.png` });
}
console.log(errors.length ? `errors: ${errors.join(' | ')}` : 'no console errors');
await browser.close();
