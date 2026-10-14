// Screenshots of the profit features for docs/screens/. Needs the dev server running.
import { chromium } from 'playwright';

const url = process.env.URL ?? 'http://localhost:5173/';
const out = new URL('../../docs/screens/', import.meta.url).pathname;
const browser = await chromium.launch({
  channel: process.env.CHANNEL,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

async function settle(page) {
  await page.waitForTimeout(800);
  await page.waitForFunction(() => window.__map.areTilesLoaded(), null, { timeout: 120000 });
  await page.waitForTimeout(1500);
}

async function view(page, center, zoom) {
  await page.evaluate(([c, z]) => window.__map.jumpTo({ center: c, zoom: z, pitch: 0 }), [center, zoom]);
  await settle(page);
}

/** Opens the card of the largest-enough field of `cropId` nearest the view centre, breakdown expanded. */
async function openCard(page, cropId) {
  const ok = await page.evaluate(async (id) => {
    const m = window.__map;
    const c = m.getCenter();
    const centre = (f) => {
      const ring = f.geometry.coordinates[0];
      return [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length];
    };
    const fields = m
      .queryRenderedFeatures({ layers: ['fields-fill'] })
      .filter((f) => f.properties.crop_id === id && f.geometry.type === 'Polygon' && f.properties.acres > 8);
    if (fields.length === 0) return false;
    const dist = (f) => {
      const [x, y] = centre(f);
      return (x - c.lng) ** 2 + (y - c.lat) ** 2;
    };
    fields.sort((a, b) => dist(a) - dist(b));
    const [lng, lat] = centre(fields[0]);
    m.jumpTo({ center: [lng, lat + 0.004] });
    await new Promise((r) => setTimeout(r, 400));
    return window.__app.popup.openAt([lng, lat]);
  }, cropId);
  if (!ok) throw new Error(`no field of crop ${cropId} in view`);
  await page.waitForTimeout(600);
  await page.click('.fp-econ-summary');
  await page.waitForTimeout(700);
}

{
  // 1 + 3: P&L card and its sources/cost steps (Napa wine grapes).
  const page = await browser.newPage({ viewport: { width: 1280, height: 1300 }, deviceScaleFactor: 2 });
  await page.goto(url);
  await page.waitForFunction(() => window.__app, null, { timeout: 60000 });
  await view(page, [-122.36, 38.4], 14);
  await openCard(page, 2);
  await settle(page);
  await page.locator('.fp-card').screenshot({ path: `${out}profit-card.png` });
  await page.locator('.fp-econ-sources').screenshot({ path: `${out}profit-data.png` });
  await page.close();
}

{
  // 2: profit filter, after land, over Delano's table grapes.
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  await page.goto(url);
  await page.waitForFunction(() => window.__app, null, { timeout: 60000 });
  await view(page, [-119.25, 35.77], 12);
  await page.getByRole('button', { name: 'Profitable' }).click();
  await settle(page);
  await page.screenshot({ path: `${out}profit-filter.png` });
  await page.close();
}

await browser.close();
console.log(`wrote profit-card.png, profit-data.png, profit-filter.png to ${out}`);
