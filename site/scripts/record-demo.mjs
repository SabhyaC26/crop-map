// Records the ~15 s feature demo: overview -> one continuous flight into Salinas -> legend filter -> field popup
// -> almond search finale. The route is played once to warm every tile, then captured frame-by-frame over CDP.
//   node scripts/record-demo.mjs --device laptop|mobile [--url http://127.0.0.1:5180/]
//   then: scripts/encode-demo.sh laptop|mobile  (MP4 only)
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const device = arg('device', 'laptop');
const url = arg('url', 'http://127.0.0.1:5180/');
const mobile = device === 'mobile';
// Laptop is framed 4:5 (still the desktop layout) so the legend and popup stay readable in a phone feed.
const viewport = mobile ? { width: 390, height: 844 } : { width: 960, height: 1200 };
const scale = Number(arg("scale", "1.5"));
const framesDir = `/tmp/demo-frames-${device}`;

const SALINAS = { center: [-121.64, 36.68], zoom: 12.3 };
const FLIGHT_MS = 3600;

rmSync(framesDir, { recursive: true, force: true });
mkdirSync(framesDir, { recursive: true });

// The CDP screencast only returns device-pixel frames when Chrome itself runs at the scale factor.
const browser = await chromium.launch({
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', `--force-device-scale-factor=${scale}`],
});
const context = await browser.newContext({ viewport, deviceScaleFactor: scale, isMobile: mobile, hasTouch: mobile });

// Mobile shows a soft touch dot on each tap; the laptop cut shows no pointer.
await context.addInitScript((isMobile) => {
  if (!isMobile) return;
  window.addEventListener('DOMContentLoaded', () => {
    const dot = document.createElement('div');
    const size = 34;
    Object.assign(dot.style, {
      position: 'fixed', left: '0', top: '0', width: `${size}px`, height: `${size}px`, borderRadius: '50%',
      background: 'rgba(255,255,255,0.55)', border: '2px solid rgba(90,80,160,0.55)',
      boxShadow: '0 4px 14px rgba(40,30,90,0.35)', pointerEvents: 'none', zIndex: '99999', opacity: '0',
      transition: 'opacity .25s',
    });
    document.body.append(dot);
    window.addEventListener('pointerdown', (e) => {
      dot.style.transform = `translate(${e.clientX - size / 2}px, ${e.clientY - size / 2}px)`;
      dot.style.opacity = '1';
      dot.animate([{ scale: 1 }, { scale: 0.75 }, { scale: 1 }], { duration: 260 });
    }, true);
    window.addEventListener('pointerup', () => setTimeout(() => (dot.style.opacity = '0'), 380), true);
  });
}, mobile);

const page = await context.newPage();
const wait = (ms) => page.waitForTimeout(ms);
const idle = () =>
  page.waitForFunction(() => !window.__map.isMoving() && window.__map.areTilesLoaded(), null, { timeout: 60000 });

const tap = async (x, y) => {
  if (mobile) await page.touchscreen.tap(x, y);
  else {
    await page.mouse.move(x, y, { steps: 24 });
    await page.mouse.click(x, y);
  }
};
const tapEl = async (locator) => {
  const box = await locator.boundingBox();
  if (!box) return false;
  await tap(box.x + box.width / 2, box.y + box.height / 2);
  return true;
};
const fly = (target, duration) =>
  page.evaluate(([t, d]) => new Promise((resolve) => {
    window.__map.once('moveend', () => resolve());
    window.__map.flyTo({ ...t, duration: d, curve: 1.42, essential: true });
  }), [target, duration]);

await page.goto(url);
await page.waitForFunction(() => window.__app?.controls && document.querySelector('.crop-marker[data-state=shown]'), null, { timeout: 90000 });
await idle();
const home = await page.evaluate(() => ({ center: window.__map.getCenter().toArray(), zoom: window.__map.getZoom() }));
const park = mobile ? null : { x: viewport.width - 4, y: 4 };
if (park) await page.mouse.move(park.x, park.y);

const reset = async () => {
  await page.keyboard.press('Escape');
  const chip = page.locator('.cs-chip-clear');
  if (await chip.isVisible()) await chip.click();
  await page.evaluate((h) => window.__map.jumpTo(h), home);
  if (park) await page.mouse.move(park.x, park.y);
  await wait(600);
  await idle();
  await wait(1500);
};

const fieldPoint = () =>
  page.evaluate(() => {
    const { clientWidth: w, clientHeight: h } = window.__map.getContainer();
    for (let r = 0; r < 300; r += 20) {
      for (const [dx, dy] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, r]]) {
        const p = [w / 2 + dx, h * 0.6 + dy];
        const hit = window.__app.fields.queryAt(p);
        if (hit && hit.cropId === 15) return p;
      }
    }
    return [w / 2, h * 0.6];
  });

const take = async () => {
  await wait(900);
  // One continuous flight from the statewide emoji view down the valley into Salinas (markers split on the way).
  await fly(SALINAS, FLIGHT_MS);
  await wait(500);

  // Legend: strawberries only, then everything back.
  if (mobile) {
    await tapEl(page.locator('.lg-root').first());
    await wait(500);
  }
  if (await tapEl(page.locator('.lg-item', { hasText: 'Strawberries' }).first())) {
    await wait(1500);
    await tapEl(page.locator('.lg-clear').first());
    await wait(450);
  }
  if (mobile) {
    await tapEl(page.locator('.lg-close').first());
    await wait(300);
  }

  // A lettuce field: popup card (bottom sheet on mobile).
  const [x, y] = await fieldPoint();
  await tap(x, y);
  await wait(2100);
  await page.keyboard.press('Escape');
  await wait(300);

  // Finale: search almonds -> the camera glides out and the almond belt lights up statewide.
  await tapEl(page.locator('.cs-input'));
  if (park) await page.mouse.move(park.x, park.y, { steps: 10 });
  for (const ch of 'almond') {
    await page.keyboard.type(ch);
    await wait(70);
  }
  await wait(250);
  await page.keyboard.press('Enter');
  await wait(2900);
};

// Warm-up pass: loads every tile, glyph and icon along the route so the captured take never pops in.
await take();
await reset();

const cdp = await context.newCDPSession(page);
const frames = [];
cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
  frames.push({ data, t: metadata.timestamp });
  void cdp.send('Page.screencastFrameAck', { sessionId });
});
await cdp.send('Page.startScreencast', {
  format: 'jpeg',
  quality: Number(arg("quality", "90")),
  maxWidth: Math.round(viewport.width * scale),
  maxHeight: Math.round(viewport.height * scale),
  everyNthFrame: 1,
});
await take();
await cdp.send('Page.stopScreencast');
await browser.close();

// ffmpeg concat list with each frame's real on-screen duration (screencast frames arrive only on change).
const lines = [];
frames.forEach((f, i) => {
  const name = `${framesDir}/${String(i).padStart(5, '0')}.jpg`;
  writeFileSync(name, Buffer.from(f.data, 'base64'));
  const next = frames[i + 1];
  lines.push(`file '${name}'`, `duration ${(next ? next.t - f.t : 0.5).toFixed(4)}`);
});
lines.push(`file '${framesDir}/${String(frames.length - 1).padStart(5, '0')}.jpg'`);
writeFileSync(`${framesDir}/list.txt`, lines.join('\n'));
const span = frames.length ? frames[frames.length - 1].t - frames[0].t : 0;
console.log(`${frames.length} frames over ${span.toFixed(1)} s -> ${framesDir}/list.txt`);
