// Bottleneck finder (diagnostic, not a benchmark): style stats, per-layer render-cost ablation, main-thread CPU profile.
//
//   node scripts/perf-inspect.mjs [--url http://127.0.0.1:5199/] [--only stats|ablate|profile] [--out ../docs/perf-inspect.json]
//
// Per-layer cost: for several camera views we time N synchronous `map.redraw()` + `gl.readPixels` round trips
// (CPU + GPU, not capped by vsync) with every layer visible, then again with each layer hidden in turn; the
// difference is that layer's cost per frame. Uses MapLibre internals (map.painter.context.gl) - diagnostics only.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { chromium } from 'playwright';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const URL_ = arg('url', 'http://127.0.0.1:5199/');
const ONLY = arg('only', 'all');
const OUT = arg('out', new URL('../../docs/perf-inspect.json', import.meta.url).pathname);
const want = (n) => ONLY === 'all' || ONLY === n;

const VIEWS = [
  { name: 'whole CA (z4.6)', camera: { center: [-119.5, 37.2], zoom: 4.6, pitch: 0, bearing: 0 } },
  { name: 'z7 Central Valley', camera: { center: [-120.2, 36.6], zoom: 7, pitch: 0, bearing: 0 } },
  { name: 'z10 Salinas', camera: { center: [-121.6, 36.65], zoom: 10, pitch: 0, bearing: 0 } },
  { name: 'z12 Salinas', camera: { center: [-121.65, 36.68], zoom: 12, pitch: 0, bearing: 0 } },
  { name: 'z13 pitch 55', camera: { center: [-121.62, 36.62], zoom: 13, pitch: 55, bearing: 40 } },
];

const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await context.newPage();
await page.goto(URL_);
await page.waitForFunction(() => window.__app && document.querySelector('.crop-marker[data-state=shown]'), null, { timeout: 120000 });
await page.waitForTimeout(1500);

const settle = async (ms = 1200) => {
  await page.waitForFunction(() => window.__map.areTilesLoaded() && !window.__map.isMoving(), null, { timeout: 120000 });
  await page.waitForTimeout(ms);
};

const result = {};

if (want('stats')) {
  result.stats = await page.evaluate(() => {
    const m = window.__map;
    const style = m.getStyle();
    const layerTypes = {};
    for (const l of style.layers) layerTypes[l.type] = (layerTypes[l.type] ?? 0) + 1;
    const blurLayers = style.layers
      .filter((l) => l.paint && Object.keys(l.paint).some((k) => /blur/.test(k) && l.paint[k] !== 0))
      .map((l) => ({ id: l.id, type: l.type, props: Object.keys(l.paint).filter((k) => /blur/.test(k)) }));
    const sources = Object.fromEntries(Object.entries(style.sources).map(([k, v]) => [k, v.type]));
    const symbolLayers = style.layers.filter((l) => l.type === 'symbol').length;
    return {
      layers: style.layers.length,
      layerTypes,
      sources,
      sourceCount: Object.keys(sources).length,
      blurLayers,
      symbolLayers,
      markerElements: document.querySelectorAll('.maplibregl-marker').length,
      domNodes: document.getElementsByTagName('*').length,
      images: m.listImages().length,
      pixelRatio: window.devicePixelRatio,
      canvas: [m.getCanvas().width, m.getCanvas().height],
    };
  });
  console.log('STATS', JSON.stringify(result.stats, null, 1));
}

