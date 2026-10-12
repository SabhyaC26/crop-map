// Reports geography/city labels that sit under shown emoji markers. Usage: [MOBILE=1] node scripts/check-label-overlap.mjs [zoomDelta...]
import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const viewport = process.env.MOBILE ? { width: 390, height: 844 } : { width: 1440, height: 1000 };
const page = await (await browser.newContext({ viewport, deviceScaleFactor: 1 })).newPage();
await page.goto('http://localhost:5194/');
await page.waitForFunction(() => window.__app?.markers, null, { timeout: 90000 });
const deltas = process.argv.slice(2).map(Number);
for (const d of deltas.length ? deltas : [0]) {
  await page.evaluate((d) => { const m = window.__map; if (d) m.jumpTo({ zoom: m.getZoom() + d }); }, d);
  await page.waitForTimeout(500);
  await page.waitForFunction(() => window.__map.areTilesLoaded(), null, { timeout: 60000 });
  await page.waitForTimeout(3500);
  const res = await page.evaluate(() => {
    const m = window.__map;
    const layers = m.getStyle().layers.filter((l) => l.id.startsWith('story_label_')).map((l) => l.id);
    const out = [];
    for (const el of document.querySelectorAll('.crop-marker[data-state=shown][data-gate=on]')) {
      const img = el.querySelector('.crop-marker__img') ?? el;
      const parts = [['icon', img.getBoundingClientRect()]];
      const nm = el.querySelector('.crop-marker__name');
      if (nm && el.dataset.label === 'on') parts.push(['label', nm.getBoundingClientRect()]);
      for (const [kind, r] of parts) {
        const hits = m.queryRenderedFeatures([[r.left, r.top], [r.right, r.bottom]], { layers }).map((f) => f.properties.name);
        if (hits.length) out.push(`${el.getAttribute('aria-label')} ${kind} over ${[...new Set(hits)].join(', ')}`);
      }
    }
    return { z: +m.getZoom().toFixed(2), n: document.querySelectorAll('.crop-marker[data-state=shown][data-gate=on]').length, out };
  });
  console.log(JSON.stringify(res, null, 1));
}
await browser.close();
