// Marker screenshots + split contact sheet + perf. Usage: URL=http://localhost:5174/ node scripts/shot-markers.mjs [ca|fine|hover|split|perf|all]
import { chromium } from 'playwright';

const url = process.env.URL ?? 'http://localhost:5173/';
const which = process.argv[2] ?? 'all';
const out = new URL('../../docs/screens/', import.meta.url).pathname;
const want = (n) => which === 'all' || which === n;

const angle = process.env.ANGLE ?? 'swiftshader';
const browser = await chromium.launch({
  args: ['--use-gl=angle', `--use-angle=${angle}`, '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const errors = [];

async function open(viewport = { width: 1440, height: 900 }) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 2 });
  // Lets the split scenario freeze marker animations the instant they are created.
  await page.addInitScript(() => {
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      const a = animate.apply(this, args);
      if (window.__freeze && this.classList.contains('crop-marker__fx')) a.pause();
      return a;
    };
  });
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 200));
  });
  page.on('pageerror', (e) => errors.push(`pageerror ${e.message}`));
  await page.goto(url);
  await page.waitForFunction(() => window.__app?.markers, null, { timeout: 90000 });
  return page;
}

const settle = async (page, ms = 2500) => {
  await page.waitForTimeout(600);
  await page.waitForFunction(() => window.__map.areTilesLoaded(), null, { timeout: 120000 });
  await page.waitForTimeout(ms);
};

if (want('ca')) {
  const page = await open();
  await page.waitForFunction(() => window.__map.loaded(), null, { timeout: 90000 });
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${out}markers-ca.png` });
  console.log(await page.evaluate(() => JSON.stringify({ z: window.__map.getZoom(), shown: document.querySelectorAll('.crop-marker[data-state=shown][data-gate=on]').length })));
  await page.close();
}

if (want('fine')) {
  const page = await open();
  await page.evaluate(() => window.__map.jumpTo({ center: [-120.3, 36.9], zoom: 8.3 }));
  await settle(page, 3000);
  await page.screenshot({ path: `${out}markers-fine.png` });
  await page.close();
}

if (want('hover')) {
  const page = await open();
  await page.evaluate(() => window.__map.jumpTo({ center: [-120.3, 36.9], zoom: 8.3 }));
  await settle(page, 3000);
  const pt = await page.evaluate(() => {
    const el = document.querySelector('.crop-marker[data-level=fine][aria-label*="Salinas Valley"] .crop-marker__img');
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.move(pt.x + 40, pt.y + 140);
  await page.mouse.move(pt.x, pt.y, { steps: 6 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}markers-hover.png` });
  await page.close();
}

if (want('split')) {
  const page = await open({ width: 1100, height: 760 });
  await page.evaluate(() => window.__map.jumpTo({ center: [-120.3, 36.9], zoom: 7.2 }));
  await settle(page, 2500);
  const times = [0, 100, 200, 350, 500, 700];
  const shots = [];
  await page.waitForFunction(() => document.querySelector('.crop-marker[data-level=coarse][data-state=shown]'), null, { timeout: 90000 });
  await page.waitForFunction(() => !document.getAnimations().some((a) => a.effect?.target?.classList?.contains('crop-marker__fx')), null, { timeout: 90000 });
  // Software GL screenshots take seconds, so freeze the marker animations and seek them deterministically.
  await page.evaluate(() => {
    window.__freeze = true;
    window.__map.jumpTo({ center: [-120.3, 36.9], zoom: 7.5 });
  });
  await page.waitForFunction(() => document.querySelector('.crop-marker[data-level=fine][data-state=shown]'), null, { timeout: 60000 });
  for (const t of times) {
    await page.evaluate((t) => {
      for (const a of document.getAnimations()) if (a.effect?.target?.classList?.contains('crop-marker__fx')) a.currentTime = t;
    }, t);
    await page.waitForTimeout(250);
    shots.push({ t, buf: await page.screenshot({ type: 'jpeg', quality: 88, scale: 'css' }) });
  }
    // Compose the contact sheet in the page itself.
  const sheet = await browser.newPage({ viewport: { width: 1500, height: 700 } });
  const html = `<body style="margin:0;background:#222;display:grid;grid-template-columns:repeat(3,1fr);gap:6px;padding:6px">${shots
    .map((s, i) => `<figure style="margin:0;position:relative"><img style="width:100%;display:block" src="data:image/jpeg;base64,${s.buf.toString('base64')}"><figcaption style="position:absolute;left:8px;top:8px;background:#000a;color:#fff;font:700 15px system-ui;padding:3px 9px;border-radius:9px">+${times[i]}ms</figcaption></figure>`)
    .join('')}</body>`;
  await sheet.setContent(html);
  await sheet.waitForTimeout(400);
  const h = await sheet.evaluate(() => document.body.scrollHeight);
  await sheet.setViewportSize({ width: 1500, height: h });
  await sheet.screenshot({ path: `${out}markers-split-frames.png` });
  await sheet.close();
  await page.close();
}

if (want('perf')) {
  // ANGLE=metal uses the real GPU when headless allows it; MARKERS=off destroys the markers for an A/B run.
  const page = await open({ width: 1280, height: 800 });
  if (process.env.MARKERS === 'off') await page.evaluate(() => window.__app.markers.destroy());
  await page.evaluate(() => window.__map.jumpTo({ center: [-120.3, 36.9], zoom: 5.5 }));
  await settle(page, 1500);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const metric = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  const before = await metric();
  const result = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const map = window.__map;
        const frames = [];
        const slow = (window.__slow = []);
        let last = performance.now();
        const start = last;
        const tick = (now) => {
          frames.push(now - last);
          if (now - last > 40) slow.push([+(now - last).toFixed(0), +map.getZoom().toFixed(2)]);
          last = now;
          if (now - start < 3300) requestAnimationFrame(tick);
          else resolve(frames);
        };
        map.easeTo({ zoom: 9, duration: 3000, easing: (t) => t });
        requestAnimationFrame(tick);
      }),
  );
  const after = await metric();
  console.log('slow frames [ms, zoom]:', JSON.stringify(await page.evaluate(() => window.__slow)));
  const sorted = [...result].sort((a, b) => a - b);
  const avg = result.reduce((a, b) => a + b, 0) / result.length;
  const per = (k) => +(((after[k] - before[k]) * 1000) / result.length).toFixed(2);
  console.log(
    JSON.stringify({
      angle,
      markers: process.env.MARKERS ?? 'on',
      frames: result.length,
      avgMs: +avg.toFixed(1),
      p50: +sorted[Math.floor(sorted.length * 0.5)].toFixed(1),
      p95: +sorted[Math.floor(sorted.length * 0.95)].toFixed(1),
      max: +sorted.at(-1).toFixed(1),
      scriptMsPerFrame: per('ScriptDuration'),
      layoutMsPerFrame: per('LayoutDuration'),
      styleMsPerFrame: per('RecalcStyleDuration'),
      taskMsPerFrame: per('TaskDuration'),
    }),
  );
  await page.close();
}

console.log('console errors:', errors.length, errors);
await browser.close();
