// Usage: node scripts/shot-controls.mjs [search-open|search-selected|month|mobile|all]   (needs a dev server; URL env)
import { chromium } from 'playwright';

const which = process.argv[2] ?? 'all';
const base = process.env.URL ?? 'http://localhost:5188/dev-controls.html';
const outDir = process.env.OUT ?? '../docs/screens';
const wants = (name) => which === 'all' || which === name;

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const problems = [];

async function open(viewport, mobile) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: mobile ? 3 : 2, hasTouch: mobile, isMobile: mobile });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`[console.error] ${m.text().slice(0, 300)}`);
  });
  page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
  page.on('requestfailed', (r) => {
    if (r.failure()?.errorText !== 'net::ERR_ABORTED') problems.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`);
  });
  await page.goto(base);
  await page.waitForFunction(() => window.__controls, null, { timeout: 60000 });
  return page;
}

const settle = async (page, extra = 1800) => {
  await page.waitForTimeout(700);
  await page.waitForFunction(() => window.__map.areTilesLoaded() && window.__map.isStyleLoaded(), null, { timeout: 120000 });
  await page.waitForTimeout(extra);
};

const jump = (page, c, z) => page.evaluate(([c, z]) => window.__map.jumpTo({ center: c, zoom: z, pitch: 0 }), [c, z]);

if (wants('search-open') || wants('search-selected')) {
  const page = await open({ width: 1440, height: 900 }, false);
  await settle(page, 2500);
  await page.click('.cs-input');
  await page.keyboard.type('avo', { delay: 90 });
  await page.waitForTimeout(1800);
  if (wants('search-open')) await page.screenshot({ path: `${outDir}/search-open.png` });
  if (wants('search-selected')) {
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !window.__map.isMoving(), null, { timeout: 60000 });
    await settle(page, 2500);
    await page.screenshot({ path: `${outDir}/search-selected.png` });
    await page.screenshot({ path: '/tmp/chip.png', clip: { x: 470, y: 0, width: 500, height: 100 } });
    console.log('selected chip text:', await page.textContent('.cs-chip-name'));
  }
  await page.context().close();
}

if (wants('month')) {
  const page = await open({ width: 1440, height: 900 }, false);
  await jump(page, [-120.0, 36.6], 10);
  await settle(page, 500);
  const box = await page.locator('.cm-cols').boundingBox();
  await page.mouse.click(box.x + (box.width / 12) * 9.5, box.y + box.height / 2);
  await settle(page, 2200);
  await page.screenshot({ path: `${outDir}/month-october.png` });
  console.log('aria-valuetext:', await page.getAttribute('.cm-track', 'aria-valuetext'));
  await page.context().close();
}

if (wants('mobile')) {
  const page = await open({ width: 390, height: 844 }, true);
  await jump(page, [-120.0, 36.6], 10);
  await page.waitForTimeout(1500);
  await page.tap('.cs-input');
  await page.keyboard.type('gr', { delay: 90 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${outDir}/controls-mobile-search.png` });
  await page.keyboard.press('Escape');
  await page.evaluate(() => document.activeElement?.blur());
  const box = await page.locator('.cm-cols').boundingBox();
  await page.touchscreen.tap(box.x + (box.width / 12) * 3.5, box.y + box.height / 2);
  await settle(page, 2000);
  await page.screenshot({ path: `${outDir}/controls-mobile.png` });
  await page.context().close();
}

await browser.close();
if (problems.length) {
  console.log('PROBLEMS:\n' + problems.join('\n'));
  process.exitCode = 1;
} else console.log('no console errors');
