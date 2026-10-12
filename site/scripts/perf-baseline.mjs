// Performance baseline for the production preview build (real GPU via ANGLE/Metal).
//
//   npm run build && npx vite preview --port 5199      # in another shell
//   node scripts/perf-baseline.mjs [--url http://127.0.0.1:5199/] [--runs 3] [--label before] [--out ../docs/perf-before.json]
//
// Each run uses a fresh browser context (cold HTTP cache) and measures:
//   load:  first render, first idle, markers visible, idle-after-markers, requests in first 5 s, bytes by type,
//          long tasks / blocking time until the app is interactive
//   frames: avg / p95 / max rAF frame time + long tasks for zoom z5->z12 (4 s), pan at z12 Salinas, rotate+pitch at z13
//   input: hover latency (pointermove -> render with hover state), click -> popup, search keystroke -> results
// The median across runs of every scalar is printed as a markdown table and written to --out.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { brotliCompressSync, constants } from 'node:zlib';
import { chromium } from 'playwright';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const URL_ = arg('url', 'http://127.0.0.1:5199/');
const RUNS = Number(arg('runs', '3'));
const LABEL = arg('label', 'run');
const OUT = arg('out', new URL(`../../docs/perf-${LABEL}.json`, import.meta.url).pathname);
const VIEWPORT = { width: 1440, height: 900 };
const SALINAS = [-121.65, 36.68];

const CHROMIUM_ARGS = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'];

// Injected before any page script: hooks the map as soon as main.ts assigns window.__map.
const INIT_SCRIPT = () => {
  const perf = {
    firstRender: null,
    idles: [],
    markersVisible: null,
    longTasks: [],
    frames: null,
    frameStart: 0,
  };
  window.__perf = perf;
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) perf.longTasks.push({ start: e.startTime, dur: e.duration });
  }).observe({ type: 'longtask', buffered: true });

  let map;
  Object.defineProperty(window, '__map', {
    configurable: true,
    get: () => map,
    set(v) {
      map = v;
      v.once('render', () => (perf.firstRender = performance.now()));
      v.on('idle', () => perf.idles.push(performance.now()));
    },
  });

  const poll = () => {
    if (!perf.markersVisible && document.querySelector('.crop-marker[data-state=shown]')) perf.markersVisible = performance.now();
    if (!perf.markersVisible) requestAnimationFrame(poll);
  };
  requestAnimationFrame(poll);

  // Frame recorder: rAF-to-rAF deltas on the main thread.
  perf.startFrames = () => {
    perf.frames = [];
    perf.frameStart = performance.now();
    let last = performance.now();
    const tick = (t) => {
      if (!perf.frames) return;
      perf.frames.push(t - last);
      last = t;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  perf.stopFrames = () => {
    const frames = perf.frames ?? [];
    perf.frames = null;
    return { frames, start: perf.frameStart, end: performance.now() };
  };
};

const median = (xs) => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return NaN;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN;
};
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

function categorize(url, resourceType) {
  const u = new globalThis.URL(url);
  const p = u.pathname;
  if (u.hostname.includes('amazonaws.com')) return 'terrain';
  if (p.endsWith('.pmtiles')) return 'pmtiles';
  if (p.startsWith('/fonts/') && p.endsWith('.pbf')) return 'glyphs';
  if (/\.(woff2?|ttf)$/.test(p)) return 'fonts';
  if (p.startsWith('/icons/')) return 'icons';
  if (p.endsWith('.geojson')) return 'geojson';
  if (p.endsWith('.json')) return 'json';
  if (/\.(png|jpe?g|webp|avif)$/.test(p)) return 'rasters';
  if (/\.(js|mjs)$/.test(p) || resourceType === 'script') return 'js';
  if (p.endsWith('.css')) return 'css';
  if (resourceType === 'document') return 'html';
  return 'other';
}

const TEXT_TYPES = new Set(['js', 'css', 'json', 'geojson', 'html']);

