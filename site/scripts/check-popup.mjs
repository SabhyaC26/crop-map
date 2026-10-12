// Interaction checks for the field popup (desktop + mobile swipe). Needs the dev server running.
import { chromium } from 'playwright';

const url = process.env.URL ?? 'http://localhost:5173/';
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const results = [];
const check = (name, ok) => {
  results.push([name, ok]);
  console.log(ok ? 'PASS' : 'FAIL', name);
};

async function open(page) {
  await page.goto(url);
  await page.waitForFunction(() => window.__app, null, { timeout: 60000 });
  await page.evaluate(() => window.__map.jumpTo({ center: [-121.62, 36.62], zoom: 13, pitch: 0 }));
  await page.waitForTimeout(800);
  await page.waitForFunction(() => window.__map.areTilesLoaded(), null, { timeout: 120000 });
  await page.waitForTimeout(1200);
  return page.evaluate(() => {
    const m = window.__map;
    const w = m.getContainer().clientWidth;
    const h = m.getContainer().clientHeight;
    for (let y = h * 0.35; y < h * 0.7; y += 12)
      for (let x = w * 0.3; x < w * 0.7; x += 12) if (window.__app.fields.queryAt([x, y])) return { x, y };
    return null;
  });
}

const popupCount = (page) => page.locator('.field-popup:not(.is-closing)').count();

{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const pt = await open(page);
  await page.mouse.move(pt.x, pt.y);
  await page.waitForTimeout(300);
  check('pointer cursor on hover', (await page.evaluate(() => window.__map.getCanvas().style.cursor)) === 'pointer');
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(700);
  check('popup opens on click', (await popupCount(page)) === 1);
  check('no farm-name text, has acres+county', /acres?/.test(await page.locator('.fp-stats').innerText()) && /County/.test(await page.locator('.fp-stats').innerText()));
  const before = await page.locator('.fp-card').boundingBox();
  await page.evaluate(() => window.__map.jumpTo({ center: [-121.615, 36.625] }));
  await page.waitForTimeout(200);
  const after = await page.locator('.fp-card').boundingBox();
  check('popup follows map move', Math.abs(before.x - after.x) > 5 || Math.abs(before.y - after.y) > 5);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  check('Esc closes', (await popupCount(page)) === 0);
  const pt2 = await page.evaluate(() => {
    const m = window.__map;
    for (let y = 150; y < 700; y += 12)
      for (let x = 200; x < 1000; x += 12) if (window.__app.fields.queryAt([x, y])) return { x, y };
  });
  await page.mouse.click(pt2.x, pt2.y);
  await page.waitForTimeout(600);
  await page.locator('.fp-close').click();
  await page.waitForTimeout(500);
  check('close button closes', (await popupCount(page)) === 0);
  await page.mouse.click(pt2.x, pt2.y);
  await page.waitForTimeout(600);
  const empty = await page.evaluate(() => {
    for (let y = 100; y < 780; y += 10)
      for (let x = 20; x < 1260; x += 10) if (!window.__app.fields.queryAt([x, y]) && !document.elementFromPoint(x, y)?.closest('.field-popup,button,.glass')) return { x, y };
  });
  await page.mouse.click(empty.x, empty.y);
  await page.waitForTimeout(500);
  check('click on empty map closes', (await popupCount(page)) === 0);
  const progOk = await page.evaluate(([x, y]) => window.__app.popup.openAt(window.__map.unproject([x, y])), [pt2.x, pt2.y]);
  await page.waitForTimeout(500);
  check('popup.openAt opens programmatically', progOk && (await popupCount(page)) === 1);
  check('no console errors (desktop)', errors.length === 0);
  if (errors.length) console.log(errors);
  await page.close();
}

{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const pt = await open(page);
  await page.touchscreen.tap(pt.x, pt.y);
  await page.waitForTimeout(800);
  check('mobile: sheet opens', (await page.locator('.field-popup[data-placement="sheet"]').count()) === 1);
  const box = await page.locator('.fp-card').boundingBox();
  check('mobile: sheet at bottom', Math.abs(box.y + box.height - 844) < 24);
  const client = await ctx.newCDPSession(page);
  const x = box.x + box.width / 2;
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: box.y + 20 }] });
  for (let i = 1; i <= 8; i++) await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: box.y + 20 + i * 18 }] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(600);
  check('mobile: swipe down closes', (await popupCount(page)) === 0);
  await ctx.close();
}

await browser.close();
process.exit(results.every(([, ok]) => ok) ? 0 : 1);