if (want('ablate')) {
  result.ablate = [];
  for (const view of VIEWS) {
    await page.evaluate((c) => window.__map.jumpTo(c), view.camera);
    await settle();
    const data = await page.evaluate(() => {
      const m = window.__map;
      const gl = m.painter.context.gl;
      const px = new Uint8Array(4);
      const frame = () => {
        const t = performance.now();
        m.redraw();
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        return performance.now() - t;
      };
      const mean = (n) => {
        let sum = 0;
        for (let i = 0; i < n; i++) sum += frame();
        return sum / n;
      };
      // Hiding via layout visibility re-parses tiles; zero opacity is a paint-only change and the layer is skipped.
      const OPACITY = {
        fill: ['fill-opacity'],
        line: ['line-opacity'],
        circle: ['circle-opacity', 'circle-stroke-opacity'],
        raster: ['raster-opacity'],
        'fill-extrusion': ['fill-extrusion-opacity'],
        'color-relief': ['color-relief-opacity'],
        symbol: ['icon-opacity', 'text-opacity'],
      };
      const GROUPS = [
        ['overview glow (blurred circles)', (l) => l.id === 'overview-glow' || l.id === 'overview-hl-glow'],
        ['overview dots', (l) => l.id === 'overview-dots' || l.id === 'overview-hl-dots'],
        ['field fill+texture+outline', (l) => ['fields-fill', 'fields-texture', 'fields-outline'].includes(l.id)],
        ['field extrusion', (l) => l.type === 'fill-extrusion'],
        ['field glow/selected lines', (l) => /^fields-(glow|selected)/.test(l.id)],
        ['field icons', (l) => l.id === 'field-icons'],
        ['basemap land fills (landuse/landcover/earth)', (l) => l.type === 'fill' && /^(landuse|landcover|earth)/.test(l.id)],
        ['basemap water + shore glow', (l) => /^(water|ocean)/.test(l.id) && l.type !== 'symbol'],
        ['roads (all)', (l) => l.type === 'line' && /^roads_/.test(l.id)],
        ['boundaries', (l) => /^boundaries/.test(l.id)],
        ['storybook decor (story_*)', (l) => /^story_/.test(l.id)],
        ['all symbol labels (basemap + story)', (l) => l.type === 'symbol' && !/^field/.test(l.id)],
        ['sticker/ocean rasters + veil', (l) => /^(ca_sticker|ocean_gradient|outside_ca)/.test(l.id)],
      ];
      const z = m.getZoom();
      const layers = m.getStyle().layers.filter((l) => l.layout?.visibility !== 'none' && (l.minzoom ?? 0) <= z && (l.maxzoom ?? 24) >= z);
      const hide = (members) =>
        members.map((l) => ({
          id: l.id,
          saved: (OPACITY[l.type] ?? []).map((k) => [k, m.getPaintProperty(l.id, k)]),
        }));
      const apply = (saved, off) => {
        for (const { id, saved: props } of saved) for (const [k, v] of props) m.setPaintProperty(id, k, off ? 0 : v);
      };
      mean(60); // GPU clock ramp
      const full = mean(20);
      const rows = [];
      for (const [name, pred] of GROUPS) {
        const members = layers.filter(pred);
        if (!members.length) continue;
        const saved = hide(members);
        let on = 0;
        let off = 0;
        const rounds = 5;
        for (let r = 0; r < rounds; r++) {
          apply(saved, false);
          mean(2);
          on += mean(8);
          apply(saved, true);
          mean(2);
          off += mean(8);
        }
        apply(saved, false);
        mean(2);
        rows.push({ id: name, type: `${members.length} layers`, saved: (on - off) / rounds });
      }
      rows.sort((a, b) => b.saved - a.saved);
      return { base: full, rows };
    });
    result.ablate.push({ view: view.name, ...data });
    console.log(`\nABLATE ${view.name}: full frame ${data.base.toFixed(1)} ms`);
    for (const r of data.rows) console.log(`  ${r.saved.toFixed(2).padStart(7)} ms  ${r.type.padEnd(12)} ${r.id}`);
  }
}

if (want('profile')) {
  const client = await context.newCDPSession(page);
  await client.send('Profiler.enable');
  await client.send('Profiler.setSamplingInterval', { interval: 500 });
  const profileScenario = async (name, camera, animate) => {
    await page.evaluate((c) => window.__map.jumpTo(c), camera);
    await settle(800);
    await client.send('Profiler.start');
    await page.evaluate(animate);
    const { profile } = await client.send('Profiler.stop');
    const self = new Map();
    const byId = new Map(profile.nodes.map((n) => [n.id, n]));
    const dt = profile.timeDeltas;
    profile.samples.forEach((id, i) => {
      const n = byId.get(id);
      const cf = n.callFrame;
      const key = `${cf.functionName || '(anon)'} ${cf.url.split('/').slice(-1)[0]}:${cf.lineNumber}`;
      self.set(key, (self.get(key) ?? 0) + (dt[i] ?? 0) / 1000);
    });
    const total = [...self.values()].reduce((a, b) => a + b, 0);
    const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18);
    console.log(`\nPROFILE ${name}: ${total.toFixed(0)} ms sampled main-thread time`);
    for (const [k, v] of top) console.log(`  ${v.toFixed(0).padStart(6)} ms  ${k}`);
    return { name, total, top };
  };
  const ease = (opts) =>
    `new Promise((res) => { const m = window.__map; m.once('moveend', () => res()); m.easeTo({ ...${JSON.stringify(opts)}, easing: (t) => t }); })`;
  result.profile = [
    await profileScenario('zoom z5->z12', { center: [-120.5, 37], zoom: 5, pitch: 0, bearing: 0 }, ease({ center: [-121.65, 36.68], zoom: 12, duration: 4000 })),
    await profileScenario('pan z12', { center: [-121.65, 36.68], zoom: 12, pitch: 0, bearing: 0 }, ease({ center: [-121.37, 36.8], duration: 3000 })),
    await profileScenario('rotate+pitch z13', { center: [-121.62, 36.62], zoom: 13, pitch: 0, bearing: 0 }, ease({ bearing: 90, pitch: 55, duration: 3000 })),
  ];
}

await browser.close();
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(result, null, 2));
console.log(`\nwrote ${OUT}`);