async function measureRun(browser, runIndex) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
  await context.addInitScript(INIT_SCRIPT);
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));

  const requests = [];
  const pending = [];
  context.on('requestfinished', (req) => {
    pending.push(
      (async () => {
        const sizes = await req.sizes().catch(() => null);
        const timing = req.timing();
        requests.push({
          url: req.url(),
          type: categorize(req.url(), req.resourceType()),
          bytes: sizes ? sizes.responseBodySize + sizes.responseHeadersSize : 0,
          start: timing.startTime,
          end: timing.responseEnd > 0 ? timing.startTime + timing.responseEnd : NaN,
          range: Boolean(req.headers()['range']),
        });
      })(),
    );
  });

  // ---------------------------------------------------------------- load
  await page.goto(URL_, { waitUntil: 'commit' });
  await page.waitForFunction(() => window.__app, null, { timeout: 120000 });
  await page.waitForFunction(() => window.__perf.markersVisible, null, { timeout: 120000 });
  // "settled": an idle event at/after the markers appeared.
  await page.waitForFunction(() => window.__perf.idles.some((t) => t >= window.__perf.markersVisible), null, { timeout: 120000 });
  const load = await page.evaluate(() => {
    const p = window.__perf;
    const nav = performance.getEntriesByType('navigation')[0];
    const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null;
    const settled = p.idles.find((t) => t >= p.markersVisible);
    return {
      fcp,
      domContentLoaded: nav?.domContentLoadedEventEnd ?? null,
      firstRender: p.firstRender,
      firstIdle: p.idles[0] ?? null,
      markersVisible: p.markersVisible,
      settled,
      longTasks: p.longTasks.filter((t) => t.start < settled),
    };
  });
  const loadEnd = load.settled;
  const loadLong = load.longTasks;
  const origin = await page.evaluate(() => performance.timeOrigin);
  await page.waitForTimeout(800);

  // ---------------------------------------------------------------- frames
  const settle = async (ms = 600) => {
    await page.waitForFunction(() => window.__map.areTilesLoaded() && !window.__map.isMoving(), null, { timeout: 120000 });
    await page.waitForTimeout(ms);
  };

  const runFrames = async (name, setupSrc, animateSrc) => {
    await page.evaluate(setupSrc);
    await settle();
    await page.evaluate(() => window.__perf.startFrames());
    const longBefore = await page.evaluate(() => window.__perf.longTasks.length);
    await page.evaluate(animateSrc);
    const { frames, start, end } = await page.evaluate(() => window.__perf.stopFrames());
    const longs = await page.evaluate((n) => window.__perf.longTasks.slice(n), longBefore);
    // Drop the first 2 frames (rAF kick-off) from the stats.
    const f = frames.slice(2);
    return {
      name,
      frames: f.length,
      durationMs: end - start,
      avg: avg(f),
      p95: pct(f, 0.95),
      p99: pct(f, 0.99),
      max: Math.max(...f),
      over33: f.filter((x) => x > 33.4).length,
      longTasks: longs.length,
      blockingMs: longs.reduce((a, t) => a + Math.max(0, t.dur - 50), 0),
    };
  };

  // Linear easeTo that resolves on moveend.
  const animateTo = (opts) =>
    `new Promise((res) => { const m = window.__map; m.once('moveend', () => res()); m.easeTo({ ...${JSON.stringify(opts)}, easing: (t) => t }); })`;
  const jump = (opts) => `() => window.__map.jumpTo(${JSON.stringify({ pitch: 0, bearing: 0, ...opts })})`;

  const frames = [];
  frames.push(await runFrames('zoom z5->z12 (4s)', jump({ center: [-120.5, 37], zoom: 5 }), animateTo({ center: SALINAS, zoom: 12, duration: 4000 })));
  frames.push(await runFrames('pan z12 Salinas (3s)', jump({ center: SALINAS, zoom: 12 }), animateTo({ center: [SALINAS[0] + 0.28, SALINAS[1] + 0.12], duration: 3000 })));
  frames.push(await runFrames('rotate+pitch z13 (3s)', jump({ center: [-121.62, 36.62], zoom: 13 }), animateTo({ bearing: 90, pitch: 55, duration: 3000 })));

  // ---------------------------------------------------------------- input latency
  await page.evaluate(() => window.__map.jumpTo({ center: [-121.62, 36.62], zoom: 13, pitch: 0, bearing: 0 }));
  await settle(1000);
  const fieldPoints = await page.evaluate(() => {
    const m = window.__map;
    const w = m.getContainer().clientWidth;
    const h = m.getContainer().clientHeight;
    const out = [];
    const seen = new Set();
    for (let y = h * 0.3; y < h * 0.8; y += 14)
      for (let x = w * 0.25; x < w * 0.75; x += 14) {
        const hit = window.__app.fields.queryAt([x, y]);
        if (hit && !seen.has(hit.id)) {
          seen.add(hit.id);
          out.push({ x, y, id: hit.id });
        }
      }
    return out;
  });
  const input = { hoverMs: [], clickPopupMs: [], searchMs: [] };

  // Hover: pointermove timeStamp -> first map 'render' where that field is in hover state.
  await page.evaluate(() => {
    window.__hover = { t0: 0, id: null, done: null };
    document.addEventListener(
      'pointermove',
      (e) => {
        if (window.__hover.id !== null && window.__hover.done === null) window.__hover.t0 = e.timeStamp;
      },
      true,
    );
    window.__map.on('render', () => {
      const h = window.__hover;
      if (h.id === null || h.done !== null || !h.t0) return;
      const st = window.__map.getFeatureState({ source: 'fields', sourceLayer: 'fields', id: h.id });
      if (st && st.hover) requestAnimationFrame(() => (h.done = performance.now()));
    });
  });
  const pickFar = (arr) => arr.filter((_, i) => i % Math.max(1, Math.floor(arr.length / 12)) === 0).slice(0, 12);
  for (const pt of pickFar(fieldPoints)) {
    await page.mouse.move(5, 5); // clear hover on empty corner
    await page.waitForTimeout(250);
    await page.evaluate((id) => (window.__hover = { ...window.__hover, t0: 0, id, done: null }), pt.id);
    await page.mouse.move(pt.x, pt.y, { steps: 1 });
    try {
      await page.waitForFunction(() => window.__hover.done !== null, null, { timeout: 2000 });
      const ms = await page.evaluate(() => window.__hover.done - window.__hover.t0);
      input.hoverMs.push(ms);
    } catch {
      /* missed */
    }
  }

  // Click -> popup node present and painted.
  await page.evaluate(() => {
    window.__click = { t0: 0, done: null };
    document.addEventListener('click', (e) => (window.__click.t0 = e.timeStamp), true);
    const root = document.getElementById('popup-root');
    new MutationObserver(() => {
      if (window.__click.t0 && window.__click.done === null && root.querySelector('.field-popup:not(.is-closing)')) {
        requestAnimationFrame(() => (window.__click.done = performance.now()));
      }
    }).observe(root, { childList: true, subtree: true });
  });
  for (const pt of pickFar(fieldPoints).slice(0, 6)) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    await page.evaluate(() => (window.__click = { ...window.__click, t0: 0, done: null }));
    await page.mouse.click(pt.x, pt.y);
    try {
      await page.waitForFunction(() => window.__click.done !== null, null, { timeout: 3000 });
      input.clickPopupMs.push(await page.evaluate(() => window.__click.done - window.__click.t0));
    } catch {
      /* no popup */
    }
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // Search: keydown timeStamp -> results list mutated and painted.
  await page.evaluate(() => {
    window.__search = { t0: 0, done: null };
    document.addEventListener(
      'keydown',
      (e) => {
        if (e.target instanceof HTMLInputElement && e.target.classList.contains('cs-input')) window.__search.t0 = e.timeStamp;
      },
      true,
    );
    const list = document.querySelector('.cs-root ul, .cs-root [role=listbox]');
    if (!list) return;
    new MutationObserver(() => {
      if (window.__search.t0 && window.__search.done === null) requestAnimationFrame(() => (window.__search.done = performance.now()));
    }).observe(list, { childList: true, subtree: true });
  });
  await page.locator('.cs-input').click();
  await page.waitForTimeout(400);
  for (const ch of 'almond') {
    await page.evaluate(() => (window.__search = { ...window.__search, t0: 0, done: null }));
    await page.keyboard.type(ch);
    try {
      await page.waitForFunction(() => window.__search.done !== null, null, { timeout: 2000 });
      input.searchMs.push(await page.evaluate(() => window.__search.done - window.__search.t0));
    } catch {
      /* no list change */
    }
    await page.waitForTimeout(120);
  }

  await Promise.all(pending);
  for (const r of requests) {
    r.start -= origin;
    r.end -= origin;
  }
  await context.close();

  // ---------------------------------------------------------------- bytes
  const loadMs = loadEnd;
  const fromNavMs = (r) => r.end;
  const byType = {};
  const loadByType = {};
  const add = (acc, r) => {
    acc[r.type] ??= { bytes: 0, count: 0 };
    acc[r.type].bytes += r.bytes;
    acc[r.type].count += 1;
  };
  for (const r of requests) {
    add(byType, r);
    if (fromNavMs(r) <= loadMs) add(loadByType, r);
  }
  const requestsFirst5s = requests.filter((r) => r.start <= 5000).length;
  const pmtilesRange = requests.filter((r) => r.type === 'pmtiles' && r.end <= loadMs);

  // Brotli estimate of text assets (the preview server sends them uncompressed; a real host will not).
  const textUrls = [...new Set(requests.filter((r) => TEXT_TYPES.has(r.type) && r.end <= loadMs).map((r) => r.url))];
  let textRaw = 0;
  let textBr = 0;
  for (const u of textUrls) {
    const res = await fetch(u).catch(() => null);
    if (!res?.ok) continue;
    const buf = Buffer.from(await res.arrayBuffer());
    textRaw += buf.length;
    textBr += brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }).length;
  }

  return {
    run: runIndex,
    errors,
    load: {
      fcp: load.fcp,
      domContentLoaded: load.domContentLoaded,
      firstRender: load.firstRender,
      firstIdle: load.firstIdle,
      markersVisible: load.markersVisible,
      settled: loadEnd,
      longTasks: loadLong.length,
      longTaskMs: loadLong.reduce((a, t) => a + t.dur, 0),
      blockingMs: loadLong.reduce((a, t) => a + Math.max(0, t.dur - 50), 0),
      requestsFirst5s,
      requestsTotalAtLoad: requests.filter((r) => r.end <= loadMs).length,
      bytesAtLoad: Object.values(loadByType).reduce((a, v) => a + v.bytes, 0),
      pmtilesRangeRequestsAtLoad: pmtilesRange.length,
      textRawBytesAtLoad: textRaw,
      textBrotliBytesAtLoad: textBr,
    },
    loadByType,
    totalByType: byType,
    frames,
    input: {
      hoverMedian: median(input.hoverMs),
      hoverP95: pct(input.hoverMs, 0.95),
      hoverN: input.hoverMs.length,
      clickPopupMedian: median(input.clickPopupMs),
      clickPopupN: input.clickPopupMs.length,
      searchMedian: median(input.searchMs),
      searchMax: Math.max(...input.searchMs),
      searchN: input.searchMs.length,
    },
  };
}

