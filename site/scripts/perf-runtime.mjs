// Runtime rendering A/B harness: frame pacing + main-thread cost per scenario, with one cost centre switched off per variant.
//
//   node scripts/perf-runtime.mjs [--url http://127.0.0.1:5198/] [--vw 1440 --vh 900 --dpr 2] [--variants base,dpr1,noGlow] [--out file.json]
//
// Scenarios (second, tile-warm pass is measured): idle 2 s, zoom z5->z9.5 (3 s, linear), pan at z8 (markers + overview),
// pan at z12 Salinas (fields). Per scenario: rAF avg / p95 / max ms, % of frames > 18 ms, long tasks, and CDP
// Performance.getMetrics deltas (main-thread task / script / layout / style-recalc seconds per second).
// Use a bigger viewport (--vw 2560 --vh 1440) as a GPU stress test: the more pixels, the more a GPU-bound cost centre shows.
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const URL_ = arg('url', 'http://127.0.0.1:5198/');
const VW = Number(arg('vw', '1440'));
const VH = Number(arg('vh', '900'));
const DPR = Number(arg('dpr', '2'));
const OUT = arg('out', '');

const hide = (ids) => `(() => { const m = window.__map; for (const id of ${JSON.stringify(ids)}) if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', 'none'); })()`;
const css = (text) => `(() => { const s = document.createElement('style'); s.textContent = ${JSON.stringify(text)}; document.head.append(s); })()`;
const symbolIds = `(() => { const m = window.__map; for (const l of m.getStyle().layers) if (l.type === 'symbol') m.setLayoutProperty(l.id, 'visibility', 'none'); })()`;

const VARIANTS = {
  base: '',
  dpr1: 'window.__map.setPixelRatio(1)',
  dpr15: 'window.__map.setPixelRatio(1.5)',
  
  noOverview: hide(['overview-dots', 'fields-low-fill', 'fields-low-line']),
  noHillshadeRasters: hide(['hillshade', 'ca_sticker_shadow', 'ocean_gradient']),
  noMarkerAnim: css('.crop-marker *, .crop-marker { animation: none !important; }'),
  noBackdrop: css('* { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }'),
  noMarkerFilters: css('.crop-marker__img { filter: none !important; }'),
  noMarkers: css('.maplibregl-marker { display: none !important; }'),
  noSymbols: symbolIds,
  noFieldTexture: hide(['fields-texture']),
  noHillshade: hide(['hillshade']),
  noStickerRasters: hide(['ca_sticker_shadow', 'ocean_gradient']),
  bobConst: css(
    '@keyframes crop-bob { 0%,100% { transform: translateY(0) rotate(-1.5deg); } 50% { transform: translateY(-3px) rotate(1.5deg); } }',
  ),
};
const names = arg('variants', Object.keys(VARIANTS).join(',')).split(',');

const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN;
};
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const f1 = (n) => (Number.isFinite(n) ? n.toFixed(1) : 'n/a');

