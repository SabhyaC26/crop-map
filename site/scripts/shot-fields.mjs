// Usage: node scripts/shot-fields.mjs <scenario> [out.png]   scenarios: z11 | icons | popup | mobile | ca
import { chromium } from 'playwright';

const [scenario, outArg] = process.argv.slice(2);
const url = process.env.URL ?? 'http://localhost:5173/';
const SAL = process.env.CENTER ? process.env.CENTER.split(',').map(Number) : [-121.62, 36.62];
const WANT_CROP = Number(process.env.CROP ?? 0);
const mobile = scenario === 'mobile';
const viewport = mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 };
const out = outArg ?? `/tmp/shots5/${scenario}.png`;

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const ctx = await browser.newContext({ viewport, deviceScaleFactor: mobile ? 3 : 2, hasTouch: mobile, isMobile: mobile });
const page = await ctx.newPage();
const problems = [];
page.on('console', (m) => {
  if (m.type() === 'error') problems.push(`[console.error] ${m.text().slice(0, 300)}`);
});
page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => {
  if (r.failure()?.errorText !== 'net::ERR_ABORTED') problems.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`);
});
await page.goto(url);
await page.waitForFunction(() => window.__app, null, { timeout: 60000 });

const settle = async () => {
  await page.waitForTimeout(800);
  await page.waitForFunction(() => window.__map.areTilesLoaded() && window.__map.isStyleLoaded(), null, { timeout: 120000 });
  await page.waitForTimeout(1800);
};
const jump = (c, z) => page.evaluate(([c, z]) => window.__map.jumpTo({ center: c, zoom: z, pitch: 0 }), [c, z]);

if (scenario === 'ca') {
  await page.evaluate(() => window.__map.fire('resize'));
  await settle();
} else if (scenario === 'z11') {
  await jump(SAL, 11);
  await settle();
} else if (scenario === 'icons') {
  await jump(SAL, 13.5);
  await settle();
} else if (scenario === 'popup' || scenario === 'mobile') {
  await jump(SAL, 13);
  await settle();
  const pt = await page.evaluate((wantCrop) => {
    const map = window.__map;
    const w = map.getContainer().clientWidth;
    const h = map.getContainer().clientHeight;
    const wanted = (window.__want ?? 0);
    let best = null;
    for (let y = h * 0.3; y < h * 0.75; y += 14) {
      for (let x = w * 0.25; x < w * 0.75; x += 14) {
        const hit = window.__app.fields.queryAt([x, y]);
        if (hit && (wantCrop ? hit.cropId === wantCrop : hit.other) && hit.acres > 20 && (!best || Math.abs(x - w / 2) + Math.abs(y - h / 2) < best.d)) {
          best = { x, y, d: Math.abs(x - w / 2) + Math.abs(y - h / 2) };
        }
      }
    }
    return best;
  }, WANT_CROP);
  console.log('click point', pt);
  if (!pt) throw new Error('no field with other crops found');
  if (mobile) await page.touchscreen.tap(pt.x, pt.y);
  else {
    await page.mouse.move(pt.x - 30, pt.y - 20);
    await page.mouse.move(pt.x, pt.y);
    await page.waitForTimeout(400);
    await page.mouse.click(pt.x, pt.y);
  }
  await page.waitForTimeout(1600);
  await settle();
}
const clip = process.env.CLIP ? Object.fromEntries(['x', 'y', 'width', 'height'].map((k, i) => [k, +process.env.CLIP.split(',')[i]])) : undefined;
await page.screenshot({ path: out, clip });
console.log('saved', out);
console.log(problems.length ? problems.join('\n') : 'no console errors');
await browser.close();