function summarize(runs) {
  const summary = { load: {}, loadByType: {}, frames: {}, input: {} };
  for (const key of Object.keys(runs[0].load)) summary.load[key] = median(runs.map((r) => r.load[key]));
  for (const key of Object.keys(runs[0].input)) summary.input[key] = median(runs.map((r) => r.input[key]));
  const types = new Set(runs.flatMap((r) => Object.keys(r.loadByType)));
  for (const t of types) {
    summary.loadByType[t] = {
      bytes: median(runs.map((r) => r.loadByType[t]?.bytes ?? 0)),
      count: median(runs.map((r) => r.loadByType[t]?.count ?? 0)),
    };
  }
  for (const name of runs[0].frames.map((f) => f.name)) {
    const per = runs.map((r) => r.frames.find((f) => f.name === name));
    summary.frames[name] = Object.fromEntries(
      ['avg', 'p95', 'p99', 'max', 'over33', 'longTasks', 'blockingMs', 'frames'].map((k) => [k, median(per.map((p) => p?.[k]))]),
    );
  }
  return summary;
}

const fmt = (n, d = 0) => (Number.isFinite(n) ? n.toFixed(d) : 'n/a');
const kb = (n) => `${fmt(n / 1024, 0)} KB`;

function report(summary, errorCount) {
  const l = summary.load;
  const lines = [];
  lines.push(`| load metric | median |`, `|---|---|`);
  lines.push(`| FCP | ${fmt(l.fcp)} ms |`);
  lines.push(`| first map render | ${fmt(l.firstRender)} ms |`);
  lines.push(`| first idle | ${fmt(l.firstIdle)} ms |`);
  lines.push(`| markers visible | ${fmt(l.markersVisible)} ms |`);
  lines.push(`| settled (idle after markers) | ${fmt(l.settled)} ms |`);
  lines.push(`| requests in first 5 s | ${fmt(l.requestsFirst5s)} |`);
  lines.push(`| requests until settled | ${fmt(l.requestsTotalAtLoad)} (pmtiles ranges: ${fmt(l.pmtilesRangeRequestsAtLoad)}) |`);
  lines.push(`| bytes until settled | ${kb(l.bytesAtLoad)} |`);
  lines.push(`| text assets raw -> brotli est. | ${kb(l.textRawBytesAtLoad)} -> ${kb(l.textBrotliBytesAtLoad)} |`);
  lines.push(`| long tasks during load | ${fmt(l.longTasks)} (${fmt(l.longTaskMs)} ms, TBT ${fmt(l.blockingMs)} ms) |`, '');
  lines.push(`| bytes by type until settled | KB | requests |`, `|---|---|---|`);
  for (const [t, v] of Object.entries(summary.loadByType).sort((a, b) => b[1].bytes - a[1].bytes))
    lines.push(`| ${t} | ${fmt(v.bytes / 1024, 1)} | ${fmt(v.count)} |`);
  lines.push('', `| frames | avg ms | p95 ms | p99 ms | max ms | >33ms | long tasks | blocking ms |`, `|---|---|---|---|---|---|---|---|`);
  for (const [name, f] of Object.entries(summary.frames))
    lines.push(`| ${name} | ${fmt(f.avg, 1)} | ${fmt(f.p95, 1)} | ${fmt(f.p99, 1)} | ${fmt(f.max, 1)} | ${fmt(f.over33)} | ${fmt(f.longTasks)} | ${fmt(f.blockingMs)} |`);
  const i = summary.input;
  lines.push('', `| input latency | median | extra |`, `|---|---|---|`);
  lines.push(`| hover field (pointermove -> hover painted) | ${fmt(i.hoverMedian, 1)} ms | p95 ${fmt(i.hoverP95, 1)} (n=${fmt(i.hoverN)}) |`);
  lines.push(`| click -> popup painted | ${fmt(i.clickPopupMedian, 1)} ms | n=${fmt(i.clickPopupN)} |`);
  lines.push(`| search keystroke -> results painted | ${fmt(i.searchMedian, 1)} ms | max ${fmt(i.searchMax, 1)} (n=${fmt(i.searchN)}) |`);
  lines.push('', `console errors across runs: ${errorCount}`);
  return lines.join('\n');
}

const browser = await chromium.launch({ args: CHROMIUM_ARGS });
const runs = [];
let errorCount = 0;
for (let i = 0; i < RUNS; i++) {
  console.error(`run ${i + 1}/${RUNS} ...`);
  const r = await measureRun(browser, i);
  errorCount += r.errors.length;
  if (r.errors.length) console.error('console errors:', r.errors.slice(0, 5));
  runs.push(r);
}
await browser.close();

const summary = summarize(runs);
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ label: LABEL, url: URL_, runs: RUNS, summary, raw: runs }, null, 2));
console.log(`## ${LABEL} (median of ${RUNS})\n`);
console.log(report(summary, errorCount));
console.error(`wrote ${OUT}`);
