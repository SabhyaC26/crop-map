// Screenshots of the main views (default CA, mobile, search highlights, handoff, legend).
// Usage: URL=http://127.0.0.1:5196/ node scripts/shot-main.mjs [ca|mobile|min|loading|almonds|avocados|z11|legend|all]
import { chromium } from 'playwright';

const url = process.env.URL ?? 'http://127.0.0.1:5196/';
const outDir = process.env.OUT ?? new URL('../../docs/screens/', import.meta.url).pathname;
const only = process.argv[2] ?? 'all';
const want = (name) => only === 'all' || only === name;
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const errors = [];

async function open(viewport, mobile = false) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, hasTouch: mobile, isMobile: mobile });
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(url);
  await page.waitForFunction(() => window.__app, null, { timeout: 90000 });
  await page.waitForFunction(() => document.querySelector('.crop-marker[data-state=shown]'), null, { timeout: 90000 });
  await page.waitForTimeout(1500);
  return page;
}

const settle = async (page, ms = 1800) => {
  await page.waitForFunction(() => window.__map.areTilesLoaded() && !window.__map.isMoving(), null, { timeout: 120000 });
  await page.waitForTimeout(ms);
};

const shot = async (page, name) => {
  await page.screenshot({ path: `${outDir}${name}.png` });
  console.log('saved', name, JSON.stringify(await page.evaluate(() => (window.__map ? { z: window.__map.getZoom(), c: window.__map.getCenter() } : null))));
};

async function searchCrop(page, query) {
  await page.locator('.cs-input').click();
  await page.keyboard.type(query);
  await page.waitForTimeout(500);
  await page.keyboard.press('Enter');
}

if (want('ca')) {
  const page = await open({ width: 1440, height: 1000 });
  await settle(page, 3500);
  await shot(page, 'main-ca');
  await page.context().close();
}

if (want('mobile')) {
  const page = await open({ width: 390, height: 844 }, true);
  await settle(page, 3500);
  await shot(page, 'main-ca-mobile');
  await page.context().close();
}

for (const [name, query] of [
  ['almonds', 'almond'],
  ['avocados', 'avocado'],
]) {
  if (!want(name)) continue;
  const page = await open({ width: 1440, height: 1000 });
  await searchCrop(page, query);
  await settle(page, 4000);
  await shot(page, `search-${name}`);
  if (name === 'almonds' && !process.env.NO_MOBILE) {
    const mobile = await open({ width: 390, height: 844 }, true);
    await searchCrop(mobile, query);
    await settle(mobile, 4000);
    await shot(mobile, 'search-almonds-mobile');
    await mobile.context().close();
  }
  await page.context().close();
}

if (want('z11')) {
  const page = await open({ width: 1440, height: 1000 });
  await searchCrop(page, 'almond');
  await settle(page, 3000);
  await page.locator('.dc-row', { hasText: 'Modesto' }).click();
  await page.waitForFunction(() => window.__map.isMoving(), null, { timeout: 5000 }).catch(() => undefined);
  await page.waitForFunction(() => !window.__map.isMoving(), null, { timeout: 60000 });
  await page.evaluate(() => window.__map.easeTo({ zoom: 11, duration: 700 }));
  await page.waitForTimeout(900);
  await settle(page, 3500);
  await shot(page, 'search-almonds-z11');
  await page.context().close();
}

if (want('min')) {
  const page = await open({ width: 1440, height: 1000 });
  await settle(page, 2500);
  // Ask for far more than allowed, towards the west / north: the limits clamp it.
  await page.evaluate(() => window.__map.jumpTo({ center: [-200, 80], zoom: 0.5 }));
  await settle(page, 3500);
  await shot(page, 'zoomed-out-min');
  console.log('minZoom', await page.evaluate(() => window.__map.getMinZoom()));
  await page.context().close();
}

if (want('loading')) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(url, { waitUntil: 'commit' });
  await page.waitForFunction(() => document.getElementById('boot') && getComputedStyle(document.getElementById('boot')).position === 'absolute', null, { timeout: 30000 });
  await page.waitForTimeout(Number(process.env.LOADING_DELAY ?? 450));
  console.log('map-ready yet?', await page.evaluate(() => document.documentElement.classList.contains('map-ready')));
  await shot(page, 'loading-shimmer').catch((e) => console.log(e.message));
  await ctx.close();
}

if (want('legend')) {
  const page = await open({ width: 1440, height: 900 });
  await page.evaluate(() => window.__map.jumpTo({ center: [-121.65, 36.68], zoom: 12, pitch: 0, bearing: 0 }));
  await settle(page, 2500);
  await shot(page, 'legend-salinas');
  await page.context().close();
}

console.log('console errors', errors.length, errors.slice(0, 5));
await browser.close();