const INIT = () => {
  const p = { frames: null, long: [] };
  window.__p = p;
  new PerformanceObserver((l) => l.getEntries().forEach((e) => p.long.push(e.duration))).observe({ type: 'longtask' });
  p.start = () => {
    p.frames = [];
    p.long = [];
    let last = performance.now();
    const tick = (t) => {
      if (!p.frames) return;
      p.frames.push(t - last);
      last = t;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  p.stop = () => {
    const f = p.frames ?? [];
    p.frames = null;
    return { frames: f.slice(2), long: p.long };
  };
};

const ease = (opts) =>
  `new Promise((res) => { const m = window.__map; m.once('moveend', () => res()); m.easeTo({ ...${JSON.stringify(opts)}, easing: (t) => t }); })`;
const jump = (c) => `window.__map.jumpTo(${JSON.stringify({ pitch: 0, bearing: 0, ...c })})`;

const ALL_SCENARIOS = [
  { name: 'idle 2s', setup: jump({ center: [-120.2, 36.6], zoom: 7 }), run: 'new Promise((r) => setTimeout(r, 2000))' },
  { name: 'zoom z5->9.5', setup: jump({ center: [-120.5, 37], zoom: 5 }), run: ease({ center: [-121.2, 36.7], zoom: 9.5, duration: 2200 }) },
  { name: 'pan z8', setup: jump({ center: [-121, 36.5], zoom: 8 }), run: ease({ center: [-119.2, 37.4], duration: 2200 }) },
  { name: 'pan z12 Salinas', setup: jump({ center: [-121.65, 36.68], zoom: 12 }), run: ease({ center: [-121.37, 36.8], duration: 2200 }) },
  { name: 'zoom z9->13 fields', setup: jump({ center: [-121.0, 37.6], zoom: 9 }), run: ease({ center: [-121.03, 37.6], zoom: 13, duration: 2200 }) },
  { name: 'fly z6->8.6', setup: jump({ center: [-119.6, 37.2], zoom: 6 }), run: `new Promise((res) => { const m = window.__map; m.once('moveend', () => res()); m.flyTo({ center: [-120.6, 37.3], zoom: 8.6, duration: 1600 }); })` },
  { name: 'hover z12 fields', setup: jump({ center: [-121.62, 36.62], zoom: 12 }), run: `new Promise((res) => { const c = window.__map.getCanvas(); const r = c.getBoundingClientRect(); let i = 0; const step = () => { const x = r.left + 100 + (i % 120) * ((r.width - 200) / 120); const y = r.top + r.height / 2 + 120 * Math.sin(i / 9); c.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true })); c.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y, bubbles: true })); if (++i < 132) requestAnimationFrame(step); else res(); }; requestAnimationFrame(step); })` },
];

const wanted = arg('scenarios', ALL_SCENARIOS.map((s) => s.name).join('|')).split('|');
const SCENARIOS = ALL_SCENARIOS.filter((s) => wanted.includes(s.name));

// CHROMIUM_PATH + GL=swiftshader for headless Linux; defaults to the bundled browser on a real GPU (macOS Metal).
const GL_ARGS = process.env.GL === 'swiftshader' ? ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] : ['--use-angle=metal', '--enable-gpu'];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: [...GL_ARGS, '--ignore-gpu-blocklist'] });
const results = [];
async function runVariant(variant) {
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: DPR });
  await ctx.addInitScript(INIT);
  const page = await ctx.newPage();
  await page.goto(URL_);
  await page.waitForFunction(() => window.__app && document.querySelector('.crop-marker[data-state=shown]'), null, { timeout: 120000 });
  await page.waitForTimeout(1500);
  if (VARIANTS[variant]) await page.evaluate(VARIANTS[variant]);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  const row = { variant, scenarios: {} };
  for (const sc of SCENARIOS) {
    for (const pass of ['warm', 'measure']) {
      await page.evaluate(sc.setup);
      await page.waitForFunction(() => window.__map.areTilesLoaded() && !window.__map.isMoving(), null, { timeout: 120000 });
      await page.waitForTimeout(700);
      const m0 = await metrics();
      await page.evaluate(() => window.__p.start());
      const t0 = Date.now();
      await page.evaluate(sc.run);
      const { frames, long } = await page.evaluate(() => window.__p.stop());
      const secs = (Date.now() - t0) / 1000;
      const m1 = await metrics();
      if (pass === 'measure') {
        const d = (k) => ((m1[k] ?? 0) - (m0[k] ?? 0)) / secs;
        row.scenarios[sc.name] = {
          avg: avg(frames),
          p95: pct(frames, 0.95),
          max: Math.max(...frames),
          slowPct: (100 * frames.filter((x) => x > 18).length) / frames.length,
          long: long.length,
          taskMs: d('TaskDuration') * 1000,
          scriptMs: d('ScriptDuration') * 1000,
          layoutMs: d('LayoutDuration') * 1000,
          styleMs: d('RecalcStyleDuration') * 1000,
        };
      }
    }
  }
  await ctx.close();
  return row;
}
for (const variant of names) {
  // The dev server full-reloads when someone saves a source file mid-run; retry the variant.
  for (let attempt = 1; ; attempt++) {
    try {
      results.push(await runVariant(variant));
      console.error(`${variant} done`);
      break;
    } catch (err) {
      console.error(`${variant} attempt ${attempt} failed: ${String(err).split('\n')[0]}`);
      if (attempt >= 3) throw err;
    }
  }
}
await browser.close();

console.log(`viewport ${VW}x${VH} @${DPR}x (canvas ${VW * DPR}x${VH * DPR})\n`);
for (const sc of SCENARIOS) {
  console.log(`### ${sc.name}`);
  console.log('| variant | avg ms | p95 | max | %>18ms | long | main-thread ms/s (task / script / layout / style) |');
  console.log('|---|---|---|---|---|---|---|');
  for (const r of results) {
    const s = r.scenarios[sc.name];
    console.log(`| ${r.variant} | ${f1(s.avg)} | ${f1(s.p95)} | ${f1(s.max)} | ${f1(s.slowPct)} | ${s.long} | ${f1(s.taskMs)} / ${f1(s.scriptMs)} / ${f1(s.layoutMs)} / ${f1(s.styleMs)} |`);
  }
  console.log('');
}
if (OUT) writeFileSync(OUT, JSON.stringify(results, null, 2));
