// Cold-load and zoom-in latency for a production build under a throttled network.
//
//   node scripts/tile-server.mjs 5300 &
//   VITE_*_URL=http://127.0.0.1:5300/<name>.pmtiles npm run build && npx vite preview --port 5199 &
//   node scripts/perf-load.mjs [--url http://127.0.0.1:5199/] [--runs 3] [--label before] [--mobile]
//
// Each run is a fresh browser context (cold HTTP cache). Times are ms from navigation start.
import { chromium } from 'playwright';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const URL_ = arg('url', 'http://127.0.0.1:5199/');
const RUNS = Number(arg('runs', '3'));
const LABEL = arg('label', 'run');
const MOBILE = process.argv.includes('--mobile');
const EXE = process.env.CHROMIUM_PATH;
const NETWORK = { offline: false, latency: 80, downloadThroughput: 2.5e6, uploadThroughput: 1.25e6 };
const VIEWPORT = MOBILE ? { width: 390, height: 844 } : { width: 1440, height: 900 };
const DPR = Number(arg('dpr', MOBILE ? '3' : '2'));
const STOPS = [
  ['salinas', [-121.62, 36.62], 11.5],
  ['modesto', [-121.03, 37.6], 13],
];

const INIT = () => {
  const p = { firstRender: null, revealed: null, markers: null };
  window.__perf = p;
  let map;
  Object.defineProperty(window, '__map', {
    configurable: true,
    get: () => map,
    set(v) {
      map = v;
      v.once('render', () => (p.firstRender = performance.now()));
    },
  });
  // Mutation records fire as the app flips the class/state, so a stalled frame cannot delay the timestamp.
  new MutationObserver(() => {
    if (!p.revealed && document.documentElement.classList.contains('map-ready')) p.revealed = performance.now();
    if (!p.markers && document.querySelector('.crop-marker[data-state=shown]')) p.markers = performance.now();
  }).observe(document, { subtree: true, attributes: true, attributeFilter: ['class', 'data-state'] });
};

const category = (url) => {
  const u = new URL(url);
  if (u.hostname.includes('amazonaws.com')) return 'terrain';
  if (u.pathname.endsWith('.pmtiles')) return 'pmtiles';
  if (u.pathname.includes('/fonts/')) return 'glyphs';
  if (/\.(woff2?)$/.test(u.pathname)) return 'webfont';
  if (u.pathname.startsWith('/icons/')) return 'icons';
  if (/\.(js)$/.test(u.pathname)) return 'js';
  if (/\.(css)$/.test(u.pathname)) return 'css';
  if (/\.(geo)?json$/.test(u.pathname)) return 'json';
  if (/\.(png|webp)$/.test(u.pathname)) return 'rasters';
  return 'other';
};

const settle = async (page, timeout = 30000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await page.evaluate(() => window.__map?.loaded() && window.__map.areTilesLoaded())) return Date.now() - t0;
    await page.waitForTimeout(50);
  }
  return NaN;
};

async function run(browser) {
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: DPR, isMobile: MOBILE, hasTouch: MOBILE });
  await ctx.addInitScript(INIT);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', NETWORK);
  const reqs = new Map();
  cdp.on('Network.requestWillBeSent', (e) => reqs.set(e.requestId, { url: e.request.url, bytes: 0, status: 0 }));
  cdp.on('Network.responseReceived', (e) => reqs.has(e.requestId) && (reqs.get(e.requestId).status = e.response.status));
  cdp.on('Network.loadingFinished', (e) => reqs.has(e.requestId) && (reqs.get(e.requestId).bytes = e.encodedDataLength));
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto(URL_, { waitUntil: 'commit' });
  await page.waitForFunction(() => window.__perf?.markers, null, { timeout: 60000, polling: 50 });
  const load = await page.evaluate(() => window.__perf);
  const loadSettled = await settle(page);
  const loadReqs = [...reqs.values()];
  const out = {
    firstRender: load.firstRender,
    revealed: load.revealed,
    markers: load.markers,
    settledAfterMarkers: loadSettled,
    requests: loadReqs.length,
    kb: Math.round(loadReqs.reduce((s, r) => s + r.bytes, 0) / 1024),
    errors: loadReqs.filter((r) => r.status >= 400).length + errors.length,
  };
  for (const r of loadReqs) out[`kb.${category(r.url)}`] = (out[`kb.${category(r.url)}`] ?? 0) + r.bytes / 1024;
  for (const [name, center, zoom] of STOPS) {
    const before = reqs.size;
    await page.evaluate(([c, z]) => window.__map.jumpTo({ center: c, zoom: z }), [center, zoom]);
    out[`zoom.${name}`] = await settle(page);
    const zoomReqs = [...reqs.values()].slice(before);
    out[`zoom.${name}.kb`] = Math.round(zoomReqs.reduce((s, r) => s + r.bytes, 0) / 1024);
    for (const r of zoomReqs) out[`zoom.${name}.kb.${category(r.url)}`] = (out[`zoom.${name}.kb.${category(r.url)}`] ?? 0) + r.bytes / 1024;
  }
  if (errors.length) console.error(errors.slice(0, 5).join('\n'));
  await ctx.close();
  return out;
}

const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const runs = [];
for (let i = 0; i < RUNS; i++) runs.push(await run(browser));
await browser.close();

const median = (xs) => {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  return s.length ? s[s.length >> 1] : NaN;
};
const keys = [...new Set(runs.flatMap(Object.keys))];
console.log(`\n${LABEL} (${MOBILE ? 'mobile 390x844' : 'desktop 1440x900'}@${DPR}, median of ${RUNS})`);
for (const k of keys) console.log(`${k.padEnd(24)} ${Math.round(median(runs.map((r) => r[k] ?? 0)))}`);
