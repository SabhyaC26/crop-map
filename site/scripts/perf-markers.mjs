// How many emoji markers live in the DOM, how many are actually visible, and how many CSS animations are running,
// at a few zooms. Animations and attached markers cost main-thread work every frame, visible or not.
//   URL=http://127.0.0.1:5197/ CHROMIUM_PATH=... node scripts/perf-markers.mjs
import { chromium } from 'playwright';

const url = process.env.URL ?? 'http://127.0.0.1:5173/';
const VIEWS = [
  ['state', null, null],
  ['z7', [-120.2, 36.6], 7],
  ['z8.6', [-120.6, 37.3], 8.6],
  ['z10.2', [-121.6, 36.6], 10.2],
  ['z12', [-121.6, 36.6], 12],
  ['back to z8.6', [-120.6, 37.3], 8.6],
];

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(url);
await page.waitForFunction(() => document.querySelector('.crop-marker[data-state=shown]'), null, { timeout: 90000 });
for (const [name, center, zoom] of VIEWS) {
  if (center) await page.evaluate(([c, z]) => window.__map.jumpTo({ center: c, zoom: z }), [center, zoom]);
  await page.waitForTimeout(2500);
  const row = await page.evaluate(() => {
    const all = [...document.querySelectorAll('.crop-marker')];
    const onScreen = (el) => {
      const r = el.getBoundingClientRect();
      return r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight;
    };
    const visible = all.filter(
      (m) =>
        m.dataset.state === 'shown' &&
        m.dataset.gate !== 'off' &&
        !('suppressed' in m.dataset) &&
        onScreen(m) &&
        Number(getComputedStyle(m.querySelector('.crop-marker__band')).opacity) > 0.05,
    );
    return {
      inDom: all.length,
      visible: visible.length,
      running: document.getAnimations().filter((a) => a.playState === 'running').length,
    };
  });
  console.log(`${name.padEnd(13)} inDom ${String(row.inDom).padStart(3)}  visible ${String(row.visible).padStart(3)}  running animations ${row.running}`);
}
await browser.close();
