// Usage: node scripts/shot-combined.mjs <ca|mobile|z6|z7|z11|perf> <out.png>
// URL env overrides http://localhost:5194/. Uses the real GPU (Metal) via ANGLE.
import { chromium } from 'playwright';

const [scenario, out] = process.argv.slice(2);
const url = process.env.URL ?? 'http://localhost:5194/';
const mobile = scenario === 'mobile';
const viewport = mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 };
const browser = await chromium.launch({
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, hasTouch: mobile, isMobile: mobile });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text().slice(0, 300));
});
page.on('pageerror', (e) => errors.push(`pageerror ${e.message}`));
await page.goto(url);
await page.waitForFunction(() => window.__app?.markers, null, { timeout: 90000 });

const jumps = {
  z6: { center: [-119.6, 37.6], zoom: 6, pitch: 0 },
  z7: { center: [-120.2, 36.6], zoom: 7, pitch: 0 },
  z11: { center: [-121.65, 36.68], zoom: 11, pitch: 0 },
};
if (jumps[scenario]) await page.evaluate((j) => window.__map.jumpTo(j), jumps[scenario]);

await page.waitForTimeout(1200);
await page.waitForFunction(() => window.__map.areTilesLoaded() && window.__map.isStyleLoaded(), null, { timeout: 120000 });
await page.waitForTimeout(3500);

if (scenario === 'perf') {
  // Warm pass loads every tile on the path (network, terrain decode), then the measured pass is steady-state.
  await page.evaluate(() => window.__map.jumpTo({ center: [-120.3, 36.9], zoom: 5, pitch: 0 }));
  await page.evaluate(() => new Promise((r) => { window.__map.once('moveend', r); window.__map.easeTo({ zoom: 9, duration: 3000, easing: (t) => t }); }));
  await page.waitForFunction(() => window.__map.areTilesLoaded(), null, { timeout: 120000 });
  if (process.env.MARKERS === 'off') await page.evaluate(() => window.__app.markers.destroy());
  // HIDE=layer-id,layer-id hides layers for an A/B run.
  if (process.env.HIDE) await page.evaluate((ids) => ids.forEach((id) => window.__map.setLayoutProperty(id, 'visibility', 'none')), process.env.HIDE.split(','));
  await page.evaluate(() => window.__map.jumpTo({ center: [-120.3, 36.9], zoom: 5, pitch: 0 }));
  await page.waitForTimeout(1500);
  await page.waitForFunction(() => window.__map.areTilesLoaded(), null, { timeout: 120000 });
  const frames = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const list = [];
        let last = performance.now();
        const start = last;
        const tick = (now) => {
          list.push(now - last);
          last = now;
          if (now - start < 3300) requestAnimationFrame(tick);
          else resolve(list);
        };
        window.__map.easeTo({ zoom: 9, duration: 3000, easing: (t) => t });
        requestAnimationFrame(tick);
      }),
  );
  const sorted = [...frames].sort((a, b) => a - b);
  const avg = frames.reduce((a, b) => a + b, 0) / frames.length;
  console.log(
    JSON.stringify({
      frames: frames.length,
      avgMs: +avg.toFixed(1),
      p50: +sorted[Math.floor(sorted.length * 0.5)].toFixed(1),
      p95: +sorted[Math.floor(sorted.length * 0.95)].toFixed(1),
      max: +sorted.at(-1).toFixed(1),
    }),
  );
} else {
  const info = await page.evaluate(() => ({
    z: +window.__map.getZoom().toFixed(2),
    shown: document.querySelectorAll('.crop-marker[data-state=shown][data-gate=on]').length,
    total: document.querySelectorAll('.crop-marker').length,
  }));
  console.log(JSON.stringify(info));
  await page.screenshot({ path: out });
}
console.log('console errors:', errors.length, errors);
await browser.close();
