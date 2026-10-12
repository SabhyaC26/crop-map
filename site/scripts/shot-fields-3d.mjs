// Usage: node scripts/shot-fields-3d.mjs <scenario> [out.png]
// scenarios: salinas-flat | orchards-flat | salinas-3d | orchards-3d | vineyards-3d | perf
// Env: URL (default http://127.0.0.1:5197/), CENTER=lng,lat, ZOOM, PITCH, HIDE_3D=1, HIDE_UI=1, DPR (default 2)
import { chromium } from 'playwright';

const SCENARIOS = {
  'salinas-flat': { center: [-121.62, 36.66], zoom: 13.2, pitch: 0, bearing: 0, terrain: false, hide3d: true },
  'orchards-flat': { center: [-120.8, 37.58], zoom: 13.2, pitch: 0, bearing: 0, terrain: false, hide3d: true },
  'salinas-3d': { center: [-121.62, 36.66], zoom: 13.6, pitch: 55, bearing: -20, terrain: true },
  'orchards-3d': { center: [-120.8, 37.58], zoom: 13.6, pitch: 55, bearing: -20, terrain: true },
  'vineyards-3d': { center: [-122.36, 38.42], zoom: 13.4, pitch: 58, bearing: -25, terrain: true },
  perf: { center: [-121.62, 36.66], zoom: 13.6, pitch: 55, bearing: -20, terrain: true },
};

const [name, outArg] = process.argv.slice(2);
const scenario = SCENARIOS[name];
if (!scenario) throw new Error(`unknown scenario ${name}; use ${Object.keys(SCENARIOS).join(' | ')}`);
const url = process.env.URL ?? 'http://127.0.0.1:5197/';
const out = outArg ?? `/tmp/fields-${name}.png`;
const center = process.env.CENTER ? process.env.CENTER.split(',').map(Number) : scenario.center;
const zoom = process.env.ZOOM ? Number(process.env.ZOOM) : scenario.zoom;
const pitch = process.env.PITCH ? Number(process.env.PITCH) : scenario.pitch;

const browser = await chromium.launch({
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: Number(process.env.DPR ?? 2),
});
const page = await ctx.newPage();
const problems = [];
page.on('console', (m) => {
  const text = m.text();
  if (text.includes('READ-usage buffer')) return;
  if (m.type() === 'error' || m.type() === 'warning') problems.push(`[console.${m.type()}] ${text.slice(0, 300)}`);
});
page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));

await page.goto(url);
await page.waitForFunction(() => window.__app, null, { timeout: 90000 });

if (scenario.terrain) {
  await page.evaluate(async () => {
    const { enableDioramaCamera } = await import('/src/lib/terrain.ts');
    enableDioramaCamera(window.__app.map);
  });
}
if (scenario.hide3d || process.env.HIDE_3D) {
  await page.evaluate(() => window.__app.map.setLayoutProperty('fields-3d', 'visibility', 'none'));
}
if (process.env.HIDE_UI) {
  await page.addStyleTag({ content: '#legend-slot, #search-slot, .maplibregl-ctrl { display: none !important }' });
}

await page.evaluate(
  ([center, zoom, pitch, bearing]) => window.__app.map.jumpTo({ center, zoom, pitch, bearing }),
  [center, zoom, pitch, scenario.bearing],
);
await page.waitForTimeout(1000);
await page.waitForFunction(() => window.__app.map.areTilesLoaded(), null, { timeout: 120000 });
await page.waitForTimeout(2500);

if (name === 'perf') {
  const result = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const map = window.__app.map;
        const start = map.getCenter();
        const frames = [];
        let last = performance.now();
        const t0 = last;
        const DURATION = 3000;
        const tick = (now) => {
          frames.push(now - last);
          last = now;
          const p = Math.min(1, (now - t0) / DURATION);
          map.jumpTo({
            center: [start.lng + 0.02 * Math.sin(p * Math.PI), start.lat + 0.012 * p],
            bearing: -20 + 50 * p,
            pitch: 55,
            zoom: 13.6,
          });
          if (p < 1) requestAnimationFrame(tick);
          else {
            frames.shift();
            const avg = frames.reduce((a, b) => a + b, 0) / frames.length;
            const sorted = [...frames].sort((a, b) => a - b);
            resolve({ frames: frames.length, avgMs: avg, p95Ms: sorted[Math.floor(sorted.length * 0.95)], maxMs: sorted.at(-1) });
          }
        };
        requestAnimationFrame(tick);
      }),
  );
  console.log('perf', JSON.stringify(result));
} else {
  await page.screenshot({ path: out });
  console.log('saved', out);
}
const unique = [...new Set(problems)];
console.log(unique.length ? unique.join('\n') : 'no console errors/warnings');
await browser.close();
