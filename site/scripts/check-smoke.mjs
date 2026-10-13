// Smoke test of the core flows against any build: map reveal, emoji markers, field popup, crop search.
//   URL=http://127.0.0.1:5200/ CHROMIUM_PATH=... node scripts/check-smoke.mjs
import { chromium } from 'playwright';

const url = process.env.URL ?? 'http://127.0.0.1:5173/';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`);
};
const tilesLoaded = async (page) => {
  for (let i = 0; i < 120; i++) {
    if (await page.evaluate(() => window.__map.areTilesLoaded())) return;
    await page.waitForTimeout(250);
  }
};

for (const [label, viewport] of [['desktop', { width: 1280, height: 800 }], ['mobile', { width: 390, height: 844 }]]) {
  const page = await browser.newPage({ viewport, isMobile: label === 'mobile', hasTouch: label === 'mobile' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('response', (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`));
  await page.goto(url);
  await page.waitForFunction(() => document.querySelector('.crop-marker[data-state=shown]'), null, { timeout: 90000 });
  check(`${label}: map revealed and emoji markers shown`, await page.evaluate(() => document.documentElement.classList.contains('map-ready')));

  await page.locator('.cs-input').click();
  await page.locator('.cs-input').fill('almonds');
  await page.waitForTimeout(400);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  const search = await page.evaluate(() => ({
    mode: document.querySelector('.cs-root')?.getAttribute('data-mode'),
    suppressed: document.querySelectorAll('.crop-marker[data-suppressed]').length,
  }));
  check(`${label}: search "almonds" selects the crop and hides markers`, search.mode === 'chip' && search.suppressed > 0, JSON.stringify(search));
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  await page.evaluate(() => window.__map.jumpTo({ center: [-121.62, 36.62], zoom: 13 }));
  await page.waitForTimeout(600);
  await tilesLoaded(page);
  await page.waitForTimeout(800);
  const pt = await page.evaluate(() => {
    const m = window.__map;
    const layers = m.getStyle().layers.filter((l) => l.source === 'fields' && l.type === 'fill').map((l) => l.id);
    const { width, height } = m.getCanvas().getBoundingClientRect();
    for (let dy = -60; dy <= 60; dy += 20)
      for (let dx = -60; dx <= 60; dx += 20) {
        const p = { x: width / 2 + dx, y: height / 2 + dy };
        if (m.queryRenderedFeatures([p.x, p.y], { layers }).length) return p;
      }
    return null;
  });
  if (pt) {
    if (label === 'mobile') await page.touchscreen.tap(pt.x, pt.y);
    else await page.mouse.click(pt.x, pt.y);
    await page.waitForTimeout(900);
  }
  check(`${label}: clicking a field opens the popup card`, (await page.locator('.fp-card').count()) > 0, pt ? '' : '(no field under centre)');
  if (label === 'mobile') {
    const legend = await page.evaluate(() => !!document.querySelector('#legend-slot')?.textContent?.match(/Legend|crops/));
    check(`${label}: legend pill present`, legend);
  } else {
    check(`${label}: "What's in view" legend present`, (await page.locator('#legend-slot').innerText()).includes("What's in view"));
  }
  check(`${label}: no console errors or failed requests`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await page.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
