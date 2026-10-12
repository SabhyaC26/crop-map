// Interaction + robustness checks for the region markers. Needs a dev server (URL env, default :5173).
import { chromium } from 'playwright';

const url = process.env.URL ?? 'http://localhost:5173/';
const browser = await chromium.launch({
  args: ['--use-gl=angle', `--use-angle=${process.env.ANGLE ?? 'swiftshader'}`, '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const results = [];
const errors = [];
const check = (name, ok, extra = '') => {
  results.push(ok);
  console.log(ok ? 'PASS' : 'FAIL', name, extra);
};

const fxIdle = () => !document.getAnimations().some((a) => a.effect?.target?.classList?.contains('crop-marker__fx'));

async function open(context) {
  const page = await context.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 200));
  });
  page.on('pageerror', (e) => errors.push(`pageerror ${e.message}`));
  await page.goto(url);
  await page.waitForFunction(() => window.__app?.markers, null, { timeout: 90000 });
  await page.waitForFunction(() => document.querySelector('.crop-marker[data-level=coarse][data-state=shown]'), null, { timeout: 90000 });
  await page.waitForFunction(fxIdle, null, { timeout: 90000 });
  return page;
}

const counts = (page) =>
  page.evaluate(() => ({
    coarse: document.querySelectorAll('.crop-marker[data-level=coarse][data-state=shown]').length,
    fine: document.querySelectorAll('.crop-marker[data-level=fine][data-state=shown]').length,
    z: window.__map.getZoom(),
  }));

const idle = (page) => page.waitForFunction(() => !window.__map.isMoving(), null, { timeout: 90000 });

