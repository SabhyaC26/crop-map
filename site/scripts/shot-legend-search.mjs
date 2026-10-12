// Screenshots + checks for the legend and multi-destination search. Needs a dev server: URL=http://127.0.0.1:5195/
import { chromium } from 'playwright';

const url = process.env.URL ?? 'http://127.0.0.1:5195/';
const outDir = new URL('../../docs/screens/', import.meta.url).pathname;
const only = process.argv[2];
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const errors = [];

async function open(viewport, mobile = false) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, hasTouch: mobile, isMobile: mobile });
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(url);
  await page.waitForFunction(() => window.__app, null, { timeout: 90000 });
  await page.waitForTimeout(1500);
  return page;
}

const settle = async (page, ms = 1800) => {
  await page.waitForFunction(() => window.__map.areTilesLoaded() && !window.__map.isMoving(), null, { timeout: 120000 });
  await page.waitForTimeout(ms);
};

const jump = async (page, center, zoom) => {
  await page.evaluate(([c, z]) => window.__map.jumpTo({ center: c, zoom: z, pitch: 0, bearing: 0 }), [center, zoom]);
  await settle(page, 2200);
};

const shot = (page, name) => page.screenshot({ path: `${outDir}${name}.png` });

async function searchCrop(page, query) {
  await page.locator('.cs-input').click();
  await page.keyboard.type(query);
  await page.waitForTimeout(500);
  await page.keyboard.press('Enter');
}

const rowFor = (page, name) => page.locator('.lg-row', { has: page.locator('.lg-name', { hasText: new RegExp(`^${name}$`) }) });

if (!only || only === 'desktop') {
  const page = await open({ width: 1440, height: 900 });
  await jump(page, [-121.65, 36.68], 12);
  console.log('legend rows', await page.locator('.lg-row').count(), 'visible', await page.locator('.lg-root').getAttribute('data-visible'));
  await shot(page, 'legend-salinas');

  await rowFor(page, 'Strawberries').click();
  await page.mouse.move(700, 800);
  await page.waitForTimeout(1500);
  console.log('pressed', await page.locator('.lg-row[aria-pressed="true"]').count());
  await shot(page, 'legend-filter');
  await page.screenshot({ path: '/tmp/legend-detail.png', clip: { x: 0, y: 0, width: 330, height: 420 } });

  await rowFor(page, 'Lettuce & greens').click({ modifiers: ['Shift'] }).catch((e) => console.log('lettuce click', e.message.slice(0, 80)));
  await page.mouse.move(700, 800);
  await page.waitForTimeout(900);
  console.log('after multi', await page.locator('.lg-row[aria-pressed="true"]').count());
  await shot(page, 'legend-multi');
  await page.locator('.lg-clear').click();
  await page.waitForTimeout(500);
  console.log('cleared', await page.locator('.lg-row[aria-pressed="true"]').count());
  await page.context().close();
}

if (!only || only === 'search') {
  const page = await open({ width: 1440, height: 900 });
  await searchCrop(page, 'avocado');
  await settle(page, 3200);
  console.log('places', await page.locator('.dc-row').count());
  await shot(page, 'search-places');
  await page.screenshot({ path: '/tmp/places-detail.png', clip: { x: 340, y: 0, width: 760, height: 520 } });
  await page.locator('.dc-row').nth(1).click();
  await settle(page, 3200);
  await shot(page, 'search-place-flown');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(400);
  console.log('active after →', await page.locator('.dc-row.is-active .dc-rank').textContent());
  await settle(page, 1200);
  console.log('legend visible', await page.locator('.lg-root').getAttribute('data-visible'), 'pressed', await page.locator('.lg-row[aria-pressed="true"]').allTextContents());
  await page.locator('.cs-chip-clear').click();
  await page.waitForTimeout(600);
  console.log('after clear: card', await page.locator('.dc').count());
  await page.context().close();
}

if (!only || only === 'mobile') {
  const page = await open({ width: 390, height: 844 }, true);
  await jump(page, [-121.65, 36.68], 12);
  await shot(page, 'legend-mobile-pill');
  await page.locator('.lg-pill').tap();
  await page.waitForTimeout(900);
  await shot(page, 'legend-mobile');
  await page.locator('.lg-close').tap();
  await page.waitForTimeout(500);
  await page.context().close();

  const p2 = await open({ width: 390, height: 844 }, true);
  await p2.locator('.cs-input').tap();
  await p2.keyboard.type('avocado');
  await p2.waitForTimeout(500);
  await p2.keyboard.press('Enter');
  await settle(p2, 3200);
  await shot(p2, 'search-places-mobile');
  await p2.locator('.dc-nav').nth(1).tap();
  await settle(p2, 3000);
  await shot(p2, 'search-places-mobile-2');
  console.log('mobile count', await p2.locator('.dc-count').textContent());
  await p2.context().close();
}

console.log('console errors:', errors.length, errors.slice(0, 5));
await browser.close();
