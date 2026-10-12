// Records the ~30 s feature demo as WebM (then convert with scripts/encode-demo.sh).
//   node scripts/record-demo.mjs --device laptop|mobile [--url http://127.0.0.1:5180/] [--out ../docs/demo/]
import { mkdirSync, renameSync } from 'node:fs';
import { chromium } from 'playwright';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const device = arg('device', 'laptop');
const url = arg('url', 'http://127.0.0.1:5180/');
const outDir = arg('out', new URL('../../docs/demo/', import.meta.url).pathname);
const mobile = device === 'mobile';
const viewport = mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 };

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({
  viewport,
  deviceScaleFactor: mobile ? 3 : 2,
  isMobile: mobile,
  hasTouch: mobile,
  recordVideo: { dir: outDir, size: viewport },
});

// A soft cursor (laptop) or touch dot (mobile) so viewers can follow the interaction.
await context.addInitScript((isMobile) => {
  window.addEventListener('DOMContentLoaded', () => {
    const dot = document.createElement('div');
    dot.id = 'demo-cursor';
    const size = isMobile ? 34 : 22;
    Object.assign(dot.style, {
      position: 'fixed', left: '0', top: '0', width: `${size}px`, height: `${size}px`, borderRadius: '50%',
      background: isMobile ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.9)',
      border: isMobile ? '2px solid rgba(90,80,160,0.55)' : '2px solid rgba(70,60,140,0.85)',
      boxShadow: '0 4px 14px rgba(40,30,90,0.35)', pointerEvents: 'none', zIndex: '99999',
      transform: 'translate(-200px,-200px)', transition: 'width .15s, height .15s, opacity .2s',
      opacity: isMobile ? '0' : '1',
    });
    document.body.append(dot);
    const place = (x, y) => (dot.style.transform = `translate(${x - size / 2}px, ${y - size / 2}px)`);
    window.addEventListener('pointermove', (e) => place(e.clientX, e.clientY), true);
    window.addEventListener('pointerdown', (e) => {
      place(e.clientX, e.clientY);
      dot.style.opacity = '1';
      dot.animate([{ scale: 1 }, { scale: 0.75 }, { scale: 1 }], { duration: 260 });
    }, true);
    window.addEventListener('pointerup', () => {
      if (isMobile) setTimeout(() => (dot.style.opacity = '0'), 380);
    }, true);
  });
}, mobile);

const page = await context.newPage();
const wait = (ms) => page.waitForTimeout(ms);
let pointer = { x: viewport.width * 0.7, y: viewport.height * 0.75 };
const glide = async (x, y, ms = 700) => {
  const steps = Math.max(8, Math.round(ms / 16));
  await page.mouse.move(x, y, { steps });
  pointer = { x, y };
};
const tap = async (x, y) => {
  if (mobile) await page.touchscreen.tap(x, y);
  else {
    await glide(x, y, 500);
    await page.mouse.click(x, y);
  }
};
const tapEl = async (locator) => {
  const box = await locator.boundingBox();
  if (!box) throw new Error('element not visible');
  await tap(box.x + box.width / 2, box.y + box.height / 2);
};
const camera = (fn, opts) => page.evaluate(([f, o]) => window.__map[f](o), [fn, opts]);
const settle = async (extra = 300) => {
  await page.waitForFunction(() => !window.__map.isMoving() && window.__map.areTilesLoaded(), null, { timeout: 30000 });
  await wait(extra);
};
const type = async (text) => {
  for (const ch of text) {
    await page.keyboard.type(ch);
    await wait(95);
  }
};

await page.goto(url);
await page.waitForFunction(() => window.__app?.controls, null, { timeout: 90000 });
const home = await page.evaluate(() => ({ center: window.__map.getCenter().toArray(), zoom: window.__map.getZoom() }));
await glide(pointer.x, pointer.y, 50);
await page.waitForFunction(() => document.querySelector('.crop-marker[data-state=shown]'), null, { timeout: 60000 });
await wait(1800);

// 1. Hover a region emoji, then dive into the San Joaquin Valley (markers spring apart).
if (!mobile) {
  const marker = page.locator('.crop-marker[data-state=shown] .crop-marker__img').nth(2);
  const box = await marker.boundingBox();
  if (box) {
    await glide(box.x + box.width / 2, box.y + box.height / 2, 800);
    await wait(900);
  }
}
await camera('flyTo', { center: [-120.3, 36.85], zoom: 7.9, speed: 1.1, curve: 1.2 });
await settle(1300);

// 2. Into the Salinas Valley: real fields, textures, the "What's in view" legend.
await camera('flyTo', { center: [-121.62, 36.66], zoom: 12.4, speed: 1.4, curve: 1.3 });
await settle(500);

// 3. Legend filter: strawberries only, then everything back.
const legendRow = page.locator('.lg-item', { hasText: 'Strawberries' }).first();
if (mobile) {
  const pill = page.locator('.lg-root').first();
  if (await pill.isVisible()) await tapEl(pill);
  await wait(700);
}
if (await legendRow.isVisible()) {
  await tapEl(legendRow);
  await wait(1700);
  const clear = page.locator('.lg-clear').first();
  if (await clear.isVisible()) await tapEl(clear);
  await wait(600);
}
if (mobile) {
  const close = page.locator('.lg-close').first();
  if (await close.isVisible()) await tapEl(close);
  await wait(400);
}

// 4. Tap a field: the popup card / bottom sheet.
const hit = await page.evaluate(() => {
  const { clientWidth: w, clientHeight: h } = window.__map.getContainer();
  for (let r = 0; r < 260; r += 24) {
    for (const [dx, dy] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r]]) {
      const p = [w / 2 + dx, h * 0.45 + dy];
      if (window.__app.fields.queryAt(p)) return p;
    }
  }
  return [w / 2, h / 2];
});
await tap(hit[0], hit[1]);
await wait(2000);
await page.keyboard.press('Escape');
await wait(500);

// 5. Back out to California, then search: the crop lights up statewide and the rest of the map goes quiet.
await camera('flyTo', { center: home.center, zoom: home.zoom, speed: 1.6, curve: 1.4 });
await settle(500);
await tapEl(page.locator('.cs-input'));
await wait(250);
await type('almond');
await wait(350);
await page.keyboard.press('Enter');
await wait(2600);

// 6. Jump to a destination from "Where it grows".
const dest = page.locator('.dc-row').nth(1);
if (await dest.isVisible()) {
  await tapEl(dest);
  await wait(2300);
}

// 7. Clear and land back on the bobbing emoji overview.
await tapEl(page.locator('.cs-chip-clear'));
await camera('flyTo', { center: home.center, zoom: home.zoom, speed: 1.6, curve: 1.4 });
await wait(2600);
if (!mobile) await glide(viewport.width * 0.78, viewport.height * 0.8, 600);
await wait(400);

const video = page.video();
await context.close();
await browser.close();
const raw = await video.path();
const target = `${outDir}demo-${device}.webm`;
renameSync(raw, target);
console.log(target);