{
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await open(context);

  let c = await counts(page);
  const calm = await page.evaluate(() => {
    const on = [...document.querySelectorAll('.crop-marker[data-level=coarse][data-gate=on][data-state=shown]')];
    const icons = on.map((e) => e.querySelector('.crop-marker__img')?.getAttribute('src'));
    const labelsShown = on.filter((e) => Number(getComputedStyle(e.querySelector('.crop-marker__name')).opacity) > 0.05).length;
    const maxIcon = Math.max(...on.map((e) => e.querySelector('.crop-marker__icon').getBoundingClientRect().height));
    const halos = document.querySelectorAll('.crop-marker__halo').length;
    return { on: on.length, distinctIcons: new Set(icons).size, labelsShown, maxIcon, halos };
  });
  check('intro: coarse markers shown, fine hidden', c.coarse >= 20 && c.fine === 0, JSON.stringify(c));
  check('intro: visible coarse markers capped at ~12', calm.on >= 6 && calm.on <= 12, JSON.stringify(calm));
  check('intro: coarse labels hidden by default, no halo, icons <= 50px', calm.labelsShown === 0 && calm.halos === 0 && calm.maxIcon <= 50.5, JSON.stringify(calm));
  check(
    'aria-label format',
    await page.evaluate(() =>
      [...document.querySelectorAll('.crop-marker[data-level=coarse]')].some((e) => e.getAttribute('aria-label') === 'Lettuce & greens in Salinas Valley, 65k acres'),
    ),
  );
  check('markers are buttons', await page.evaluate(() => document.querySelector('.crop-marker')?.tagName === 'BUTTON'));
  check('window.__app.markers exposed', await page.evaluate(() => typeof window.__app.markers.setHidden === 'function' && typeof window.__app.markers.destroy === 'function'));

  const el = '.crop-marker[data-level=coarse][data-gate=on][data-state=shown]';
  const box = await page.evaluate((el) => {
    const r = document.querySelector(`${el} .crop-marker__img`).getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, id: document.querySelector(el).dataset.id };
  }, el);
  await page.mouse.move(box.x + 120, box.y + 160);
  await page.mouse.move(box.x, box.y, { steps: 5 });
  await page.waitForTimeout(500);
  check(
    'coarse label appears on hover',
    await page.evaluate((id) => Number(getComputedStyle(document.querySelector(`.crop-marker[data-id=${id}] .crop-marker__name`)).opacity) > 0.9, box.id),
  );
  await page.waitForTimeout(900);
  const hover = await page.evaluate((id) => {
    const root = document.querySelector(`.crop-marker[data-id=${id}]`);
    return {
      sub: getComputedStyle(root.querySelector('.crop-marker__sub')).opacity,
      scale: getComputedStyle(root.querySelector('.crop-marker__gate')).scale,
      z: getComputedStyle(root).zIndex,
    };
  }, box.id);
  check('hover: secondary line shown, scaled 1.12, raised', hover.sub === '1' && hover.scale === '1.12' && hover.z === '1000', JSON.stringify(hover));

  // Click -> flyTo coarse zoom 8.6, splits into fine markers.
  await page.mouse.click(box.x, box.y);
  await page.waitForTimeout(500);
  await idle(page);
  await page.waitForFunction(fxIdle, null, { timeout: 90000 });
  c = await counts(page);
  check('click coarse: flies to z8.6 and splits', Math.abs(c.z - 8.6) < 0.05 && c.fine > 0 && c.coarse === 0, JSON.stringify(c));

  // Keyboard: focus a fine marker, Enter -> z11.
  const fineId = await page.evaluate(() => {
    const el = document.querySelector('.crop-marker[data-level=fine][data-gate=on][data-state=shown]');
    el.focus();
    return el.dataset.id;
  });
  const focusVisible = await page.evaluate(() => document.activeElement?.classList.contains('crop-marker'));
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  await idle(page);
  c = await counts(page);
  check('keyboard Enter on focused fine marker flies to z11', focusVisible && Math.abs(c.z - 11) < 0.05, `${fineId} ${JSON.stringify(c)}`);
  check('fine markers fade out by z11 (band opacity 0 or inert)', await page.evaluate(() => [...document.querySelectorAll('.crop-marker[data-level=fine][data-state=shown]')].every((e) => Number(e.querySelector('.crop-marker__band').style.opacity) < 0.05)));

  // Rapid zoom robustness: hammer the split threshold, then settle both ways.
  await page.evaluate(() => window.__map.jumpTo({ center: [-120.3, 36.9], zoom: 6.5 }));
  await page.waitForTimeout(400);
  for (let i = 0; i < 14; i++) {
    await page.evaluate((i) => window.__map.jumpTo({ center: [-120.3, 36.9], zoom: i % 2 === 0 ? 8.4 : 6.4 }), i);
    await page.waitForTimeout(40 + (i % 3) * 60);
  }
  await page.evaluate(() => window.__map.jumpTo({ center: [-120.3, 36.9], zoom: 8.4 }));
  await page.waitForFunction(fxIdle, null, { timeout: 90000 });
  c = await counts(page);
  check('after rapid flips ending fine: fine shown, coarse hidden, no stuck animations', c.fine > 0 && c.coarse === 0, JSON.stringify(c));
  const stuck = await page.evaluate(() =>
    [...document.querySelectorAll('.crop-marker[data-state=shown]')].filter((e) => {
      const fx = getComputedStyle(e.querySelector('.crop-marker__fx'));
      return fx.opacity !== '1' || fx.scale !== 'none' || fx.translate !== 'none';
    }).length,
  );
  check('no marker left mid-transform (fine)', stuck === 0, `stuck=${stuck}`);

  for (let i = 0; i < 10; i++) {
    await page.evaluate((i) => window.__map.jumpTo({ center: [-120.3, 36.9], zoom: i % 2 === 0 ? 6.4 : 8.4 }), i);
    await page.waitForTimeout(30 + (i % 4) * 50);
  }
  await page.evaluate(() => window.__map.jumpTo({ center: [-120.3, 36.9], zoom: 6.4 }));
  await page.waitForFunction(fxIdle, null, { timeout: 90000 });
  c = await counts(page);
  check('after rapid flips ending coarse: coarse shown, fine hidden', c.coarse > 0 && c.fine === 0, JSON.stringify(c));
  const stuck2 = await page.evaluate(() =>
    [...document.querySelectorAll('.crop-marker[data-state=shown]')].filter((e) => {
      const fx = getComputedStyle(e.querySelector('.crop-marker__fx'));
      return fx.opacity !== '1' || fx.scale !== 'none' || fx.translate !== 'none';
    }).length,
  );
  check('no marker left mid-transform (coarse)', stuck2 === 0, `stuck=${stuck2}`);

  // Hiding (search / legend selection): every marker fades out and goes inert, then returns on clear.
  const gateOpacities = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('.crop-marker[data-state=shown][data-gate=on]')].map((e) =>
        Number(getComputedStyle(e.querySelector('.crop-marker__gate')).opacity),
      ),
    );
  await page.evaluate(() => window.__app.markers.setHidden(true));
  await page.waitForTimeout(700);
  const hiddenState = await page.evaluate(() => ({
    flagged: document.querySelectorAll('.crop-marker[data-suppressed]').length,
    total: document.querySelectorAll('.crop-marker').length,
    focusable: [...document.querySelectorAll('.crop-marker')].filter((e) => e.tabIndex === 0).length,
  }));
  const hiddenOpacity = await gateOpacities();
  check(
    'setHidden(true) fades every marker out and makes it inert',
    hiddenState.flagged === hiddenState.total && hiddenState.focusable === 0 && hiddenOpacity.length > 0 && hiddenOpacity.every((o) => o < 0.02),
    JSON.stringify({ ...hiddenState, max: Math.max(...hiddenOpacity) }),
  );
  await page.evaluate(() => window.__app.markers.setHidden(false));
  await page.waitForTimeout(900);
  const shownOpacity = await gateOpacities();
  check(
    'setHidden(false) restores them',
    (await page.evaluate(() => document.querySelectorAll('.crop-marker[data-suppressed]').length)) === 0 && shownOpacity.length > 0 && shownOpacity.every((o) => o > 0.98),
    `n=${shownOpacity.length}`,
  );

  await context.close();
}

{
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  const page = await open(context);
  const bob = await page.evaluate(() => getComputedStyle(document.querySelector('.crop-marker__float')).animationName);
  check('reduced motion: no bobbing', bob === 'none', bob);
  await page.evaluate(() => window.__map.jumpTo({ center: [-120.3, 36.9], zoom: 8.3 }));
  await page.waitForFunction(() => document.querySelector('.crop-marker[data-level=fine][data-state=shown]'), null, { timeout: 60000 });
  await page.waitForFunction(fxIdle, null, { timeout: 30000 });
  const c = await counts(page);
  check('reduced motion: split still resolves to fine markers', c.fine > 0 && c.coarse === 0, JSON.stringify(c));
  const translated = await page.evaluate(() => document.getAnimations().some((a) => a.effect?.getKeyframes?.().some((k) => 'translate' in k)));
  check('reduced motion: no translate animations', !translated);
  await context.close();
}

check('no console errors', errors.length === 0, errors.join(' | '));
await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed === 0 ? 0 : 1);
